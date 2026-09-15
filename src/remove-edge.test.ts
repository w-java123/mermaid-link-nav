import { removeIncomingEdges, removeOutgoingEdges } from './diagram-edit';

// 关键测试：入边和节点定义同行
const source1 = `flowchart TD
  C["上游"]
  D["地区选全国"]
  C --> D["地区选全国"]`;
const result1 = removeIncomingEdges(source1, 'D');
console.log('=== 删除 D 的入边（入边+定义同行）===');
console.log(result1);
console.assert(result1.includes('D["地区选全国"]'), 'D 的节点定义应完整保留');
console.assert(!result1.includes('C --> D'), '入边应删除');
console.assert(!result1.includes('C ["地区选全国"]'), '不应出现 C 和 D 标签混合');

// 出边和节点定义同行
const source2 = `flowchart TD
  F["名称"]
  G["下游"]
  F["名称"] --> G`;
const result2 = removeOutgoingEdges(source2, 'F');
console.log('\n=== 删除 F 的出边（出边+定义同行）===');
console.log(result2);
console.assert(result2.includes('F["名称"]'), 'F 的节点定义应保留');
console.assert(!result2.includes('F["名称"] --> G'), '出边应删除');

// 纯边行
const source3 = `flowchart TD
  A["甲"]
  B["乙"]
  A --> B`;
const result3 = removeIncomingEdges(source3, 'B');
console.log('\n=== 删除 B 的入边（纯边行）===');
console.log(result3);
console.assert(!result3.includes('A --> B'), '入边应删除');
console.assert(result3.includes('A["甲"]'), 'A 定义保留');
console.assert(result3.includes('B["乙"]'), 'B 定义保留');

console.log('\n所有断言通过');
