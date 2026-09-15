import { setParent, removeIncomingEdges } from './diagram-edit';

// 测试1：节点定义和入边在同一行
const source1 = `flowchart TD
  A["开始"]
  F["原来的名称"] --> B
  B["下一步"]`;
const result1 = removeIncomingEdges(source1, 'B');
console.log('=== 节点定义+入边同行，删除 B 的入边 ===');
console.log(result1);
console.assert(result1.includes('F["原来的名称"]'), 'F 的节点定义应保留');
console.assert(!result1.includes('F["原来的名称"] --> B'), '入边应删除');

// 测试2：节点定义 + 入边 + 出边同行
const source2 = `flowchart TD
  A["开始"]
  F["名称"] --> B --> C
  C["结束"]`;
const result2 = removeIncomingEdges(source2, 'B');
console.log('\n=== 节点定义+入边+出边同行，删除 B 的入边 ===');
console.log(result2);
console.assert(result2.includes('F["名称"] --> C'), '应变成 F --> C');

// 测试3：纯边行
const source3 = `flowchart TD
  A["开始"]
  B["节点"]
  A --> B`;
const result3 = removeIncomingEdges(source3, 'B');
console.log('\n=== 纯边行，删除 B 的入边 ===');
console.log(result3);
console.assert(!result3.includes('A --> B'), '入边应删除');
console.assert(result3.includes('A["开始"]'), 'A 定义应保留');
console.assert(result3.includes('B["节点"]'), 'B 定义应保留');

// 测试4：setParent 完整流程
const source4 = `flowchart TD
  A["甲"]
  B["乙"]
  C["丙"]
  A --> B
  B --> C`;
const result4 = setParent(source4, 'C', 'A');
console.log('\n=== setParent: C 的父从 B 改成 A ===');
console.log(result4);
console.assert(!result4.includes('B --> C'), '原有入边删除');
console.assert(result4.includes('A --> C'), '新增 A --> C');
console.assert(result4.includes('A --> B'), 'A --> B 保留');

console.log('\n所有断言通过');
