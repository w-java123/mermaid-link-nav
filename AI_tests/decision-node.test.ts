/**
 * 测试：设置判断节点后
 * 1. 是目标有定义时名称不丢失
 * 2. 是目标无定义时自动补定义
 * 3. 是目标定义在否目标前面（是在左否在右）
 * 4. 不产生意外边
 */
import { setAsDecision } from '../src/diagram-edit';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

// 场景1：是目标有定义，名称不应丢失
console.log('\n=== 场景1：是目标有定义 ===');
const src1 = `flowchart TD  D["选择地区"] --> E["地区选长沙"]  F["地区选全国"]  E --> E1["判断"]  E1 --> G["搜索技术栈"]  G --> K["学习"]`;
const r1 = setAsDecision(src1, 'E1', 'G', 'F');
console.log(r1);
assert(r1.includes('G["搜索技术栈"]'), 'G 的名称"搜索技术栈"应保留');
assert(r1.includes('E1{"判断"}'), 'E1 应变菱形');
assert(r1.indexOf('G["搜索技术栈"]') < r1.indexOf('F["地区选全国"]'), 'G（是）应在 F（否）前面');
assert(r1.includes('E1 -->|是| G'), '是边应存在');
assert(r1.includes('E1 -->|否| F'), '否边应存在');
assert(!r1.includes('E1 --> G["搜索技术栈"]'), '原出边应删除');

// 场景2：是目标无定义，自动补定义
console.log('\n=== 场景2：是目标无定义 ===');
const src2 = `flowchart TD  F["地区选全国"]  E --> E1{"判断"}  H --> G  G --> K["学习"]`;
const r2 = setAsDecision(src2, 'E1', 'G', 'F');
console.log(r2);
assert(r2.includes('G["G"]'), 'G 应自动补定义');
assert(r2.indexOf('G["G"]') < r2.indexOf('F["地区选全国"]'), 'G（是）应在 F（否）前面');
assert(!r2.includes('H --> G["G"]'), '不应产生意外边 H --> G');

// 场景3：否目标前有入边，是目标移到 flowchart 之后
console.log('\n=== 场景3：否目标前有入边 ===');
const src3 = `flowchart TD  F["地区选全国"] --> I["转Java"]  E --> E1{"判断"} G["搜索技术栈"]`;
const r3 = setAsDecision(src3, 'E1', 'G', 'I');
console.log(r3);
assert(r3.includes('G["搜索技术栈"]'), 'G 名称应保留');
assert(!r3.includes('F --> G'), '不应产生意外边 F --> G');
assert(r3.indexOf('G["搜索技术栈"]') < r3.indexOf('I["转Java"]'), 'G（是）应在 I（否）前面');

console.log(`\n=== 结果：${passed} 通过，${failed} 失败 ===`);
if (failed > 0) process.exit(1);
