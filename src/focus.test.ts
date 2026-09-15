import assert from 'node:assert';
import { buildGraph, edgeKey, focusSubset } from './focus';
import type { FlowEdge } from './parser';

let passed = 0;
function case1(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
}
const e = (from: string, to: string, directed = true): FlowEdge => ({ from, to, directed });

// 树形图：R->A->A1,A2；R->B->B1
const tree = [e('R', 'A'), e('A', 'A1'), e('A', 'A2'), e('R', 'B'), e('B', 'B1')];

case1('focus keeps ancestors and descendants', () => {
  const g = buildGraph(tree);
  const sub = focusSubset(g, tree, 'A', true);
  assert.deepStrictEqual([...sub.nodes].sort(), ['A', 'A1', 'A2', 'R']);
  assert.ok(sub.edges.has(edgeKey('R', 'A')));
  assert.ok(sub.edges.has(edgeKey('A', 'A1')));
  assert.ok(!sub.edges.has(edgeKey('R', 'B')));
});

case1('focus without ancestors only subtree', () => {
  const g = buildGraph(tree);
  const sub = focusSubset(g, tree, 'A', false);
  assert.deepStrictEqual([...sub.nodes].sort(), ['A', 'A1', 'A2']);
  assert.ok(!sub.edges.has(edgeKey('R', 'A')));
});

case1('focus root keeps whole tree', () => {
  const g = buildGraph(tree);
  const sub = focusSubset(g, tree, 'R', true);
  assert.strictEqual(sub.nodes.size, 6);
  assert.strictEqual(sub.edges.size, 5);
});

// 菱形合流：X->M, Y->M, M->Z；聚焦 M 时祖先 X、Y 都保留
case1('diamond merge keeps both parents', () => {
  const dag = [e('X', 'M'), e('Y', 'M'), e('M', 'Z')];
  const g = buildGraph(dag);
  const sub = focusSubset(g, dag, 'M', true);
  assert.deepStrictEqual([...sub.nodes].sort(), ['M', 'X', 'Y', 'Z']);
  assert.ok(sub.edges.has(edgeKey('X', 'M')));
  assert.ok(sub.edges.has(edgeKey('Y', 'M')));
});

// 无向边双向可达
case1('undirected edge traversable both ways', () => {
  const g = buildGraph([e('A', 'B', false), e('B', 'C', true)]);
  const sub = focusSubset(g, [e('A', 'B', false), e('B', 'C', true)], 'B', false);
  assert.ok(sub.nodes.has('A'));
  assert.ok(sub.nodes.has('C'));
});

console.log(`\n聚焦算法全部 ${passed} 个用例通过`);
