/**
 * Mermaid 流程图源码编辑：添加节点、编辑节点名称/链接、删除节点、改变形状。
 * 所有操作基于原始源码（含 [[wikilink]]），返回新源码。
 */
import type { App } from 'obsidian';
import { MarkdownView } from 'obsidian';
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

/** 链式箭头（节点定义闭合后紧跟，则不断行） */
const CHAIN_ARROW_RE = /^(-->|---|==>|-\.-|-.->|~~~)/;
/** 一行内"边目标裸 ID 后跟 2+ 空格再跟新语句"的切分点 */
const EDGE_STMT_GAP_RE = /(?:-->|---|==>|-\.->|~~~)(?:\|[^|\n]*\|)?[ \t]*[A-Za-z_][\w-]*[ \t]{2,}(?=[A-Za-z_][\w-]*)/g;

/**
 * 把单行压缩格式的 mermaid 源码规范化为多行格式（每条语句独立一行）。
 * 单行格式中"孤立节点定义"夹在语句间会导致 mermaid 解析失败/渲染崩溃，
 * 编辑操作前规范化可保证 mermaid 始终能解析。已是多行格式则原样返回。
 */
export function normalizeDiagram(source: string): string {
  const headMatch = source.match(/^\s*(%%\{.*?\}%%\s*)?(flowchart|graph)\s+\w+\s*/);
  const head = headMatch ? headMatch[0] : '';
  const bodyStart = headMatch ? headMatch[0].length : 0;
  const body = source.slice(bodyStart);
  const isMultiLine = /\n/.test(body);

  let result = source;

  if (!isMultiLine) {
    // 单行格式：切分语句为多行
    const parsed = parseDiagram(source);
    if (parsed.nodes.length === 0) return source;

    // 从后往前在"节点定义闭合后且非链式箭头"处插入换行
    const sorted = [...parsed.nodes].sort((a, b) => a.end - b.end);
    for (let i = sorted.length - 1; i >= 0; i--) {
      const n = sorted[i];
      if (n.end >= result.length) continue;
      const rest = result.slice(n.end).replace(/^\s+/, '');
      if (CHAIN_ARROW_RE.test(rest)) continue;
      if (rest) {
        result = result.slice(0, n.end) + '\n' + result.slice(n.end);
      }
    }
    // 补充：同一行内"边目标裸 ID 后跟 2+ 空格再跟新语句"处切分
    result = result.replace(EDGE_STMT_GAP_RE, (m) => m.replace(/[ \t]+$/, '\n'));
  }

  // 统一缩进：头部行（%%{init}%%、flowchart TD）不缩进，语句行 2 空格，空行保留
  // 先把同行的 "%%{init}%% flowchart TD" 拆成两行
  result = result.replace(/^(\s*%%\{.*?\}%%)\s+((?:flowchart|graph)\s+\w+)\s*/, '$1\n$2\n');
  const lines = result.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      out.push('');
    } else if (/^%%\{/.test(t) || /^(flowchart|graph)\b/.test(t)) {
      out.push(t);
    } else {
      out.push('  ' + t);
    }
  }
  return out.join('\n') + '\n';
}

/** 构建节点标签文本：有链接则 "[[link|label]]"，否则 "label" */
function buildLabel(label: string, link?: string): string {
  const clean = label.trim();
  if (link && link.trim()) {
    return `[[${link.trim()}|${clean}]]`;
  }
  return clean;
}

