/* eslint-disable obsidianmd/no-static-style-assignment */
/**
 * 流程图视图：把当前笔记大纲用 mermaid 渲染成 flowchart。
 * 单击节点跳转到笔记对应行（Ctrl/Cmd 新标签、Alt 分屏），双击节点聚焦分支。
 */
import { ItemView, Menu, PaneType, TFile, WorkspaceLeaf, type App } from 'obsidian';
import mermaid from 'mermaid';
import type MermaidLinkNavPlugin from './main';
import { DiagramFocusController } from './focus-dom';
import { PanZoomController } from './pan-zoom';
import { extractNodeId } from './node-id';
import { normalizeDiagram } from './diagram-edit';
import { buildOutlineTree, outlineToMermaid, type OutlineNode } from './outline';

export const OUTLINE_VIEW_TYPE = 'mermaid-link-nav-outline-view';

let outlineRenderSeq = 0;

export class OutlineFlowView extends ItemView {
  private readonly plugin: MermaidLinkNavPlugin;
  private activeFile: TFile | null = null;
  private direction: 'TB' | 'LR' = 'TB';
  private renderToken = 0;
  private controller: DiagramFocusController | null = null;
  private panZoom: PanZoomController | null = null;

  private toolbar!: HTMLDivElement;
  private stage!: HTMLDivElement;
  private dirBtn!: HTMLButtonElement;
  private resetBtn!: HTMLButtonElement;

  constructor(leaf: WorkspaceLeaf, plugin: MermaidLinkNavPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return OUTLINE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.activeFile ? `流程图：${this.activeFile.basename}` : '笔记流程图';
  }

