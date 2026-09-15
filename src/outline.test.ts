/** outlineToMermaid / sanitizeLabel 纯函数测试（node 下运行，不依赖 Obsidian） */
import assert from 'node:assert';
import { outlineToMermaid, sanitizeLabel, type OutlineNode } from './outline';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

function node(id: string, text: string, line: number, kind: OutlineNode['kind'], children: OutlineNode[] = []): OutlineNode {
  return { id, text, line, level: 0, kind, children };
}

test('sanitizeLabel: wikilink 取别名', () => {
  assert.strictEqual(sanitizeLabel('详见[[架构设计|架构]]文档'), '详见架构文档');
});
test('sanitizeLabel: wikilink 无别名取笔记名', () => {
  assert.strictEqual(sanitizeLabel('[[folder/部署手册]]'), '部署手册');
});
test('sanitizeLabel: 引号与 markdown 标记被清理', () => {
  assert.strictEqual(sanitizeLabel('a**b**"c" `d`'), "ab'c' d");
});
test('sanitizeLabel: 空文本占位', () => {
  assert.strictEqual(sanitizeLabel('   '), '（空）');
});

test('outlineToMermaid: 根节点 + 层级边 + 行号映射', () => {
  const tree = [
    node('n1', '需求分析', 0, 'h1', [
      node('n2', '调研竞品', 1, 'bullet', [node('n3', '竞品A', 2, 'bullet')]),
      node('n4', '方案设计', 4, 'h2'),
    ]),
  ];
  const d = outlineToMermaid(tree, '项目总览', 'TB');
  assert.ok(d.code.startsWith('flowchart TD'), d.code);
  assert.ok(d.code.includes('n0(["项目总览"])'));
  assert.ok(d.code.includes('n1["需求分析"]'));
  assert.ok(d.code.includes('n2("调研竞品")')); // bullet 圆角
  assert.ok(d.code.includes('n0 --> n1'));
  assert.ok(d.code.includes('n1 --> n2'));
  assert.ok(d.code.includes('n2 --> n3'));
  assert.ok(d.code.includes('n1 --> n4'));
  assert.deepStrictEqual(Object.fromEntries(d.lines), { n0: 0, n1: 0, n2: 1, n3: 2, n4: 4 });
  const edgePairs = d.edges.map((e) => `${e.from}>${e.to}`);
  assert.deepStrictEqual(edgePairs, ['n0>n1', 'n1>n2', 'n2>n3', 'n1>n4']);
  assert.ok(d.edges.every((e) => e.directed));
});

test('outlineToMermaid: LR 方向', () => {
  const d = outlineToMermaid([node('n1', 'x', 0, 'h1')], 'r', 'LR');
  assert.ok(d.code.startsWith('flowchart LR'));
});

test('outlineToMermaid: 标签中的特殊字符不会破坏语法', () => {
  const d = outlineToMermaid([node('n1', 'a"b\nc', 0, 'h1')], 'r');
  assert.ok(!d.code.includes('"a"b'), d.code);
  assert.ok(d.code.includes("n1[\"a'b c\"]"));
});

console.log(`\n${passed} outline tests passed`);
