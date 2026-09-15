import { removeIncomingEdges, removeOutgoingEdges, setAsDecision } from './diagram-edit';

// 关键测试：一行多语句（用户的真实场景）
const src = `flowchart TD  E["地区选长沙"]  D["地区选全国"]  E --> E1["岗位多"]  E1 --> G["搜索技术栈"]`;

console.log('=== 原始源码 ===');
console.log(src);

// 删除 E1 的出边（设置判断节点时会调用）
const r1 = removeOutgoingEdges(src, 'E1');
console.log('\n=== 删除 E1 出边后 ===');
console.log(r1);
console.assert(r1.includes('E1["岗位多"]'), 'E1 定义应保留');
console.assert(r1.includes('G["搜索技术栈"]'), 'G 定义应保留');
console.assert(r1.includes('E --> E1'), 'E1 的入边应保留');
console.assert(!r1.includes('E1 --> G'), 'E1 的出边应删除');

// 设置 E1 为判断节点，是=G，否=D
const r2 = setAsDecision(src, 'E1', 'G', 'D');
console.log('\n=== setAsDecision(E1, G, D) ===');
console.log(r2);
console.assert(r2.includes('E1{"岗位多"}'), 'E1 应变菱形且保留名称');
console.assert(r2.includes('G["搜索技术栈"]'), 'G 名称应保留');
console.assert(r2.includes('D["地区选全国"]'), 'D 名称应保留');
console.assert(r2.includes('E --> E1'), 'E1 入边应保留');
console.assert(r2.includes('E1 -->|是| G'), '是边应存在');
console.assert(r2.includes('E1 -->|否| D'), '否边应存在');
console.assert(r2.includes('G ~~~ D'), '隐形链接应存在');

// 普通多行场景
const src2 = `flowchart TD
  A["甲"]
  B["乙"]
  A --> B`;
const r3 = removeIncomingEdges(src2, 'B');
console.log('\n=== 多行删除入边 ===');
console.log(r3);
console.assert(!r3.includes('A --> B'), '入边应删除');

console.log('\n所有断言通过');
