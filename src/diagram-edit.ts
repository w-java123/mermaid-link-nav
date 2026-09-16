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
  // 去掉原 opener 及后面的空白/可选引号，统一用引号包裹标签
  const cleaned = idAndOpener.replace(/(\[\[|\[\(|\(\(|\{\{|\[\/|\[\\|[\[\(\{>])\s*"?$/, '');
  const newDef = `${cleaned}${shape.opener}"${label}"${shape.closer}`;
  return source.slice(0, node.start) + newDef + source.slice(node.end);
}

/** 在两个已存在节点之间添加连线（from --> to） */
export function addEdge(source: string, from: string, to: string): string {
  if (from === to) return source;
  const edge = `\n${from} --> ${to}`;
  return source.replace(/\s+$/, '') + edge + '\n';
}

/** 行首是否有节点定义（A[、A(、A{ 等） */
const ANY_NODE_DEF_RE = /^\s*[A-Za-z_][\w-]*\s*(\[\[|\[\(|\(\(|\{\{|\[\/|\[\\|[\[\(\{>])/;
/** 箭头后是否紧跟目标节点定义（--> G["..."]） */
const TARGET_DEF_RE = /-->\s*[A-Za-z_][\w-]*\s*(\[\[|\[\(|\(\(|\{\{|\[\/|\[\\|[\[\(\{>])/;

/** 提取行首的 %%{init}%% + flowchart/graph 指令前缀，返回 [前缀, 剩余内容] */
function splitDirPrefix(line: string): [string, string] {
  const m = line.match(/^\s*(%%\{.*?\}%%\s*)?(flowchart|graph)\s+\w+\s*/);
  if (m) return [m[0], line.slice(m[0].length)];
  return ['', line];
}

/** 删除节点的所有入边（X --> nodeId），保留节点定义，链式边自动跳过中间节点 */
export function removeIncomingEdges(source: string, nodeId: string): string {
  const lines = source.split('\n');
  const result: string[] = [];
  const inEdgeRe = new RegExp(`-->\\s*${nodeId}(\\s|$|[^\\w-])`);
  const outEdgeRe = new RegExp(`${nodeId}\\s*-->`);
  const selfDefRe = new RegExp(`${nodeId}\\s*(\\[\\[|\\[\\(|\\(\\(|\\{\\{|\\[\\/|\\[\\\\|[\\[\\(\\{>])`);

  for (const rawLine of lines) {
    const [prefix, line] = splitDirPrefix(rawLine);
    if (/^\s*(%%|classDef|class|style|subgraph|end|direction|linkStyle)/.test(line)) {
      result.push(rawLine);
      continue;
    }
    if (inEdgeRe.test(line)) {
      if (selfDefRe.test(line)) {
        // C --> D["标签"]：只删掉紧邻 D 前的 源 -->，保留 D 的定义和前面其他语句
        const modified = line.replace(
          new RegExp(`[A-Za-z_][\\w-]*\\s*-->\\s*${nodeId}`),
          nodeId,
        );
        if (modified.trim()) result.push(prefix + modified);
      } else if (outEdgeRe.test(line)) {
        // 链式边 A --> D --> C，改成 A --> C
        const modified = line.replace(new RegExp(`-->\\s*${nodeId}\\s*-->`, 'g'), '-->');
        result.push(prefix + modified);
      } else if (ANY_NODE_DEF_RE.test(line)) {
        // C["名称"] --> D：删掉 --> D 及之后，保留 C 的节点定义
        const modified = line.replace(new RegExp(`-->\\s*${nodeId}.*$`), '').trimEnd();
        if (modified.trim()) result.push(prefix + modified);
      }
      // 纯入边行 A --> D，整行删除（但保留 prefix）
      else if (prefix) result.push(prefix.trimEnd());
    } else {
      result.push(prefix + line);
    }
  }
  return result.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** 删除节点的所有出边（nodeId --> X），保留节点定义 */
export function removeOutgoingEdges(source: string, nodeId: string): string {
  const lines = source.split('\n');
  const result: string[] = [];
  const selfDefRe = new RegExp(`${nodeId}\\s*(\\[\\[|\\[\\(|\\(\\(|\\{\\{|\\[\\/|\\[\\\\|[\\[\\(\\{>])`);
  const pureOutRe = new RegExp(`^\\s*${nodeId}\\s*-->`);
  const chainRe = new RegExp(`-->\\s*${nodeId}\\s*-->`);

  for (const rawLine of lines) {
    const [prefix, line] = splitDirPrefix(rawLine);
    if (/^\s*(%%|classDef|class|style|subgraph|end|direction|linkStyle)/.test(line)) {
      result.push(rawLine);
      continue;
    }
    if (selfDefRe.test(line) && /-->/.test(line)) {
      // F["名称"] --> G：只删 nodeId 的出边，不删入边
      // 出边+目标定义同行：nodeId --> G["定义"] → 保留 G["定义"]
      let modified = line.replace(
        new RegExp(`${nodeId}\\s*-->\\s*(?=[A-Za-z_][\\w-]*\\s*(\\[\\[|\\[\\(|\\(\\(|\\{\\{|\\[\\/|\\[\\\\|[\\[\\(\\{>]))`, 'g'),
        '',
      );
      // 纯出边：nodeId --> G → 删除
      modified = modified.replace(new RegExp(`${nodeId}\\s*-->\\s*[A-Za-z_][\\w-]*`, 'g'), '');
      modified = modified.replace(/\s*-->\s*$/, '').trimEnd();
      if (modified.trim()) result.push(prefix + modified);
      else if (prefix) result.push(prefix.trimEnd());
    } else if (pureOutRe.test(line) && TARGET_DEF_RE.test(line)) {
      // F --> G["名称"]：删掉 F -->，保留 G 的节点定义
      const modified = line.replace(new RegExp(`^\\s*${nodeId}\\s*-->\\s*`), '');
      if (modified.trim()) result.push(prefix + modified);
    } else if (pureOutRe.test(line)) {
      // 纯出边行 F --> G，删除（保留 prefix）
      if (prefix) result.push(prefix.trimEnd());
    } else if (chainRe.test(line)) {
      // 链式 A --> F --> G，改成 A --> F
      result.push(prefix + line.replace(new RegExp(`-->\\s*${nodeId}\\s*-->.*$`), `--> ${nodeId}`));
    } else {
      result.push(prefix + line);
    }
  }
  return result.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** 添加带标签的边：from -->|label| to */
export function addLabeledEdge(source: string, from: string, to: string, label: string): string {
  if (from === to) return source;
  const edge = `\n${from} -->|${label}| ${to}`;
  return source.replace(/\s+$/, '') + edge + '\n';
}

/** 设置为判断节点：改菱形 + 删除原有出边 + 是目标移到否目标左侧 + 添加是/否边 + 隐形链接 */
export function setAsDecision(
  source: string,
  nodeId: string,
  yesTarget: string,
  noTarget: string,
): string {
  let result = changeNodeShape(source, nodeId, 'diamond');
  result = removeOutgoingEdges(result, nodeId);

  // 确保是目标有节点定义（没有则补一个，标签用 ID）
  let parsed = parseDiagram(result);
  let yesNode = parsed.nodes.find((n) => n.id === yesTarget);
  if (!yesNode) {
    result = result.replace(/\s+$/, '') + `\n${yesTarget}["${yesTarget}"]\n`;
    parsed = parseDiagram(result);
    yesNode = parsed.nodes.find((n) => n.id === yesTarget);
  }
  const noNode = parsed.nodes.find((n) => n.id === noTarget);
  if (yesNode && (noNode ? yesNode.start > noNode.start : true)) {
    // 是目标定义在否目标后面（或否目标无定义），需要前移
    const beforeYes = result.slice(0, yesNode.start);
    // 是目标定义前有入边则不移动（避免破坏连线）
    if (/-->\s*$/.test(beforeYes)) {
      // 跳过移动
    } else {
      const yesDef = result.slice(yesNode.start, yesNode.end);
      result = result.slice(0, yesNode.start) + result.slice(yesNode.end);
      // 重新定位否目标
      const parsed2 = parseDiagram(result);
      const noNode2 = parsed2.nodes.find((n) => n.id === noTarget);
      let insertPos = -1;
      if (noNode2 && !/-->\s*$/.test(result.slice(0, noNode2.start))) {
        // 否目标有定义且前无入边，插到否目标前面
        insertPos = noNode2.start;
      } else {
        // 否目标无定义或前有入边，放到 flowchart 指令之后
        const dirMatch = result.match(/^\s*(%%\{.*?\}%%\s*)?(flowchart|graph)\s+\w+\s*/);
        if (dirMatch) insertPos = dirMatch[0].length;
      }
      if (insertPos >= 0) {
        result = result.slice(0, insertPos) + yesDef + '; ' + result.slice(insertPos);
      }
    }
  }

  result = addLabeledEdge(result, nodeId, yesTarget, '是');
  result = addLabeledEdge(result, nodeId, noTarget, '否');
  // 隐形链接：强制是/否目标同一层级
  if (yesTarget !== noTarget) {
    result = result.replace(/\s+$/, '') + `\n${yesTarget} ~~~ ${noTarget}\n`;
  }
  return result;
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
  const normContent = content.replace(/\r\n/g, '\n');
  const oldNorm = oldSource.replace(/\r\n/g, '\n').trim();

  const blockRe = /```(?:mermaid|mermaid-link|mmd)[^\n]*\n([\s\S]*?)```/g;
  let replaced = false;
  let flowchartBlockIndex = -1;
  let blockIndex = 0;
  const newContent = normContent.replace(blockRe, (full, inner: string) => {
    const idx = blockIndex++;
    const innerNorm = inner.replace(/\r\n/g, '\n').trim();
    // 记录第一个包含 flowchart/graph 的代码块位置（备用）
    if (flowchartBlockIndex < 0 && /(flowchart|graph)\s+\w+/.test(innerNorm)) {
      flowchartBlockIndex = idx;
    }
    if (replaced) return full;
    // 精确匹配
    if (innerNorm === oldNorm) {
      replaced = true;
      const header = full.slice(0, full.indexOf('\n') + 1);
      return header + newSource.replace(/\n$/, '') + '\n```';
    }
    return full;
  });

  // 精确匹配失败时，回退到第一个 flowchart 代码块（避免因空白/换行细微差异失败）
  if (!replaced && flowchartBlockIndex >= 0) {
    blockIndex = 0;
    const newContent2 = normContent.replace(blockRe, (full, inner: string) => {
      const idx = blockIndex++;
      if (idx === flowchartBlockIndex && !replaced) {
        replaced = true;
        const header = full.slice(0, full.indexOf('\n') + 1);
        return header + newSource.replace(/\n$/, '') + '\n```';
      }
      return full;
    });
    if (replaced) {
      await app.vault.modify(file, newContent2);
      return true;
    }
  }

  if (!replaced) return false;
  await app.vault.modify(file, newContent);
  return true;
}