  getIcon(): string {
    return 'network';
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add('mln-outline-view');
    this.contentEl.empty();

    this.toolbar = this.contentEl.createDiv({ cls: 'mln-outline-toolbar' });
    this.dirBtn = this.toolbar.createEl('button', {
      cls: 'mln-outline-btn',
      text: '切换为横向流程',
    });
    this.dirBtn.addEventListener('click', () => {
      this.direction = this.direction === 'TB' ? 'LR' : 'TB';
      this.dirBtn.textContent = this.direction === 'TB' ? '切换为横向流程' : '切换为纵向流程';
      void this.render();
    });
    this.resetBtn = this.toolbar.createEl('button', {
      cls: 'mln-outline-btn',
      text: '返回全图',
    });
    this.resetBtn.style.display = 'none';
    this.resetBtn.addEventListener('click', () => this.controller?.restore());
    this.toolbar.createEl('button', { cls: 'mln-outline-btn', text: '刷新' }).addEventListener('click', () => {
      void this.render();
    });
    this.toolbar.createSpan({
      cls: 'mln-outline-hint',
      text: 'Ctrl/⌘+单击查看详情 · 双击聚焦放大 · 滚轮缩放 · 拖动平移 · 右键更多',
    });

    this.stage = this.contentEl.createDiv({ cls: 'mln-outline-stage' });
    this.stage.tabIndex = -1;
    this.stage.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') this.controller?.restore();
    });

    const first = this.app.workspace.getActiveFile();
    await this.setFile(first && first.extension === 'md' ? first : null);

    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        void this.setFile(file && file.extension === 'md' ? file : null);
      }),
    );
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (file === this.activeFile) void this.render();
      }),
    );
  }

  async onClose(): Promise<void> {
    this.controller?.dispose();
    this.controller = null;
  }

  private async setFile(file: TFile | null): Promise<void> {
    this.activeFile = file;
    (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
    await this.render();
  }

  /** 设置中的默认打开位置（Ctrl/⌘+单击查看详情时使用） */
  private defaultPane(): PaneType | boolean {
    switch (this.plugin.settings.openMode) {
      case 'tab':
        return 'tab';
      case 'split':
        return 'split';
      default:
        return false;
    }
  }

  private jumpTo(line: number, mode: PaneType | boolean): void {
    const file = this.activeFile;
    if (!file) return;
    const leaf = this.app.workspace.getLeaf(mode);
    void leaf.openFile(file, { eState: { line } });
  }

  private async render(): Promise<void> {
    const token = ++this.renderToken;
    this.controller?.dispose();
    this.controller = null;
    this.panZoom?.dispose();
    this.panZoom = null;
    this.resetBtn.style.display = 'none';
    this.stage.empty();

    const file = this.activeFile;
    if (!file) {
      this.stage.createDiv({
        cls: 'mln-outline-empty',
        text: '请先打开一篇 Markdown 笔记，流程图会根据其标题与列表层级自动生成。',
      });
      return;
    }

    const content = await this.app.vault.cachedRead(file);
    let roots: OutlineNode[] = [];
    try {
      roots = buildOutlineTree(this.app as App, file, content);
    } catch (err) {
      console.error('[mermaid-link-nav] 大纲解析失败', err);
    }
    if (token !== this.renderToken) return; // 已被新一次渲染取代

    if (roots.length === 0) {
      this.stage.createDiv({
        cls: 'mln-outline-empty',
        text: '当前笔记没有可生成流程图的标题（#）或列表（-）层级。',
      });
      return;
    }

    const diagram = outlineToMermaid(roots, file.basename, this.direction);
    const wrapper = this.stage.createDiv({ cls: 'mermaid-link-wrapper mln-outline-wrapper' });
    wrapper.dataset.mlnState = 'loading';
    const renderId = `mln-o-${++outlineRenderSeq}`;

    try {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: this.plugin.resolveTheme(),
        fontFamily: 'var(--default-font, inherit)',
        flowchart: {
          htmlLabels: true,
          useMaxWidth: true,
          curve: 'basis',
          nodeSpacing: 40,
          rankSpacing: 60,
          padding: 12,
        },
      });
      const result = await mermaid.render(renderId, normalizeDiagram(diagram.code), wrapper);
      if (token !== this.renderToken) {
        document.getElementById(`d${renderId}`)?.remove();
        return;
      }
      // mermaid 渲染结果必须通过 innerHTML 插入 SVG
      // eslint-disable-next-line obsidianmd/no-inner-html
      wrapper.innerHTML = result.svg;
      result.bindFunctions?.(wrapper);
      delete wrapper.dataset.mlnState;
      this.enhance(wrapper, diagram.lines, diagram.edges, renderId);
    } catch (err) {
      if (token !== this.renderToken) return;
      wrapper.empty();
      wrapper.dataset.mlnState = 'error';
      wrapper.createDiv({ cls: 'mermaid-link-error-title', text: '流程图渲染失败' });
      wrapper.createDiv({
        cls: 'mermaid-link-error-msg',
        text: err instanceof Error ? `${err.message}\n\n${diagram.code}` : String(err),
      });
      document.getElementById(`d${renderId}`)?.remove();
    }
  }

  private enhance(
    wrapper: HTMLElement,
    lines: Map<string, number>,
    edges: ReturnType<typeof outlineToMermaid>['edges'],
    renderId: string,
  ): void {
    const svg = wrapper.querySelector<SVGSVGElement>('svg');
    const nodeEls = Array.from(wrapper.querySelectorAll<SVGGElement>('g.node'));
    const knownIds = new Set(lines.keys());

    const idOf = new Map<SVGGElement, string>();
    nodeEls.forEach((g) => {
      const id = extractNodeId(g, renderId);
      if (id && knownIds.has(id)) {
        idOf.set(g, id);
        if (id === 'n0') g.classList.add('mln-outline-root');
      }
    });

    // 画布式平移缩放（按笔记路径缓存 viewBox，返回时恢复缩放/平移状态）
    if (svg && this.activeFile) {
      this.panZoom = new PanZoomController(svg, {}, `outline:${this.activeFile.path}`);
    }

    if (svg && this.plugin.settings.dblclickFocus) {
      this.controller = new DiagramFocusController(svg, edges, {
        renderId,
        knownIds,
        includeAncestors: this.plugin.settings.includeAncestors,
        duration: this.plugin.settings.zoomDuration,
        paddingRatio: this.plugin.settings.zoomPaddingRatio,
        onFocusChange: (focused) => {
          this.resetBtn.style.display = focused ? '' : 'none';
        },
      });
      svg.addEventListener('dblclick', (ev) => {
        if (svg.dataset.mlnPan === '1') return;
        if (!(ev.target as Element | null)?.closest('g.node')) this.controller?.restore();
      });
    }

    const hasChild = new Set(edges.map((e) => e.from));
    const s = this.plugin.settings;
    idOf.forEach((id, g) => {
      const line = lines.get(id) ?? 0;
      g.classList.add('mermaid-link-node');
      if (hasChild.has(id)) g.classList.add('mln-has-children');
      if (s.hoverHighlight) g.classList.add('mln-hover-highlight');
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'link');
      g.style.userSelect = 'none';

      if (s.showTooltip) {
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent =
          `Ctrl/⌘+单击查看详情（定位到第 ${line + 1} 行）` +
          (s.dblclickFocus ? '\n双击：聚焦此分支，再双击返回全图' : '');
        g.appendChild(title);
      }

      // 查看详情的打开位置：Alt 优先分屏；Ctrl/⌘ 按设置的默认方式；普通单击不跳转
      const detailPane = (ev: MouseEvent | KeyboardEvent): PaneType | boolean | null => {
        if (ev.altKey) return 'split';
        if (ev.ctrlKey || ev.metaKey) return this.defaultPane();
        return null;
      };

      g.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const mode = detailPane(ev);
        if (mode !== null) this.jumpTo(line, mode); // 仅 Ctrl/⌘（或 Alt）+ 单击才查看详情
      });
      g.addEventListener('auxclick', (ev) => {
        if (ev.button === 1) this.jumpTo(line, 'tab'); // 鼠标中键：新标签页
      });
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          this.jumpTo(line, this.defaultPane());
        }
      });
      g.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const menu = new Menu();
        menu.addItem((it) => it.setTitle('在当前位置打开').onClick(() => this.jumpTo(line, false)));
        menu.addItem((it) => it.setTitle('在新标签页打开').onClick(() => this.jumpTo(line, 'tab')));
        menu.addItem((it) => it.setTitle('在右侧分屏打开').onClick(() => this.jumpTo(line, 'split')));
        menu.showAtMouseEvent(ev);
      });
      if (this.controller) {
        g.addEventListener('dblclick', (ev) => {
          if (svg?.dataset.mlnPan === '1') return; // 拖动结束后的误触发
          ev.preventDefault();
          ev.stopPropagation();
          this.controller?.toggle(id);
        });
      }
    });
  }
}
