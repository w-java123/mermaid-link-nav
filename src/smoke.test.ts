/**
 * 端到端冒烟测试：jsdom 环境下让 mermaid 真实渲染解析后的代码，
 * 确认输出的 SVG 中存在 g.node[data-id] 且 id 与源码节点一致。
 * 运行：esbuild 打包（mermaid external）后用 node 执行
 */
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { DiagramFocusController } from './focus-dom';
import { extractNodeId } from './node-id';
import { parseDiagram } from './parser';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
const { window } = dom;

// jsdom 缺少的 SVG 布局 API，统一打桩
for (const key of ['SVGSVGElement', 'SVGElement']) {
  const ctor = (window as unknown as Record<string, any>)[key];
  if (ctor?.prototype) {
    ctor.prototype.getBBox = () => ({ x: 0, y: 0, width: 120, height: 36 });
    ctor.prototype.getComputedTextLength = () => 80;
    ctor.prototype.getScreenCTM = () => ({ inverse: () => ({}), a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    ctor.prototype.getCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, matrixTransform: (p: { x: number; y: number }) => p });
    ctor.prototype.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform: (p: { x: number; y: number }) => p });
  }
}
if (!window.CSS) (window as any).CSS = {};
if (!window.CSS.escape) window.CSS.escape = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
if (!window.SVGElement) (window as any).SVGElement = window.Element;

// jsdom 不支持 Constructable Stylesheets，给最小桩
class CSSStyleSheetStub {
  cssRules: unknown[] = [];
  replaceSync(): void {}
  async replace(): Promise<void> {}
  insertRule(): number {
    return 0;
  }
}
(globalThis as any).CSSStyleSheet = CSSStyleSheetStub;
(window as any).CSSStyleSheet = CSSStyleSheetStub;

(globalThis as any).window = window;
(globalThis as any).document = window.document;
(globalThis as any).btoa = (s: string): string => {
  if (/[^\x00-\xff]/.test(s)) console.log('[btoa probe] 非 ASCII 输入:', JSON.stringify(s).slice(0, 300));
  return Buffer.from(s, 'binary').toString('base64');
};
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
(globalThis as any).DOMPurify = undefined;
if (!(globalThis as any).requestAnimationFrame) {
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => cb(performance.now()), 0);
  (globalThis as any).cancelAnimationFrame = (id: ReturnType<typeof setTimeout>) => clearTimeout(id);
}

async function main(): Promise<void> {
  // extractNodeId 纯函数断言
  const doc = window.document;
  const mk = (attrs: Record<string, string>): Element => {
    const el = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  assert.strictEqual(extractNodeId(mk({ id: 'r1-flowchart-A-0' }), 'r1'), 'A');
  assert.strictEqual(extractNodeId(mk({ id: 'r1-flowchart-node_1-2' }), 'r1'), 'node_1');
  assert.strictEqual(extractNodeId(mk({ id: 'r1-flowchart-A-2-9' }), 'r1'), 'A-2');
  assert.strictEqual(extractNodeId(mk({ 'data-id': 'X', id: 'other' }), 'r1'), 'X');
  assert.strictEqual(extractNodeId(mk({ id: 'unrelated' }), 'r1'), undefined);
  console.log('extractNodeId 断言通过');

  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'default', flowchart: { htmlLabels: false } });

  const source = [
    'flowchart LR',
    '  A["[[首页|🏠 首页]]"] --> B("[[项目总览]]")',
    '  B --> C{{"[[架构设计#数据库模块|数据库设计]]"}}',
    '  B --> D["普通节点"]',
  ].join('\n');

  const parsed = parseDiagram(source);
  console.log('--- 替换后的 mermaid 源码 ---\n' + parsed.code);
  assert.strictEqual(parsed.links.size, 3);

  const { svg } = await mermaid.render('smoke1', parsed.code);
  window.document.body.innerHTML = `<div id="wrap">${svg}</div>`;
  const wrap = window.document.getElementById('wrap')!;
  const nodes = Array.from(wrap.querySelectorAll('g.node')) as SVGGElement[];
  console.log(`渲染出 ${nodes.length} 个节点`);
  const ids = nodes.map((n) => extractNodeId(n, 'smoke1')).sort();
  console.log('还原出的节点 id =', ids.join(', '));
  assert.deepStrictEqual(ids, ['A', 'B', 'C', 'D']);

  for (const [id, link] of parsed.links) {
    const g = nodes.find((n) => extractNodeId(n, 'smoke1') === id);
    assert.ok(g, `节点 ${id} 存在`);
    assert.ok((g?.textContent ?? '').includes(link.displayText), `节点 ${id} 文本包含「${link.displayText}」`);
    console.log(`节点 ${id} -> ${link.target}（显示：${link.displayText}）`);
  }

  // ---- 聚焦控制器：聚焦 C（祖先 A、B 保留，D 及其连线隐藏）----
  const svgEl = wrap.querySelector('svg') as unknown as SVGSVGElement;
  const controller = new DiagramFocusController(svgEl, parsed.edges, {
    renderId: 'smoke1',
    knownIds: new Set(['A', 'B', 'C', 'D']),
    includeAncestors: true,
    duration: 0,
    paddingRatio: 0.15,
  });
  controller.toggle('C');
  assert.strictEqual(controller.currentFocus, 'C');
  const displayOf = (id: string): string => {
    const g = nodes.find((n) => extractNodeId(n, 'smoke1') === id)!;
    return g.style.display;
  };
  assert.strictEqual(displayOf('A'), '', '祖先 A 可见');
  assert.strictEqual(displayOf('B'), '', '路径 B 可见');
  assert.strictEqual(displayOf('C'), '', '聚焦点 C 可见');
  assert.strictEqual(displayOf('D'), 'none', '兄弟分支 D 隐藏');

  const hiddenPaths = Array.from(wrap.querySelectorAll('path.flowchart-link')).filter(
    (p) => (p as SVGPathElement).style.display === 'none',
  );
  assert.ok(hiddenPaths.length >= 1, '无关连线应隐藏');
  const focusedView = svgEl.getAttribute('viewBox');
  console.log('聚焦 C 后 viewBox =', focusedView);

  // 再次聚焦同一节点 = 复位
  controller.toggle('C');
  assert.strictEqual(controller.currentFocus, null);
  assert.strictEqual(displayOf('D'), '', '复位后 D 恢复可见');
  controller.dispose();

  console.log('\n冒烟测试通过：解析 + mermaid 渲染 + 节点绑定 + 双击聚焦/复位全部正常');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
