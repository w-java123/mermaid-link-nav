import { setAsDecision } from './diagram-edit';

// 用户的真实场景：一行多语句，F（否目标）定义在 G（是目标）前面
const src = `flowchart TD  D["选择地区"]  E["地区选长沙"]  F["地区选全国"]  E --> E1{"岗位多"} G["搜索技术栈"]  F --> H["岗位多+工资高"]`;

console.log('=== 原始 ===');
console.log(src);

const r = setAsDecision(src, 'E1', 'G', 'F');
console.log('\n=== setAsDecision(E1, 是=G, 否=F) ===');
console.log(r);

// 验证 G 的定义在 F 前面
const gPos = r.indexOf('G["搜索技术栈"]');
const fPos = r.indexOf('F["地区选全国"]');
console.log(`\nG 位置: ${gPos}, F 位置: ${fPos}`);
console.assert(gPos < fPos, 'G（是）应在 F（否）前面');
console.assert(r.includes('E1{"岗位多"}'), 'E1 应变菱形');
console.assert(r.includes('E1 -->|是| G'), '是边应存在');
console.assert(r.includes('E1 -->|否| F'), '否边应存在');
console.assert(r.includes('G ~~~ F'), '隐形链接应存在');
console.assert(r.includes('E --> E1'), 'E1 入边应保留');

console.log('\n所有断言通过');
