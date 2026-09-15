/**
 * Mermaid 源码解析：
 * 1. 找出所有 [[wikilink]]（支持 [[笔记]]、[[笔记#标题]]、[[笔记|别名]]、[[#本页标题]]）
 * 2. 找出 flowchart 节点定义（A[...] / A(...) / A{{...}} / A((...)) 等全部形状），
 *    建立「节点 id -> 链接目标」映射
 * 3. 把源码中的 wikilink 替换为显示文本，得到可以交给 mermaid 渲染的干净源码
 */

export interface WikilinkHit {
  start: number;
  end: number;
  /** 跳转目标 linktext，例如 "folder/note"、"note#heading"、"#heading" */
  target: string;
  /** 节点上展示的文字 */
  display: string;
}

export interface NodeLink {
  id: string;
  target: string;
  /** 替换 wikilink 后的节点标签（用于 data-id 缺失时按文本兜底匹配） */
  displayText: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  /** 带箭头为有向边；--- 这类无箭头连线视为无向（双向可达） */
  directed: boolean;
}

export interface ParsedDiagram {
  code: string;
  links: Map<string, NodeLink>;
  edges: FlowEdge[];
}

/** [[路径#标题|别名]]，路径与标题均可为空（[[#标题]] 表示当前笔记内跳转） */
const WIKILINK_RE = /\[\[([^\]|#]*)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

/** 节点形状定义：开括号 -> 可能的闭括号（按长度优先匹配） */
const SHAPES: { opener: string; closers: string[] }[] = [
  { opener: '[[', closers: [']]'] },
  { opener: '[(', closers: [')]'] },
  { opener: '((', closers: ['))'] },
  { opener: '{{', closers: ['}}'] },
  { opener: '[/', closers: ['/]', '\\]'] },
  { opener: '[\\', closers: ['\\]', '/]'] },
  { opener: '[', closers: [']'] },
  { opener: '(', closers: [')'] },
  { opener: '{', closers: ['}'] },
  { opener: '>', closers: [']'] },
];

/** 候选节点：节点 id + 形状开括号 */
const NODE_RE = /(?:^|[^\w])([A-Za-z_][\w-]*)\s*(\[\[|\[\(|\(\(|\{\{|\[\/|\[\\|[\[\(\{>])/g;

const COMMENT_RE = /%%[^\n]*/g;

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

export function collectWikilinks(code: string): WikilinkHit[] {
  const hits: WikilinkHit[] = [];
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(code)) !== null) {
    const path = (m[1] ?? '').trim();
    const hash = (m[2] ?? '').trim();
    const alias = m[3];
    const target = path + hash;
    const display = alias !== undefined ? alias : basename(path) + hash;
    hits.push({ start: m.index, end: m.index + m[0].length, target, display });
  }
  return hits;
}

function rangeContains(ranges: Array<[number, number]>, pos: number): boolean {
  return ranges.some(([a, b]) => pos >= a && pos < b);
}

function hitAt(hits: WikilinkHit[], pos: number): WikilinkHit | undefined {
  return hits.find((h) => pos >= h.start && pos < h.end);
}

/** 从 from 开始寻找最早出现的任一 closer（跳过 wikilink 区间） */
function findClosers(
  code: string,
  from: number,
  closers: string[],
  hits: WikilinkHit[],
): number {
  for (let i = from; i < code.length; ) {
    const hit = hitAt(hits, i);
    if (hit) {
      // 处理外层形状括号与 wikilink 括号共用一个字符的情况，如 A[[[x]]]
      const overlap = hit.end - 1;
      if (closers.some((c) => code.startsWith(c, overlap))) return overlap;
      i = hit.end;
      continue;
    }
    if (closers.some((c) => code.startsWith(c, i))) return i;
    i++;
  }
  return -1;
}

/** 把一段标签文本中的 wikilink 全部替换为显示文本 */
function replaceWikilinks(text: string, hits: WikilinkHit[], base: number): string {
  let out = '';
  let last = 0;
  for (const h of hits) {
    const s = h.start - base;
    const e = h.end - base;
    if (s < last || e > text.length) continue;
    out += text.slice(last, s) + h.display;
    last = e;
  }
  out += text.slice(last);
  return out;
}

export function normalizeLabel(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function parseDiagram(code: string): ParsedDiagram {
  // 1. 注释 / %%{init}%% 指令区间
  const comments: Array<[number, number]> = [];
  COMMENT_RE.lastIndex = 0;
  let cm: RegExpExecArray | null;
  while ((cm = COMMENT_RE.exec(code)) !== null) {
    comments.push([cm.index, cm.index + cm[0].length]);
  }

  const hits = collectWikilinks(code);
  const links = new Map<string, NodeLink>();
  const claimed: Array<[number, number]> = [];

  // 2. 扫描所有节点形状
  NODE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NODE_RE.exec(code)) !== null) {
    const matchStart = m.index + m[0].indexOf(m[1]!);
    if (rangeContains(comments, m.index) || rangeContains(claimed, matchStart)) continue;

    const id = m[1]!;
    const token = m[2]!;
    const shape = SHAPES.find((s) => s.opener === token);
    if (!shape) continue;
    // 整个匹配以开括号结尾，因此匹配末尾即标签起点
    const openerEnd = m.index + m[0].length;

    // 跳过空白，判断是否为引号包裹的标签
    let p = openerEnd;
    while (p < code.length && /\s/.test(code[p]!)) p++;
    let labelStart = p;
    let labelEnd = -1;
    let shapeEnd = -1;

    if (code[p] === '"') {
      labelStart = p + 1;
      let q = labelStart;
      while (q < code.length && code[q] !== '"') {
        const hit = hitAt(hits, q);
        if (hit) q = hit.end;
        else q++;
      }
      labelEnd = q; // 不含闭合引号
      let c = q + 1;
      while (c < code.length && /\s/.test(code[c]!) ) c++;
      const closer = shape.closers.find((cl) => code.startsWith(cl, c));
      if (!closer) continue;
      shapeEnd = c + closer.length;
    } else {
      const closeStart = findClosers(code, labelStart, shape.closers, hits);
      if (closeStart < 0) continue;
      labelEnd = closeStart;
      const closer = shape.closers.find((cl) => code.startsWith(cl, closeStart))!;
      shapeEnd = closeStart + closer.length;
    }

    claimed.push([matchStart, shapeEnd]);

    // wikilink 起点落在该节点标签区间内即归属该节点，第一个作为跳转目标
    const inside = hits.filter((h) => h.start >= labelStart && h.start < shapeEnd);
    if (inside.length > 0 && !links.has(id)) {
      const rawLabel = code.slice(labelStart, labelEnd);
      const displayText = normalizeLabel(replaceWikilinks(rawLabel, inside, labelStart));
      links.set(id, { id, target: inside[0]!.target, displayText });
    }
    NODE_RE.lastIndex = shapeEnd;
  }

  // 3. 全局替换 wikilink 为显示文本（连线标签里的也替换，保证 mermaid 语法不被破坏）
  let out = '';
  let last = 0;
  for (const h of hits) {
    out += code.slice(last, h.start) + h.display;
    last = h.end;
  }
  out += code.slice(last);

  const edges = extractEdges(code);

  return { code: out, links, edges };
}

/* ---------------- 边（连线）解析，用于双击聚焦 ---------------- */

const SKIP_STATEMENT_RE =
  /^\s*(graph|flowchart|classDef|class|style|linkStyle|interpolate|direction|subgraph|end|click|callback|init|theme|acc|title|section|%%)\b/;

/** 箭头 token：-- --- --> ==> -.-> -.- 等，返回是否有向 */
const ARROW_RE = /-{2,}>?|={2,}>?|-\.-?>?/g;

/** 取一个片段开头的节点 id */
const LEADING_ID_RE = /^\s*([A-Za-z_][\w-]*)/;

/**
 * 从 mermaid 源码提取有向/无向边。
 * 支持：链式 A-->B-->C、& 多连、-->|标签|、-- text -->、各类箭头、行内形状。
 */
export function extractEdges(code: string): FlowEdge[] {
  const edges: FlowEdge[] = [];
  const statements = code.split(/[;\n]/);

  for (let raw of statements) {
    if (SKIP_STATEMENT_RE.test(raw)) continue;

    let line = raw;
    // wikilink 整体抹掉（其文本在节点标签内，不影响连线结构）
    line = line.replace(WIKILINK_RE, ' ');
    // 去掉引号标签
    line = line.replace(/"[^"]*"/g, ' ');
    // 去掉 |...| 连线标签
    line = line.replace(/\|[^|]*\|/g, ' ');
    // -- text --> / == text ==> / -. text .-> 形式的行内标签
    line = line.replace(/-\.[^.]*?\.->/g, '-.->');
    line = line.replace(/-\.[^.]*?\.-/g, '-.-');
    line = line.replace(/(--|==)\s+[^-=|>][^|]*?\s*\1>?/g, (m) => (m.includes('>') ? m.slice(0, 2) + '>' : m.slice(0, 2)));
    // 去掉节点形状及其内部文本（去引号后剩余的）
    line = line.replace(/\[\([^\])]*\)\]/g, ' ');
    line = line.replace(/[\[\(\{][^\]\)\}]*[\]\)\}]/g, ' ');

    // 按箭头切分，记录每段之间是否有向
    const terms: { text: string; directed: boolean }[] = [];
    let lastEnd = 0;
    let m: RegExpExecArray | null;
    ARROW_RE.lastIndex = 0;
    while ((m = ARROW_RE.exec(line)) !== null) {
      terms.push({ text: line.slice(lastEnd, m.index), directed: m[0].includes('>') });
      lastEnd = m.index + m[0].length;
    }
    if (terms.length === 0) continue;
    terms.push({ text: line.slice(lastEnd), directed: false });

    // 每段可能是 A & B 形式的多节点集合
    const groups = terms.map((t) =>
      t.text
        .split('&')
        .map((s) => LEADING_ID_RE.exec(s)?.[1] ?? '')
        .filter(Boolean),
    );
    for (let i = 0; i < groups.length - 1; i++) {
      const directed = terms[i + 1]!.directed || terms[i]!.directed;
      for (const u of groups[i]!) {
        for (const v of groups[i + 1]!) {
          if (u === v) continue;
          edges.push({ from: u, to: v, directed });
        }
      }
    }
  }

  return edges;
}
