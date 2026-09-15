import { setAsDecision } from './diagram-edit';

// 场景1：否目标定义前有入边（F --> I["定义"]），插入是目标不应产生意外边
const src1 = `flowchart TD  D["选择地区"] --> E["地区选长沙"]  F["地区选全国"] --> I["转Java"]  E --> E1{"判断"} G["搜索技术栈"]`;
console.log('=== 场景1：否目标前有入边 ===');
const r1 = setAsDecision(src1, 'E1', 'G', 'I');
console.log(r1);
console.assert(!r1.includes('F --> G'), '不应产生意外边 F --> G');
console.assert(r1.includes('G["搜索技术栈"]'), 'G 定义应保留');
console.assert(r1.includes('I["转Java"]'), 'I 定义应保留');
console.assert(r1.includes('E1 -->|是| G'), '是边应存在');
console.assert(r1.includes('E1 -->|否| I'), '否边应存在');
const gPos1 = r1.indexOf('G["搜索技术栈"]');
const iPos1 = r1.indexOf('I["转Java"]');
console.assert(gPos1 < iPos1, `G 应在 I 前面 (G=${gPos1}, I=${iPos1})`);

// 场景2：否目标定义前无入边，是目标直接插到否目标前面
const src2 = `flowchart TD  D["选择地区"]  F["地区选全国"]  E --> E1{"判断"} G["搜索技术栈"]`;
console.log('\n=== 场景2：否目标前无入边 ===');
const r2 = setAsDecision(src2, 'E1', 'G', 'F');
console.log(r2);
console.assert(r2.includes('G["搜索技术栈"] F["地区选全国"]'), 'G 应在 F 前面');
console.assert(!r2.includes('D --> G'), '不应产生意外边 D --> G');

console.log('\n所有断言通过');
