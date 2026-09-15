/**
 * Mermaid 流程图源码编辑：添加节点、编辑节点名称/链接、删除节点、改变形状。
 * 所有操作基于原始源码（含 [[wikilink]]），返回新源码。
 */
import type { App } from 'obsidian';
import { parseDiagram } from './parser';

/** 支持的节点形状 */
export const NODE_SHAPES = [
  { type: 'rect', label: '矩形', opener: '[', closer: ']' },
  { type: 'round', label: '圆角矩形', opener: '(', closer: ')' },
  { type: 'circle', label: '圆形', opener: '((', closer: '))' },
  { type: 'diamond', label: '菱形', opener: '{', closer: '}' },
  { type: 'hexagon', label: '六边形', opener: '{{', closer: '}}' },
  { type: 'cylinder', label: '圆柱形', opener: '[(', closer: ')]' },
  { type: 'subroutine', label: '子程序（双边框）', opener: '[[', closer: ']]' },
] as const;

export type NodeShapeType = (typeof NODE_SHAPES)[number]['type'];

export interface AddNodeOptions {
  label: string;
  link?: string;
  /** 从哪个现有节点连到新节点（FROM --> NEW），留空则不连线 */
  connectFrom?: string;
  /** 新节点连到哪个现有节点（NEW --> TO），用于添加父节点 */
  connectTo?: string;
}

export interface EditNodeOptions {
  label: string;
  /** 留空则移除跳转链接 */
  link?: string;
}

/** 生成不与现有节点冲突的 ID */
function generateId(source: string): string {
  const parsed = parseDiagram(source);
  const existing = new Set(parsed.nodes.map((n) => n.id));
  let i = 1;
  while (existing.has(`N${i}`)) i++;
  return `N${i}`;
}

/** 构建节点标签文本：有链接则 "label [[link]]"，否则 "label" */
function buildLabel(label: string, link?: string): string {
  const clean = label.trim();
  if (link && link.trim()) {
    return `${clean} [[${link.trim()}]]`;
  }
  return clean;
}

/** 在源码末尾追加新节点定义和连线 */
export function addNode(source: string, opts: AddNodeOptions): { newSource: string; newId: string } {
  const newId = generateId(source);
  const label = buildLabel(opts.label, opts.link);
  const nodeDef = `${newId}["${label}"]`;
  let addition = `\n${nodeDef}`;
  if (opts.connectFrom) {
    addition += `\n${opts.connectFrom} --> ${newId}`;
  }
  if (opts.connectTo) {
    addition += `\n${newId} --> ${opts.connectTo}`;
  }
  // 去掉末尾空白后追加，保证源码整洁
  const newSource = source.replace(/\s+$/, '') + addition + '\n';
  return { newSource, newId };
}

/** 编辑指定节点的标签和跳转链接，保留原形状 */
export function editNode(source: string, nodeId: string, opts: EditNodeOptions): string {
  const parsed = parseDiagram(source);
  const node = parsed.nodes.find((n) => n.id === nodeId);
  if (!node) return source;

  const label = buildLabel(opts.label, opts.link);
  // 保留原形状括号，替换标签内容
  const before = source.slice(0, node.labelStart);
  const after = source.slice(node.labelEnd);
  return before + label + after;
}

