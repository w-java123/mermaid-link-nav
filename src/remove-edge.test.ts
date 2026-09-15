import { removeIncomingEdges, removeOutgoingEdges, setAsDecision } from './diagram-edit';

// 1. 入边+源节点定义同行：C["名称"] --> D
const r1 = removeIncomingEdges('flowchart TD\n  C["上游"]\n  D["下游"]\n  C["上游"] --> D', 'D');
console.log('=== 入边+源定义同行 ===');
console.log(r1);
console.assert(r1.includes('C["上游"]'), 'C 定义应保留');
console.assert(r1.includes('D["下游"]'), 'D 定义应保留');
console.assert(!r1.includes('C["上游"] --> D'), '入边应删除');

// 2. 出边+目标节点定义同行：D --> E["名称"]
const r2 = removeOutgoingEdges('flowchart TD\n  D["判断"]\n  E["是分支"]\n  D --> E["是分支"]', 'D');
console.log('\n=== 出边+目标定义同行 ===');
console.log(r2);
console.assert(r2.includes('D["判断"]'), 'D 定义应保留');
console.assert(r2.includes('E["是分支"]'), 'E 定义应保留');
console.assert(!r2.includes('D --> E'), '出边应删除');

// 3. setAsDecision 完整流程，目标名称不丢失
const src3 = `flowchart TD
  D{"判断?"}
  E["是分支"]
  F["否分支"]
  D --> E["是分支"]
  D --> F["否分支"]`;
const r3 = setAsDecision(src3, 'D', 'E', 'F');
console.log('\n=== setAsDecision ===');
console.log(r3);
console.assert(r3.includes('E["是分支"]'), 'E 名称应保留');
console.assert(r3.includes('F["否分支"]'), 'F 名称应保留');
console.assert(r3.includes('D -->|是| E'), '是边应存在');
console.assert(r3.includes('D -->|否| F'), '否边应存在');
console.assert(r3.includes('E ~~~ F'), '隐形链接应存在');

// 4. 纯边行
const r4 = removeIncomingEdges('flowchart TD\n  A["甲"]\n  B["乙"]\n  A --> B', 'B');
console.log('\n=== 纯入边行 ===');
console.log(r4);
console.assert(!r4.includes('A --> B'), '入边应删除');
console.assert(r4.includes('A["甲"]') && r4.includes('B["乙"]'), '定义应保留');

console.log('\n所有断言通过');
