/** 一次性端到端验证：大纲生成的 mermaid 代码能否真实渲染 + 聚焦（node 下运行） */
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { outlineToMermaid, type OutlineNode } from './outline';
import { extractNodeId } from './node-id';
import { DiagramFocusController } from './focus-dom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
const { window } = dom;
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
class Stub {
  cssRules: unknown[] = [];
  replaceSync(): void {}
  async replace(): Promise<void> {}
  insertRule(): number {
    return 0;
  }
}
(globalThis as any).CSSStyleSheet = Stub;
(window as any).CSSStyleSheet = Stub;
(globalThis as any).window = window;
(globalThis as any).document = window.document;
(globalThis as any).btoa = (s: string): string => Buffer.from(s, 'binary').toString('base64');
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 0);
(globalThis as any).cancelAnimationFrame = (id: ReturnType<typeof setTimeout>) => clearTimeout(id);

async function main(): Promise<void> {
  const n = (id: string, text: string, line: number, kind: OutlineNode['kind'], children: OutlineNode[] = []): OutlineNode =>
    ({ id, text, line, level: 0, kind, children });
  const tree = [
    n('n1', '需求分析', 0, 'h1', [
      n('n2', '调研[[竞品分析|竞品]]', 1, 'bullet', [n('n3', '竞品A', 2, 'bullet')]),
      n('n4', '输出"文档"', 4, 'h2'),
    ]),
  ];
  const diagram = outlineToMermaid(tree, '找工作流程', 'TB');
  console.log(diagram.code);

  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', flowchart: { htmlLabels: true } });
  const { svg } = await mermaid.render('os1', diagram.code);
  window.document.body.innerHTML = `<div id="wrap">${svg}</div>`;
  const wrap = window.document.getElementById('wrap')!;
  const nodes = Array.from(wrap.querySelectorAll('g.node')) as SVGGElement[];
  const ids = nodes.map((g) => extractNodeId(g, 'os1'));
  console.log('渲染节点 =', ids.join(','));
  assert.deepStrictEqual(ids, ['n0', 'n1', 'n2', 'n3', 'n4']);
  const paths = wrap.querySelectorAll('path.flowchart-link');
  console.log('连线数 =', paths.length);
  assert.strictEqual(paths.length, 4);
  const n2Text = nodes.find((g) => extractNodeId(g, 'os1') === 'n2')?.textContent ?? '';
  assert.ok(n2Text.includes('调研竞品'), 'wikilink 应替换为别名: ' + n2Text);
  const n4Text = nodes.find((g) => extractNodeId(g, 'os1') === 'n4')?.textContent ?? '';
  assert.ok(n4Text.includes("输出'文档'"), '引号应被转成单引号: ' + n4Text);

  const svgEl = wrap.querySelector('svg') as unknown as SVGSVGElement;
  const ctl = new DiagramFocusController(svgEl, diagram.edges, {
    renderId: 'os1',
    knownIds: new Set(ids as string[]),
    includeAncestors: true,
    duration: 0,
    paddingRatio: 0.15,
  });
  ctl.toggle('n3');
  assert.strictEqual(ctl.currentFocus, 'n3');
  const visible = nodes.filter((g) => g.style.display !== 'none').map((g) => extractNodeId(g, 'os1'));
  assert.deepStrictEqual(visible, ['n0', 'n1', 'n2', 'n3']);
  ctl.restore();
  assert.strictEqual(ctl.currentFocus, null);
  // restore 后所有节点恢复可见
  const afterRestore = nodes.filter((g) => g.style.display !== 'none').map((g) => extractNodeId(g, 'os1'));
  assert.deepStrictEqual(afterRestore, ['n0', 'n1', 'n2', 'n3', 'n4'], 'restore 后全图恢复');
  ctl.dispose();

  console.log('\n大纲流程图端到端验证通过：生成代码可渲染、节点/边齐全、wikilink 替换、双击聚焦/返回全图正常');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
