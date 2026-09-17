/* eslint-disable obsidianmd/no-unscoped-localstorage */
/**
 * 画布式平移与缩放控制器。
 *
 * 交互：
 * - Ctrl/⌘ + 滚轮 / 触摸板双指捏合：以指针位置为中心缩放
 * - 鼠标滚轮：以指针位置为中心缩放
 * - 触摸板双指滑动（含水平/垂直）：平移
 * - 左键 / 触屏单指拖动：平移；拖动超过阈值后在 svg 上标记 mln-pan，
 *   由 click/dblclick 处理器读取并抑制，避免拖动结束误触发跳转或聚焦。
 *
 * 与 DiagramFocusController 协作：每次手势开始前 sync() 读取 SVG 当前 viewBox，
 * 因此聚焦动画改变 viewBox 后不会跳变。
 */

export interface PanZoomOptions {
  /** 最小缩放比例（相对初始 viewBox），默认 0.15 */
  minScale?: number;
  /** 最大缩放比例，默认 6 */
  maxScale?: number;
  /** 判定为拖动的像素阈值，默认 5 */
  panThreshold?: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** localStorage 中存储 viewBox 缓存的 key */
const STORAGE_KEY = 'mermaid-link-nav:viewBox-cache';

/** 按 cacheKey 缓存每个流程图的 viewBox，跳转笔记返回/重启后恢复缩放/平移状态 */
const viewBoxCache = new Map<string, Box>();

/** 从 localStorage 加载缓存 */
function loadCache(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as Record<string, Box>;
      for (const [k, v] of Object.entries(data)) {
        viewBoxCache.set(k, v);
      }
    }
  } catch { /* ignore */ }
}

/** 保存缓存到 localStorage（防抖） */
let saveTimer: number | undefined;
function saveCache(): void {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      const data: Record<string, Box> = {};
      for (const [k, v] of viewBoxCache) data[k] = v;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
  }, 300);
}

// 模块加载时从 localStorage 恢复
loadCache();

export class PanZoomController {
  private svg: SVGSVGElement;
  /** 事件绑定目标：优先用 svg 的父容器，避免干扰 svg 内部的 click 事件 */
  private readonly el: Element;
  private readonly cacheKey?: string;
  private opts: Required<PanZoomOptions>;
  private current: Box;
  private readonly baseW: number;
  private readonly baseH: number;
  private readonly ratio: number; // baseH / baseW

  private dragging = false;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private panned = false;
  private observer?: MutationObserver;

  private readonly handlers: Array<{
    type: string;
    listener: EventListenerOrEventListenerObject;
    options?: AddEventListenerOptions;
  }> = [];

  constructor(svg: SVGSVGElement, opts: PanZoomOptions = {}, cacheKey?: string) {
    this.svg = svg;
    this.el = svg.parentElement ?? svg;
    this.cacheKey = cacheKey;
    this.opts = {
      minScale: opts.minScale ?? 0.15,
      maxScale: opts.maxScale ?? 6,
      panThreshold: opts.panThreshold ?? 8,
    };
    this.current = this.readBox();
    this.baseW = this.current.width;
    this.baseH = this.current.height;
    this.ratio = this.baseW > 0 ? this.baseH / this.baseW : 1;
    // 恢复之前的缩放/平移状态
    if (cacheKey) {
      const cached = viewBoxCache.get(cacheKey);
      if (cached) this.writeBox(cached);
      // 监听 viewBox 变化（包括聚焦动画），自动保存
      this.observer = new MutationObserver(() => {
        const b = this.readBox();
        this.current = b;
        viewBoxCache.set(cacheKey, { ...b });
        saveCache();
      });
      this.observer.observe(svg, { attributes: true, attributeFilter: ['viewBox'] });
    }
    this.bind();
  }