/** 删除指定的 from --> to 边（含带标签边），保留两端节点定义，用分号分隔 */
export function removeEdge(source: string, fromId: string, toId: string): string {
  source = normalizeDiagram(source);
  const fromEsc = fromId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const toEsc = toId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 匹配 from(可选节点定义) --> (可选标签) to，逐行处理
  const edgeRe = new RegExp(`(${fromEsc})(.*?)?\\s*-->\\s*(?:\\|[^|]*\\|\\s*)?(${toEsc})`, 'g');
  const lines = source.split('\n');
  const result: string[] = [];
  for (const rawLine of lines) {
    const [prefix, line] = splitDirPrefix(rawLine);
    if (/^\s*(%%|classDef|class|style|subgraph|end|direction|linkStyle)/.test(line)) {
      result.push(rawLine);
      continue;
    }
    edgeRe.lastIndex = 0;
    if (edgeRe.test(line)) {
      edgeRe.lastIndex = 0;
      // 替换边为分号，保留 from 定义和 to
      const modified = line.replace(edgeRe, '$1$2; $3').replace(/;\s*;/g, ';').replace(/\s+;/g, ';').trimEnd();
      if (modified.trim()) result.push(prefix + modified);
      else if (prefix) result.push(prefix.trimEnd());
    } else {
      result.push(prefix + line);
    }
  }
  return result.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** 交换两个节点的定义内容（标签+形状），ID 不变，相当于互换位置 */
export function swapNodes(source: string, idA: string, idB: string): string {
  source = normalizeDiagram(source);
  const parsed = parseDiagram(source);
  const nodeA = parsed.nodes.find((n) => n.id === idA);
  const nodeB = parsed.nodes.find((n) => n.id === idB);
  if (!nodeA || !nodeB) return source;

  // 提取节点定义内容（不含 ID，从形状开括号到闭括号后）
  const contentA = source.slice(nodeA.start + idA.length, nodeA.end);
  const contentB = source.slice(nodeB.start + idB.length, nodeB.end);

  // 从后往前替换，避免位置偏移
  const [first, second] = nodeA.start < nodeB.start
    ? [{ node: nodeB, content: contentA }, { node: nodeA, content: contentB }]
    : [{ node: nodeA, content: contentB }, { node: nodeB, content: contentA }];

  let result = source;
  for (const { node, content } of [first, second]) {
    const defStart = node.start + node.id.length;
    result = result.slice(0, defStart) + content + result.slice(node.end);
  }
  return result;
}

/** 在源码末尾追加新节点定义和连线；若同时指定上下游，则删除原上下游直连边，使新节点夹在中间 */
export function addNode(source: string, opts: AddNodeOptions): { newSource: string; newId: string } {
  source = normalizeDiagram(source);
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
  let result = source;
  // 同时指定上下游时，删除原来的上游 --> 下游直连边
  if (opts.connectFrom && opts.connectTo) {
    result = removeEdge(result, opts.connectFrom, opts.connectTo);
  }
  // 去掉末尾空白后追加，保证源码整洁
  const newSource = result.replace(/\s+$/, '') + addition + '\n';
  return { newSource, newId };
}

/** 编辑指定节点的标签和跳转链接，保留原形状 */
export function editNode(source: string, nodeId: string, opts: EditNodeOptions): string {
  source = normalizeDiagram(source);
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
  source = normalizeDiagram(source);
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
  source = normalizeDiagram(source);
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
  source = normalizeDiagram(source);
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
  source = normalizeDiagram(source);
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
  source = normalizeDiagram(source);
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
  source = normalizeDiagram(source);
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

/** 更换判断节点的是/否目标，只修改对应分支，不影响另一个分支 */
export function changeDecisionTarget(
  source: string,
  nodeId: string,
  branch: 'yes' | 'no',
  newTarget: string,
): string {
  if (nodeId === newTarget) return source;
  source = normalizeDiagram(source);
  const label = branch === 'yes' ? '是' : '否';
  const otherLabel = branch === 'yes' ? '否' : '是';
  const idEsc = nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 找到当前的是/否目标
  const currentRe = new RegExp(`${idEsc}\\s*-->\\s*\\|${label}\\|\\s*([A-Za-z_][\\w-]*)`);
  const m = source.match(currentRe);
  const oldTarget = m ? m[1] : null;

  // 找到另一个分支的目标（用于更新隐形链接）
  const otherRe = new RegExp(`${idEsc}\\s*-->\\s*\\|${otherLabel}\\|\\s*([A-Za-z_][\\w-]*)`);
  const om = source.match(otherRe);
  const otherTarget = om ? om[1] : null;

  let result = source;
  if (oldTarget) {
    result = removeEdge(result, nodeId, oldTarget);
  }
  result = addLabeledEdge(result, nodeId, newTarget, label);

  // 更新隐形链接：保持是/否目标同层
  if (otherTarget && newTarget !== otherTarget) {
    const oldEsc = oldTarget ? oldTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
    const otherEsc = otherTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let replaced = false;
    if (oldEsc) {
      const invisRe = new RegExp(`(?:^|\\n)\\s*${oldEsc}\\s*~~~\\s*${otherEsc}\\s*(?=\\n|$)`, 'm');
      const invisRe2 = new RegExp(`(?:^|\\n)\\s*${otherEsc}\\s*~~~\\s*${oldEsc}\\s*(?=\\n|$)`, 'm');
      if (invisRe.test(result)) {
        result = result.replace(invisRe, `\n${newTarget} ~~~ ${otherTarget}\n`);
        replaced = true;
      } else if (invisRe2.test(result)) {
        result = result.replace(invisRe2, `\n${otherTarget} ~~~ ${newTarget}\n`);
        replaced = true;
      }
    }
    if (!replaced) {
      result = result.replace(/\s+$/, '') + `\n${newTarget} ~~~ ${otherTarget}\n`;
    }
  }

  return result;
}

/** 替换节点的父节点：删除原有入边，建立 parentId --> nodeId */
export function setParent(source: string, nodeId: string, parentId: string): string {
  if (nodeId === parentId) return source;
  source = normalizeDiagram(source);
  let result = removeIncomingEdges(source, nodeId);
  result = addEdge(result, parentId, nodeId);
  return result;
}

/** 删除指定节点及其所有相关连线 */
export function deleteNode(source: string, nodeId: string): string {
  source = normalizeDiagram(source);
  const parsed = parseDiagram(source);
  const hasNode = parsed.nodes.some((n) => n.id === nodeId)
    || parsed.edges.some((e) => e.from === nodeId || e.to === nodeId);
  if (!hasNode) return source;

  // 记录入边源和出边目标，删除后把入边源连到出边目标
  const incomingSources = parsed.edges.filter((e) => e.to === nodeId).map((e) => e.from);
  const outgoingTargets = parsed.edges.filter((e) => e.from === nodeId).map((e) => e.to);

  const idEsc = nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = source.split('\n');
  const result: string[] = [];

  for (const rawLine of lines) {
    const [prefix, line] = splitDirPrefix(rawLine);
    if (/^\s*(%%|graph|flowchart|classDef|class|style|subgraph|end|direction|linkStyle)/.test(line)) {
      result.push(rawLine);
      continue;
    }
    const idRe = new RegExp(`(^|[^\\w-])${idEsc}([^\\w-]|$)`);
    if (!idRe.test(line)) {
      result.push(prefix + line);
      continue;
    }

    let modified = line;
    // 1. 链式边：X -->|标签? B(定义) --> Y → X --> Y
    modified = modified.replace(
      new RegExp(`-->\\s*(?:\\|[^|]*\\|\\s*)?${idEsc}[^\\n]*?-->`, 'g'),
      '-->',
    );
    // 2. 入边（B 为目标且无出边同行）：... -->|标签? B(定义) → 删到行尾
    modified = modified.replace(
      new RegExp(`\\s*-->\\s*(?:\\|[^|]*\\|\\s*)?${idEsc}.*$`),
      '',
    );
    // 3. 出边（B 为源且无入边同行）：B(定义) --> Y → 删到 --> 后
    modified = modified.replace(
      new RegExp(`^\\s*${idEsc}.*?-->\\s*`),
      '',
    );
    // 4. 孤立节点定义
    modified = modified.replace(
      new RegExp(`${idEsc}.*$`),
      '',
    );

    if (modified.trim()) {
      result.push(prefix + modified.trimEnd());
    } else if (prefix) {
      result.push(prefix.trimEnd());
    }
  }

  let newSource = result.join('\n').replace(/\n{3,}/g, '\n\n');

  // 5. 把入边源连到出边目标（删除节点后，原来经过该节点的路径需要接上）
  if (incomingSources.length > 0 && outgoingTargets.length > 0) {
    const afterDelete = parseDiagram(newSource);
    const existingEdges = new Set(afterDelete.edges.map((e) => `${e.from}-->${e.to}`));
    const additions: string[] = [];
    for (const from of incomingSources) {
      for (const to of outgoingTargets) {
        if (from === to) continue;
        const key = `${from}-->${to}`;
        if (!existingEdges.has(key)) {
          additions.push(`${from} --> ${to}`);
          existingEdges.add(key);
        }
      }
    }
    if (additions.length > 0) {
      newSource = newSource.replace(/\s+$/, '') + '\n' + additions.join('\n') + '\n';
    }
  }

  return newSource;
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

  // 记录当前页面滚动位置，写回后恢复（避免编辑后页面跳动）
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  const scrollEl = view?.contentEl;
  const scrollTop = scrollEl?.scrollTop ?? 0;
  const scrollLeft = scrollEl?.scrollLeft ?? 0;

  const content = await app.vault.read(file);
  const normContent = content.replace(/\r\n/g, '\n');
  const oldNorm = oldSource.replace(/\r\n/g, '\n').trim();

  // 支持 ``` 和 ~~~ 两种代码块标记，允许行首空格
  const blockRe = /^[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^[ \t]*\1/gm;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(normContent)) !== null) {
    blocks.push(m[2].replace(/\r\n/g, '\n').trim());
  }

  let replaced = false;
  let flowchartBlockIndex = blocks.findIndex((b) => /(flowchart|graph)\s+\w+/.test(b));

  const newContent = normContent.replace(blockRe, (full, marker: string, inner: string) => {
    if (replaced) return full;
    const innerNorm = inner.replace(/\r\n/g, '\n').trim();
    if (innerNorm === oldNorm) {
      replaced = true;
      const header = full.slice(0, full.indexOf('\n') + 1);
      return header + newSource.replace(/\n$/, '') + '\n' + marker;
    }
    return full;
  });

  if (!replaced && flowchartBlockIndex >= 0) {
    let idx = 0;
    const newContent2 = normContent.replace(blockRe, (full, marker: string, inner: string) => {
      const curIdx = idx++;
      if (curIdx === flowchartBlockIndex && !replaced) {
        replaced = true;
        const header = full.slice(0, full.indexOf('\n') + 1);
        return header + newSource.replace(/\n$/, '') + '\n' + marker;
      }
      return full;
    });
    if (replaced) {
      await app.vault.modify(file, newContent2);
      restoreScroll(scrollEl, scrollTop, scrollLeft);
      return true;
    }
  }

  if (!replaced) return false;
  await app.vault.modify(file, newContent);
  restoreScroll(scrollEl, scrollTop, scrollLeft);
  return true;
}

/** 延迟恢复页面滚动位置（等 Obsidian 重新渲染完成） */
function restoreScroll(scrollEl: HTMLElement | undefined, top: number, left: number): void {
  if (!scrollEl) return;
  const tryRestore = (delay: number) => {
    setTimeout(() => {
      scrollEl.scrollTop = top;
      scrollEl.scrollLeft = left;
    }, delay);
  };
  tryRestore(30);
  tryRestore(150); // 二次恢复，应对渲染较慢的情况
}