/** 改变节点形状，保留标签内容 */
export function changeNodeShape(source: string, nodeId: string, shapeType: NodeShapeType): string {
  const parsed = parseDiagram(source);
  const node = parsed.nodes.find((n) => n.id === nodeId);
  if (!node) return source;
  const shape = NODE_SHAPES.find((s) => s.type === shapeType);
  if (!shape) return source;

  const idAndOpener = source.slice(node.start, node.labelStart);
  const label = source.slice(node.labelStart, node.labelEnd);
  // 去掉原 opener（含前导空白），拼接新 opener + 标签 + 新 closer
  const cleaned = idAndOpener.replace(/\s*(\[\[|\[\(|\(\(|\{\{|\[\/|\[\\|[\[\(\{>])\s*$/, '');
  const newDef = `${cleaned}${shape.opener}${label}${shape.closer}`;
  return source.slice(0, node.start) + newDef + source.slice(node.end);
}

/** 在两个已存在节点之间添加连线（from --> to） */
export function addEdge(source: string, from: string, to: string): string {
  if (from === to) return source;
  const edge = `\n${from} --> ${to}`;
  return source.replace(/\s+$/, '') + edge + '\n';
}

/** 删除节点的所有入边（X --> nodeId），链式边自动跳过中间节点 */
export function removeIncomingEdges(source: string, nodeId: string): string {
  const lines = source.split('\n');
  const result: string[] = [];
  const inEdgeRe = new RegExp(`-->\\s*${nodeId}(\\s|$|[^\\w-])`);
  const outEdgeRe = new RegExp(`${nodeId}\\s*-->`);

  for (const line of lines) {
    if (/^\s*(%%|graph|flowchart|classDef|class|style|subgraph|end|direction|linkStyle)/.test(line)) {
      result.push(line);
      continue;
    }
    if (inEdgeRe.test(line)) {
      if (outEdgeRe.test(line)) {
        // 链式边 A --> nodeId --> C，改成 A --> C
        const modified = line.replace(new RegExp(`-->\\s*${nodeId}\\s*-->`, 'g'), '-->');
        result.push(modified);
      }
      // 简单入边 A --> nodeId，整行删除
    } else {
      result.push(line);
    }
  }
  return result.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** 替换节点的父节点：删除原有入边，建立 parentId --> nodeId */
export function setParent(source: string, nodeId: string, parentId: string): string {
  if (nodeId === parentId) return source;
  let result = removeIncomingEdges(source, nodeId);
  result = addEdge(result, parentId, nodeId);
  return result;
}

/** 删除指定节点及其所有相关连线 */
export function deleteNode(source: string, nodeId: string): string {
  const parsed = parseDiagram(source);
  const node = parsed.nodes.find((n) => n.id === nodeId);
  if (!node) return source;

  // 1. 删除节点定义（连同该行的缩进和换行，避免残留空行）
  let lineStart = node.start;
  while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart--;
  let lineEnd = node.end;
  while (lineEnd < source.length && source[lineEnd] !== '\n') lineEnd++;
  if (lineEnd < source.length) lineEnd++; // 包含换行符
  let result = source.slice(0, lineStart) + source.slice(lineEnd);

  // 2. 删除所有包含该节点的边（按行处理）
  const lines = result.split('\n');
  const filtered = lines.filter((line) => {
    // 跳过注释和指令行
    if (/^\s*(%%|graph|flowchart|classDef|class|style|subgraph|end|direction)/.test(line)) return true;
    // 该行是否包含该节点 ID 且是边的一部分（ID 前后是非单词字符或行首行尾）
    const idRe = new RegExp(`(^|[^\\w])${nodeId}([^\\w]|$)`);
    if (idRe.test(line)) {
      // 如果这行只有节点定义（没有箭头），可能是节点定义已被删，残留空行也去掉
      if (/-->|---|==>|-.-/.test(line)) {
        return false; // 是连线，删除整行
      }
      // 非连线行（可能是孤立节点定义残留），也删除
      return false;
    }
    return true;
  });

  return filtered.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * 在笔记中找到 oldSource 对应的 mermaid 代码块，替换为 newSource 并写回。
 * 通过匹配 ```mermaid 代码块内容定位，避免替换错位置。
 */
export async function updateNoteSource(
  app: App,
  sourcePath: string,
  oldSource: string,
  newSource: string,
): Promise<boolean> {
  const file = app.vault.getFileByPath(sourcePath);
  if (!file) return false;

  const content = await app.vault.read(file);
  const oldTrimmed = oldSource.trim();

  // 匹配 ```mermaid ... ``` 代码块
  const blockRe = /```(?:mermaid|mermaid-link|mmd)[^\n]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let replaced = false;
  const newContent = content.replace(blockRe, (full, inner: string) => {
    if (replaced) return full;
    if (inner.trim() === oldTrimmed) {
      replaced = true;
      // 保留代码块开头标记，替换内部内容
      const header = full.slice(0, full.indexOf('\n') + 1);
      return header + newSource.replace(/\n$/, '') + '\n```';
    }
    return full;
  });

  if (!replaced) return false;
  await app.vault.modify(file, newContent);
  return true;
}
