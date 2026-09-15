/**
 * 笔记大纲 → Mermaid flowchart：
 * 1. 用 metadataCache 的 headings / listItems 还原层级树（标题 1-6 级，列表按缩进）
 * 2. 把树生成 mermaid flowchart 源码，同时给出「mermaid 节点 id -> 源文件行号」映射与边
 * 不直接依赖 Obsidian 渲染层，纯函数部分（outlineToMermaid）可在 node 下测试。
 */
import type { App, TFile } from 'obsidian';
import type { FlowEdge } from './parser';

export interface OutlineNode {
  /** mermaid 安全 id：n0、n1…… */
  id: string;
  text: string;
  /** 0-based 源文件行号 */
  line: number;
  /** 树深度（根为 0） */
  level: number;
  kind: 'root' | `h${number}` | 'bullet';
  children: OutlineNode[];
}

export interface OutlineDiagram {
  code: string;
  /** 节点 id -> 源文件行号 */
  lines: Map<string, number>;
  /** 边（均为有向边，供双击聚焦使用） */
  edges: FlowEdge[];
}

interface StructuralItem {
  level: number;
  line: number;
  node: OutlineNode;
}

const HEADING_LEVEL_COUNT = 6;

/** 计算列表项缩进层级（遵循仓库 Tab 宽度设置） */
function indentUnits(indentString: string, tabSize: number): number {
  const expanded = indentString.replace(/\t/g, ' '.repeat(tabSize));
  return Math.floor(expanded.length / tabSize);
}

/** 读取当前笔记的标题与列表，按文档结构建树 */
export function buildOutlineTree(app: App, file: TFile, content: string): OutlineNode[] {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) return [];

  const getConfig = (app.vault as unknown as { getConfig?: (k: string) => unknown }).getConfig;
  const tabSize = (getConfig?.call(app.vault, 'tabSize') as number | undefined) ?? 4;
  const fileLines = content.split('\n');
  const items: StructuralItem[] = [];
  let seq = 0;

  cache.headings?.forEach((h) => {
    items.push({
      level: h.level,
      line: h.position.start.line,
      node: {
        id: `n${seq++}`,
        text: h.heading,
        line: h.position.start.line,
        level: h.level,
        kind: `h${h.level}` as `h${number}`,
        children: [],
      },
    });
  });

  cache.listItems?.forEach((li) => {
    const raw = fileLines[li.position.start.line] ?? '';
    const m = raw.match(/^(\s*)[-*+]\s(?:\[.\]\s)?(.*)$/);
    if (!m) return;
    const level = indentUnits(m[1] ?? '', tabSize) + HEADING_LEVEL_COUNT + 1;
    items.push({
      level,
      line: li.position.start.line,
      node: {
        id: `n${seq++}`,
        text: (m[2] ?? '').trim(),
        line: li.position.start.line,
        level,
        kind: 'bullet',
        children: [],
      },
    });
  });

  items.sort((a, b) => a.line - b.line);

  const roots: OutlineNode[] = [];
  const stack: StructuralItem[] = [];
  for (const cur of items) {
    while (stack.length > 0 && stack[stack.length - 1]!.level >= cur.level) stack.pop();
    if (stack.length > 0) stack[stack.length - 1]!.node.children.push(cur.node);
    else roots.push(cur.node);
    stack.push(cur);
  }
  return roots;
}

/** 把节点文本处理成 mermaid 引号标签：wikilink 取别名/笔记名，去除危险字符 */
export function sanitizeLabel(text: string): string {
  let t = text.replace(
    /\[\[([^\]|#]*)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g,
    (_m, path: string, _hash: string, alias?: string) => {
      if (alias !== undefined) return alias.trim();
      const p = (path ?? '').trim();
      const parts = p.split('/');
      return (parts[parts.length - 1] ?? p).trim();
    },
  );
  // 去掉其它 markdown 行内标记与换行，引号改单引号避免破坏 mermaid 语法
  t = t
    .replace(/[*_~`<>]/g, '')
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return t || '（空）';
}

/** 大纲树 -> mermaid flowchart 源码 */
export function outlineToMermaid(
  roots: OutlineNode[],
  rootName: string,
  direction: 'TB' | 'LR' = 'TB',
): OutlineDiagram {
  const lines = new Map<string, number>();
  const edges: FlowEdge[] = [];
  const statements: string[] = [];

  // 笔记名根节点（体育场形，起止节点风格）
  const rootId = 'n0';
  lines.set(rootId, 0);
  statements.push(`  ${rootId}(["${sanitizeLabel(rootName)}"])`);

  const walk = (n: OutlineNode, parentId: string): void => {
    lines.set(n.id, n.line);
    const label = sanitizeLabel(n.text);
    if (n.kind === 'bullet') statements.push(`  ${n.id}("${label}")`);
    else statements.push(`  ${n.id}["${label}"]`);
    edges.push({ from: parentId, to: n.id, directed: true });
    statements.push(`  ${parentId} --> ${n.id}`);
    n.children.forEach((c) => walk(c, n.id));
  };
  roots.forEach((r) => walk(r, rootId));

  // 根节点的强调样式在渲染后通过 DOM class + styles.css 处理（mermaid classDef 不支持 CSS 变量）
  const code = [`flowchart ${direction === 'LR' ? 'LR' : 'TD'}`, ...statements].join('\n');
  return { code, lines, edges };
}
