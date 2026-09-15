import { setAsDecision, removeOutgoingEdges, addLabeledEdge } from './diagram-edit';

const source = `flowchart TD
  A["开始"]
  B{"判断?"}
  C["是分支"]
  D["否分支"]
  A --> B
  B --> C`;

// 测试 setAsDecision：B 设为判断节点，是->C，否->D
const result = setAsDecision(source, 'B', 'C', 'D');
console.log('=== 设置 B 为判断节点 ===');
console.log(result);
console.assert(result.includes('B{"判断?"}'), 'B 应为菱形');
console.assert(result.includes('B -->|是| C'), '应有 是 边');
console.assert(result.includes('B -->|否| D'), '应有 否 边');
console.assert(!result.includes('B --> C\n'), '原有出边应删除');
console.assert(result.includes('A --> B'), '入边应保留');

// 测试 removeOutgoingEdges 保留节点定义
const source2 = `flowchart TD
  F["名称"] --> C
  C["结束"]`;
const result2 = removeOutgoingEdges(source2, 'F');
console.log('\n=== 删除 F 的出边（节点定义同行）===');
console.log(result2);
console.assert(result2.includes('F["名称"]'), 'F 定义应保留');
console.assert(!result2.includes('F["名称"] --> C'), '出边应删除');

// 测试 addLabeledEdge
const source3 = `flowchart TD
  A["甲"]
  B["乙"]`;
const result3 = addLabeledEdge(source3, 'A', 'B', '是');
console.log('\n=== 添加带标签边 ===');
console.log(result3);
console.assert(result3.includes('A -->|是| B'), '带标签边应存在');

console.log('\n所有断言通过');
