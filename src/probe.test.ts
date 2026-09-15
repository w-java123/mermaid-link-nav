import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
const { window } = dom;
for (const key of ['SVGSVGElement', 'SVGElement']) {
  const ctor = (window as unknown as Record<string, any>)[key];
  if (ctor?.prototype) {
    ctor.prototype.getBBox = () => ({ x: 0, y: 0, width: 120, height: 36 });
    ctor.prototype.getComputedTextLength = () => 80;
  }
}
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
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
(globalThis as any).btoa = (s: string) => Buffer.from(s, 'binary').toString('base64');

async function main(): Promise<void> {
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'default', flowchart: { htmlLabels: false } });
  const src = ['flowchart LR', 'A["a"] -->|标签| B("b")', 'B --> C', 'B -.-> D', 'A --- E'].join('\n');
  const { svg } = await mermaid.render('probe1', src);
  window.document.body.innerHTML = `<div id="w">${svg}</div>`;
  const w = window.document.getElementById('w')!;
  const dump = (sel: string): void => {
    console.log(`\n### ${sel}`);
    w.querySelectorAll(sel).forEach((el) => {
      console.log(el.tagName, 'id=', el.getAttribute('id'), 'class=', el.getAttribute('class'));
    });
  };
  dump('g.node');
  dump('g.edgePath');
  dump('path.flowchart-link');
  dump('g.edgeLabel');
  const svgEl = w.querySelector('svg')!;
  console.log('\nsvg viewBox=', svgEl.getAttribute('viewBox'), 'width=', svgEl.getAttribute('width'));
  console.log('\n顶层分组:');
  Array.from(svgEl.children).forEach((c) => console.log(c.tagName, c.getAttribute('class') || c.getAttribute('id')));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
