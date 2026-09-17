/**
 * 聚焦控制器：在渲染好的 mermaid SVG 上做
 * 「隐藏无关节点/边 + viewBox 平滑放大」与「全部恢复 + 缩回全图」。
 * 不依赖 Obsidian API，可在 jsdom 下直接测试。
 */
import type { FlowEdge } from './parser';
import { buildGraph, edgeKey, focusSubset, type FocusGraph } from './focus';
import { extractNodeId } from './node-id';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface EdgeDom {
  from: string;
  to: string;
  path: SVGElement;
  label?: SVGElement;
}

export interface FocusDomOptions {
  renderId: string;
  knownIds: Set<string>;
  includeAncestors: boolean;
  duration: number;
  paddingRatio: number;
  onFocusChange?: (focused: boolean, focusId: string | null) => void;
}

/** 从 path id（renderId-L_from_to_n）或 label data-id（L_from_to_n）解析端点 */
export function parseEdgeDomId(
  raw: string | null,
  renderId: string,
  knownIds: Set<string>,
): { from: string; to: string } | null {
  if (!raw) return null;
  let s = raw;
  if (s.startsWith(`${renderId}-`)) s = s.slice(renderId.length + 1);
  if (s.startsWith('L_')) s = s.slice(2);
  s = s.replace(/_\d+$/, '');
  const parts = s.split('_');
  for (let k = 1; k < parts.length; k++) {
    const from = parts.slice(0, k).join('_');
    const to = parts.slice(k).join('_');
    if (knownIds.has(from) && knownIds.has(to)) return { from, to };
  }
  return null;
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export class DiagramFocusController {
  private svg: SVGSVGElement;
  private graph: FocusGraph;
  private edges: FlowEdge[];
  private opts: FocusDomOptions;
  private nodeMap = new Map<string, SVGGElement>();
  private edgeDoms: EdgeDom[] = [];
  private initialView: Box;
  private raf = 0;
  private focusRoot: SVGGElement | null = null;
  currentFocus: string | null = null;

  constructor(svg: SVGSVGElement, edges: FlowEdge[], opts: FocusDomOptions) {
    this.svg = svg;
    this.edges = edges;
    this.opts = opts;
    this.graph = buildGraph(edges);
    this.index();
    this.initialView = this.readViewBox();
  }

  /** 临时全部显示后测量目标集合的 viewBox（display:none 的节点测不到 bbox） */
  private viewBoxFor(visible: Set<string>): Box {
    this.nodeMap.forEach((g) => (g.style.display = ''));
    const els = [...visible].map((id) => this.nodeMap.get(id)).filter(Boolean) as SVGGElement[];
    return this.targetViewBox(els);
  }

  private readViewBox(): Box {
    const vb = this.svg.viewBox?.baseVal;
    if (vb && vb.width > 0 && vb.height > 0) {
      return { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
    }
    const b = this.unionBBox([...this.nodeMap.values()]);
    return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
  }

  private index(): void {
    this.svg.querySelectorAll<SVGGElement>('g.node').forEach((g) => {
      const id = extractNodeId(g, this.opts.renderId);
      if (id && this.opts.knownIds.has(id)) this.nodeMap.set(id, g);
    });

    const labelMap = new Map<string, SVGGElement>();
    this.svg.querySelectorAll<SVGGElement>('g.edgeLabel').forEach((gl) => {
      const inner = gl.querySelector<SVGGElement>('g.label[data-id]');
      const parsed = parseEdgeDomId(inner?.getAttribute('data-id') ?? null, '', this.opts.knownIds);
      if (parsed) labelMap.set(edgeKey(parsed.from, parsed.to), gl);
    });

    this.svg.querySelectorAll<SVGPathElement>('path.flowchart-link').forEach((p) => {
      const parsed = parseEdgeDomId(p.getAttribute('id'), this.opts.renderId, this.opts.knownIds);
      if (!parsed) return;
      const key = edgeKey(parsed.from, parsed.to);
      this.edgeDoms.push({ ...parsed, path: p, label: labelMap.get(key) });
    });
  }

  /** 元素 bbox 转换到 SVG 用户坐标系 */
  private bboxInSvg(el: SVGGElement): { minX: number; minY: number; maxX: number; maxY: number } {
    const b = el.getBBox();
    const ctm = el.getCTM();
    const corners: [number, number][] = [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x, b.y + b.height],
      [b.x + b.width, b.y + b.height],
    ];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of corners) {
      const pt = this.svg.createSVGPoint();
      pt.x = px;
      pt.y = py;
      const q = ctm ? pt.matrixTransform(ctm) : pt;
      minX = Math.min(minX, q.x);
      minY = Math.min(minY, q.y);
      maxX = Math.max(maxX, q.x);
      maxY = Math.max(maxY, q.y);
    }
    return { minX, minY, maxX, maxY };
  }

  private unionBBox(els: SVGGElement[]): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const el of els) {
      const b = this.bboxInSvg(el);
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    return { minX, minY, maxX, maxY };
  }

  /** 计算聚焦视图（留白 + 按容器宽高比修正，避免变形） */
  private targetViewBox(visible: SVGGElement[]): Box {
    const b = this.unionBBox(visible);
    let w = b.maxX - b.minX;
    let h = b.maxY - b.minY;
    const pad = Math.max(8, this.opts.paddingRatio * Math.max(w, h));
    let cx = (b.minX + b.maxX) / 2;
    let cy = (b.minY + b.maxY) / 2;
    w += pad * 2;
    h += pad * 2;

    const cw = this.svg.clientWidth || 0;
    const ch = this.svg.clientHeight || 0;
    if (cw > 0 && ch > 0) {
      const targetAspect = cw / ch;
      if (w / h < targetAspect) w = h * targetAspect;
      else h = w / targetAspect;
    }
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  private currentViewBox(): Box {
    const vb = this.svg.viewBox.baseVal;
    return { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
  }

  private setViewBox(b: Box): void {
    this.svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.w} ${b.h}`);
  }

  private animate(to: Box, done?: () => void): void {
    cancelAnimationFrame(this.raf);
    const from = this.currentViewBox();
    if (this.opts.duration <= 0) {
      this.setViewBox(to);
      done?.();
      return;
    }
    const t0 = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - t0) / this.opts.duration);
      const e = easeInOutQuad(t);
      this.setViewBox({
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        w: from.w + (to.w - from.w) * e,
        h: from.h + (to.h - from.h) * e,
      });
      if (t < 1) {
        this.raf = requestAnimationFrame(step);
      } else {
        done?.();
      }
    };
    this.raf = requestAnimationFrame(step);
  }

  /** 双击：聚焦某节点（展开其整棵子树并放大）；若已聚焦该节点则收起并缩回 */
  toggle(id: string): void {
    if (this.currentFocus === id) {
      this.restore();
      return;
    }
    this.focus(id);
  }

  /** 强制聚焦到指定节点（不切换，即使当前已聚焦也重新聚焦） */
  focus(id: string): void {
    const subset = focusSubset(this.graph, this.edges, id, this.opts.includeAncestors);
    if (!subset.nodes.has(id)) return;

    // viewBoxFor 会临时全部显示以准确测量，测量后再按子集隐藏
    const target = this.viewBoxFor(subset.nodes);
    this.nodeMap.forEach((g, nid) => {
      g.style.display = subset.nodes.has(nid) ? '' : 'none';
    });
    this.edgeDoms.forEach((e) => {
      const show = subset.edges.has(edgeKey(e.from, e.to));
      e.path.style.display = show ? '' : 'none';
      if (e.label) e.label.style.display = show ? '' : 'none';
    });

    this.focusRoot?.classList.remove('mln-focus-root');
    this.focusRoot = this.nodeMap.get(id) ?? null;
    this.focusRoot?.classList.add('mln-focus-root');
    this.currentFocus = id;
    this.animate(target);
    this.opts.onFocusChange?.(true, id);
  }

  restore(): void {
    this.focusRoot?.classList.remove('mln-focus-root');
    this.focusRoot = null;
    this.currentFocus = null;
    this.nodeMap.forEach((g) => {
      g.style.display = '';
    });
    this.edgeDoms.forEach((e) => {
      e.path.style.display = '';
      e.label && (e.label.style.display = '');
    });
    this.animate(this.initialView);
    this.opts.onFocusChange?.(false, null);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
  }
}