  private readBox(): Box {
    const vb = this.svg.viewBox.baseVal;
    return { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
  }

  private writeBox(b: Box): void {
    this.svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.width} ${b.height}`);
    this.current = b;
    if (this.cacheKey) {
      viewBoxCache.set(this.cacheKey, { ...b });
      saveCache();
    }
  }

  /** 从 SVG 同步当前 viewBox（聚焦动画可能已修改它） */
  sync(): void {
    this.current = this.readBox();
  }

  private rafId = 0;

  /** 动画过渡到目标 viewBox */
  private animateTo(target: Box, duration = 350): void {
    cancelAnimationFrame(this.rafId);
    const start = { ...this.current };
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - t0) / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.writeBox({
        x: start.x + (target.x - start.x) * ease,
        y: start.y + (target.y - start.y) * ease,
        width: start.width + (target.width - start.width) * ease,
        height: start.height + (target.height - start.height) * ease,
      });
      if (t < 1) this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  }

  /** 聚焦到指定节点元素：居中并适当放大，不隐藏其他节点 */
  focusElement(el: SVGGElement): void {
    const bbox = el.getBBox();
    if (bbox.width === 0 || bbox.height === 0) return;
    // 目标视野：节点周围留 padding，放大到节点宽度的 3 倍
    const padX = bbox.width * 1.0;
    const padY = bbox.height * 1.5;
    let targetW = bbox.width + padX * 2;
    let targetH = targetW * this.ratio;
    if (targetH < bbox.height + padY * 2) {
      targetH = bbox.height + padY * 2;
      targetW = targetH / this.ratio;
    }
    // 限制不超过最大缩放
    const minW = this.baseW / this.opts.maxScale;
    if (targetW < minW) {
      targetW = minW;
      targetH = targetW * this.ratio;
    }
    const target: Box = {
      x: bbox.x + bbox.width / 2 - targetW / 2,
      y: bbox.y + bbox.height / 2 - targetH / 2,
      width: targetW,
      height: targetH,
    };
    this.animateTo(target);
  }

  /** 以屏幕坐标为中心缩放 */
  private zoomAt(clientX: number, clientY: number, factor: number): void {
    const rect = this.svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
    const b = this.current;
    const cx = b.x + px * b.width;
    const cy = b.y + py * b.height;

    const minW = this.baseW / this.opts.maxScale;
    const maxW = this.baseW / this.opts.minScale;
    const newW = Math.min(Math.max(b.width * factor, minW), maxW);
    const newH = newW * this.ratio;

    this.writeBox({
      x: cx - px * newW,
      y: cy - py * newH,
      width: newW,
      height: newH,
    });
  }

  /** 按屏幕像素差平移 */
  private panBy(deltaX: number, deltaY: number): void {
    const rect = this.svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const scaleX = this.current.width / rect.width;
    const scaleY = this.current.height / rect.height;
    this.writeBox({
      x: this.current.x - deltaX * scaleX,
      y: this.current.y - deltaY * scaleY,
      width: this.current.width,
      height: this.current.height,
    });
  }

  private bind(): void {
    const onWheel = (e: Event): void => {
      const ev = e as WheelEvent;
      ev.preventDefault();
      this.sync();
      if (ev.ctrlKey) {
        // 触摸板双指捏合 / Ctrl+滚轮 → 缩放（deltaY<0 上滚/张开=放大）
        this.zoomAt(ev.clientX, ev.clientY, Math.exp(ev.deltaY * 0.01));
      } else if (Math.abs(ev.deltaX) > 0) {
        // 触摸板水平滑动 → 平移
        this.panBy(ev.deltaX, ev.deltaY);
      } else if (ev.deltaMode === 0 && Math.abs(ev.deltaY) < 40) {
        // 触摸板垂直滑动（像素模式小增量）→ 平移
        this.panBy(0, ev.deltaY);
      } else {
        // 鼠标滚轮 → 以指针位置为中心缩放（上滚放大、下滚缩小）
        this.zoomAt(ev.clientX, ev.clientY, Math.exp(ev.deltaY * 0.0015));
      }
    };

    const onPointerDown = (e: Event): void => {
      const ev = e as PointerEvent;
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      this.sync();
      this.dragging = true;
      this.panned = false;
      this.startX = this.lastX = ev.clientX;
      this.startY = this.lastY = ev.clientY;
      // 不在 pointerdown 时 setPointerCapture，避免干扰节点的 click 事件
    };

    const onPointerMove = (e: Event): void => {
      if (!this.dragging) return;
      const ev = e as PointerEvent;
      const dx = ev.clientX - this.lastX;
      const dy = ev.clientY - this.lastY;
      this.lastX = ev.clientX;
      this.lastY = ev.clientY;
      if (!this.panned) {
        const dist = Math.hypot(ev.clientX - this.startX, ev.clientY - this.startY);
        if (dist < this.opts.panThreshold) return;
        this.panned = true;
        this.svg.dataset.mlnPan = '1'; // 抑制后续 click/dblclick
        this.svg.classList.add('mln-panning');
        // 确认开始拖动后才捕获指针，保证拖动不丢事件
        try {
          this.svg.setPointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
      }
      this.panBy(dx, dy);
    };

    const onPointerUp = (e: Event): void => {
      if (!this.dragging) return;
      const ev = e as PointerEvent;
      this.dragging = false;
      this.svg.classList.remove('mln-panning');
      if (this.panned) {
        try {
          this.svg.releasePointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
        // 延迟清除标志，让紧接着的 click/dblclick 能检测到并抑制
        window.setTimeout(() => {
          delete this.svg.dataset.mlnPan;
        }, 0);
      }
    };

    this.add('wheel', onWheel, { passive: false });
    this.add('pointerdown', onPointerDown);
    this.add('pointermove', onPointerMove);
    this.add('pointerup', onPointerUp);
    this.add('pointercancel', onPointerUp);
  }

  private add(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions,
  ): void {
    this.el.addEventListener(type, listener, options);
    this.handlers.push({ type, listener, options });
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.observer?.disconnect();
    for (const h of this.handlers) {
      this.el.removeEventListener(h.type, h.listener, h.options);
    }
    this.svg.classList.remove('mln-panning');
    delete this.svg.dataset.mlnPan;
  }
}
