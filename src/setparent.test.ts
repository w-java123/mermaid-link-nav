import { setParent, removeIncomingEdges } from './diagram-edit';

const source = `flowchart TD
  A["开始"]
  B["步骤一"]
  C["步骤二"]
  D["步骤三"]
  A --> B
  B --> C
  B --> D`;

// 测试：把 C 的父节点从 B 改成 A
const result = setParent(source, 'C', 'A');
console.log('=== 替换 C 的父节点为 A ===');
console.log(result);
console.assert(!result.includes('B --> C'), '原有入边 B --> C 应被删除');
console.assert(result.includes('A --> C'), '应新增 A --> C');
console.assert(result.includes('B --> D'), 'B --> D 应保留');
console.assert(result.includes('A --> B'), 'A --> B 应保留');

// 测试链式边
const chainSource = `flowchart TD
  A --> B --> C --> D`;
const chainResult = removeIncomingEdges(chainSource, 'B');
console.log('\n=== 链式边删除 B 的入边 ===');
console.log(chainResult);
console.assert(chainResult.includes('A --> C --> D'), '链式应变成 A --> C --> D');

console.log('\n所有断言通过');
