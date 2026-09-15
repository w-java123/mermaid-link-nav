import { setAsDecision } from './diagram-edit';

// G 有定义，设置判断节点后名称不应丢失
const src = `flowchart TD  D["选择地区"] --> E["地区选长沙"]  F["地区选全国"]  E --> E1["判断"]  E1 --> G["搜索技术栈"]  G --> K["学习"]`;

console.log('=== 原始（G有定义）===');
console.log(src);

const r = setAsDecision(src, 'E1', 'G', 'F');
console.log('\n=== setAsDecision 后 ===');
console.log(r);

console.assert(r.includes('G["搜索技术栈"]'), 'G 的名称应保留，不能变成 G["G"]');
console.assert(r.includes('E1{"判断"}'), 'E1 应变菱形');
const gPos = r.indexOf('G["搜索技术栈"]');
const fPos = r.indexOf('F["地区选全国"]');
console.log(`G 位置: ${gPos}, F 位置: ${fPos}`);
console.assert(gPos < fPos, 'G（是）应在 F（否）前面');
console.assert(r.includes('E1 -->|是| G'), '是边应存在');
console.assert(r.includes('E1 -->|否| F'), '否边应存在');

console.log('\n所有断言通过');
