import assert from 'node:assert';
import { parseDiagram } from './parser';

let passed = 0;
function case1(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
}

// 1. 引号包裹 + 别名 + 圆角节点，多节点互不干扰
case1('quoted alias + rounded node', () => {
  const { code, links } = parseDiagram(
    'flowchart LR\n  A["[[首页|🏠 首页]]"] --> B("[[项目总览]]")\n',
  );
  assert.strictEqual(links.get('A')?.target, '首页');
  assert.strictEqual(links.get('A')?.displayText, '🏠 首页');
  assert.strictEqual(links.get('B')?.target, '项目总览');
  assert.strictEqual(links.get('B')?.displayText, '项目总览');
  assert.ok(!code.includes('[['), 'wikilink 必须被替换掉');
});

// 2. 标题锚点 + 别名，六边形
case1('heading anchor with alias', () => {
  const { links } = parseDiagram('C{{"[[架构设计#数据库模块|数据库设计]]"}}');
  assert.strictEqual(links.get('C')?.target, '架构设计#数据库模块');
  assert.strictEqual(links.get('C')?.displayText, '数据库设计');
});

// 3. 路径取 basename 显示
case1('folder path shows basename', () => {
  const { links } = parseDiagram('D["[[folder/sub/note]]"]');
  assert.strictEqual(links.get('D')?.target, 'folder/sub/note');
  assert.strictEqual(links.get('D')?.displayText, 'note');
});

// 4. 当前笔记内标题跳转
case1('same-file heading', () => {
  const { links } = parseDiagram('E["[[#章节一]]"]');
  assert.strictEqual(links.get('E')?.target, '#章节一');
});

// 5. 非引号简单写法（圆/子程序形状）
case1('unquoted simple shapes', () => {
  const { links } = parseDiagram('A([[首页]]) --> B{{[[会议纪要]]}}');
  assert.strictEqual(links.get('A')?.target, '首页');
  assert.strictEqual(links.get('B')?.target, '会议纪要');
});

// 6. 连线标签里的 wikilink 不应绑定为节点链接，但要被替换显示
case1('edge label wikilink not treated as node', () => {
  const { code, links } = parseDiagram('A["[[a]]"] -->|连接 [[b|B站]]| C["[[c]]"]');
  assert.strictEqual(links.size, 2);
  assert.ok(links.has('A') && links.has('C'));
  assert.ok(code.includes('B站'));
  assert.ok(!code.includes('[['));
});

// 7. 注释行不解析
case1('comment line ignored', () => {
  const { links } = parseDiagram('%% A["[[x]]"]\nA["[[real]]"]');
  assert.strictEqual(links.size, 1);
  assert.strictEqual(links.get('A')?.target, 'real');
});

// 8. 节点文本中夹带链接
case1('link mixed with other text', () => {
  const { links } = parseDiagram('A["流程 [[note|详情]] 末尾"]');
  assert.strictEqual(links.get('A')?.target, 'note');
  assert.strictEqual(links.get('A')?.displayText, '流程 详情 末尾');
});

// 9. 多节点连续定义，claimed 区间不能吞掉后续节点
case1('many sequential nodes', () => {
  const src = ['flowchart TD', 'A["[[a]]"]-->B["[[b]]"]', 'C["[[c]]"]-->D["[[d]]"]', 'E["[[e]]"]'].join('\n');
  const { links } = parseDiagram(src);
  for (const id of ['A', 'B', 'C', 'D', 'E']) assert.ok(links.has(id), `${id} 应被识别`);
});

// 10. 没有链接的普通图正常透传
case1('plain diagram passthrough', () => {
  const src = 'flowchart LR\nA[开始]-->B{判断?}\nB--是-->C[结束]';
  const { code, links } = parseDiagram(src);
  assert.strictEqual(links.size, 0);
  assert.strictEqual(code, src);
});

// 11. 菱形/圆形/圆柱/旗帜形状
case1('all shape kinds', () => {
  const src = [
    'A{{"[[a]]"}}',
    'B(("[[b]]"))',
    'C[("[[c]]")]',
    'D>"[[d]]"]',
  ].join('\n');
  const { links } = parseDiagram(src);
  assert.deepStrictEqual([...links.keys()].sort(), ['A', 'B', 'C', 'D']);
});

// 12. 基础有向边
case1('basic directed edges', () => {
  const { edges } = parseDiagram('flowchart TD\nA-->B\nB-->C');
  assert.deepStrictEqual(edges, [
    { from: 'A', to: 'B', directed: true },
    { from: 'B', to: 'C', directed: true },
  ]);
});

// 13. 链式 + 无向连线
case1('chained and undirected edges', () => {
  const { edges } = parseDiagram('A-->B-->C\nA---D');
  assert.strictEqual(edges.length, 3);
  assert.ok(edges.some((e) => e.from === 'A' && e.to === 'B' && e.directed));
  assert.ok(edges.some((e) => e.from === 'B' && e.to === 'C' && e.directed));
  const und = edges.find((e) => e.from === 'A' && e.to === 'D')!;
  assert.ok(und && !und.directed);
});

// 14. 连线标签（|...| 与 -- text -->）与各种箭头
case1('edge labels and arrow kinds', () => {
  const { edges } = parseDiagram('A-->|是| B\nB-.否.->C\nC == text ==> D\nD -.-> E');
  const pairs = edges.map((e) => `${e.from}${e.to}`).sort();
  assert.deepStrictEqual(pairs, ['AB', 'BC', 'CD', 'DE']);
  assert.ok(edges.every((e) => e.directed));
});

// 15. & 多节点连接 + 行内形状不干扰
case1('ampersand fan-out with shapes', () => {
  const { edges } = parseDiagram('A["[[x|开始]]"] --> B & C("y") & D{{z}}');
  const tos = edges.map((e) => e.to).sort();
  assert.deepStrictEqual(tos, ['B', 'C', 'D']);
  assert.ok(edges.every((e) => e.from === 'A'));
});

// 16. class/style/subgraph 行不应产生边
case1('non-edge statements skipped', () => {
  const src = 'classDef c fill:#f00\nclass A c\nstyle B fill:#eee\nsubgraph S1\n  A-->B\nend\nlinkStyle 0 stroke:red';
  const { edges } = parseDiagram(src);
  assert.strictEqual(edges.length, 1);
  assert.deepStrictEqual(edges[0], { from: 'A', to: 'B', directed: true });
});

console.log(`\n全部 ${passed} 个用例通过`);
