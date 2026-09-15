/**
 * 双击聚焦的纯图算法：
 * 给定边集合和聚焦节点，算出需要保留的节点集合与边集合。
 * 保留范围 = 聚焦节点的全部后代 + （可选）能到达它的全部祖先链。
 */
import type { FlowEdge } from './parser';

export interface FocusGraph {
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
}

export interface FocusSubset {
  nodes: Set<string>;
  edges: Set<string>; // "from->to"
}

export function buildGraph(edges: FlowEdge[]): FocusGraph {
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();

  const add = (map: Map<string, Set<string>>, a: string, b: string): void => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  };

  for (const e of edges) {
    add(outgoing, e.from, e.to);
    add(incoming, e.to, e.from);
    if (!e.directed) {
      // 无向连线双向可达
      add(outgoing, e.to, e.from);
      add(incoming, e.from, e.to);
    }
  }

  const toList = (m: Map<string, Set<string>>): Map<string, string[]> => {
    const r = new Map<string, string[]>();
    for (const [k, v] of m) r.set(k, [...v]);
    return r;
  };

  return { outgoing: toList(outgoing), incoming: toList(incoming) };
}

function bfs(start: string, adj: Map<string, string[]>): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

export const edgeKey = (from: string, to: string): string => `${from}->${to}`;

/**
 * @param includeAncestors 是否保留祖先链（上游路径）
 */
export function focusSubset(
  graph: FocusGraph,
  edges: FlowEdge[],
  focusId: string,
  includeAncestors: boolean,
): FocusSubset {
  const descendants = bfs(focusId, graph.outgoing); // 含 focusId
  const ancestors = includeAncestors ? bfs(focusId, graph.incoming) : new Set([focusId]);

  const nodes = new Set<string>(descendants);
  for (const a of ancestors) nodes.add(a);

  const subTree = descendants; // 聚焦节点及其下游
  const ancChain = ancestors; // 祖先（含聚焦节点自身）

  const keptEdges = new Set<string>();
  for (const e of edges) {
    if (!nodes.has(e.from) || !nodes.has(e.to)) continue;
    const inSub = subTree.has(e.from) && subTree.has(e.to);
    const inAnc = ancChain.has(e.from) && ancChain.has(e.to);
    if (inSub || inAnc) keptEdges.add(edgeKey(e.from, e.to));
    // 无向边反向 key 也算保留
    if (!e.directed && (inSub || inAnc)) keptEdges.add(edgeKey(e.to, e.from));
  }

  return { nodes, edges: keptEdges };
}
