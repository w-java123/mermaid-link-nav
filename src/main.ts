import {
  App,
  MarkdownPostProcessorContext,
  MarkdownView,
  Notice,
  PaneType,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
} from 'obsidian';
import mermaid from 'mermaid';
import { DiagramFocusController } from './focus-dom';
import { PanZoomController } from './pan-zoom';
import { extractNodeId } from './node-id';
import { normalizeLabel, parseDiagram, type FlowEdge, type NodeLink } from './parser';
import { OutlineFlowView, OUTLINE_VIEW_TYPE } from './outline-view';

const PLUGIN_ID = 'mermaid-link-nav';

type ThemeMode = 'auto' | 'default' | 'dark' | 'forest' | 'neutral';
type OpenMode = 'active' | 'tab' | 'split';

interface MermaidLinkNavSettings {
  /** 是否接管原生 ```mermaid 代码块 */
  overrideNative: boolean;
  /** 额外生效的代码块语言（逗号分隔） */
  extraLanguages: string;
  /** mermaid 主题 */
  theme: ThemeMode;
  /** 默认打开方式 */
  openMode: OpenMode;
  /** 悬停时显示目标笔记提示 */
  showTooltip: boolean;
  /** 悬停高亮可点击节点 */
  hoverHighlight: boolean;
  /** 双击节点聚焦分支、再次双击复位 */
  dblclickFocus: boolean;
  /** 聚焦时保留祖先链（上游路径） */
  includeAncestors: boolean;
  /** 单击与双击判定延时（ms），双击聚焦开启时生效 */
  clickDelayMs: number;
  /** 聚焦缩放动画时长（ms） */
  zoomDuration: number;
  /** 聚焦留白比例 */
  zoomPaddingRatio: number;
  /** 点击不存在的链接时，自动创建笔记的目标文件夹（留空=Obsidian 默认位置） */
  newNoteFolder: string;
}

const DEFAULT_SETTINGS: MermaidLinkNavSettings = {
  overrideNative: true,
  extraLanguages: 'mmd',
  theme: 'auto',
  openMode: 'active',
  showTooltip: true,
  hoverHighlight: true,
  dblclickFocus: true,
  includeAncestors: true,
  clickDelayMs: 220,
  zoomDuration: 320,
  zoomPaddingRatio: 0.15,
  newNoteFolder: '',
};

let renderSeq = 0;

export default class MermaidLinkNavPlugin extends Plugin {
  settings!: MermaidLinkNavSettings;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.registerProcessors();
    this.addSettingTab(new MermaidLinkNavSettingTab(this.app, this));

    // 笔记大纲 -> Mermaid 流程图视图
    this.registerView(OUTLINE_VIEW_TYPE, (leaf) => new OutlineFlowView(leaf, this));

    // 全局监听：新文件创建后，自动把匹配的虚线节点更新为实线
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (!(file instanceof TFile)) return;
        const nodes = document.querySelectorAll<SVGGElement>(
          '.mermaid-link-node.is-unresolved[data-link]',
        );
        nodes.forEach((g) => {
          const link = g.dataset.link || '';
          const targetPath = link.split('#')[0];
          if (!targetPath) return;
          if (this.app.metadataCache.getFirstLinkpathDest(targetPath, '')) {
            g.classList.remove('is-unresolved');
            const oldTitle = g.querySelector('title');
            if (oldTitle) oldTitle.remove();
            if (this.settings.showTooltip) {
              const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
              title.textContent =
                `Ctrl/⌘+单击跳转到：${link}` +
                (this.settings.dblclickFocus ? '\n双击：聚焦此分支，再双击返回全图' : '');
              g.appendChild(title);
            }
          }
        });
      }),
    );

    this.addCommand({
      id: 'open-outline-flowchart',
      name: '打开当前笔记的流程图视图（Mermaid）',
      callback: () => {
        void this.app.workspace.getLeaf(true).setViewState({
          type: OUTLINE_VIEW_TYPE,
          active: true,
        });
      },
    });

    this.addCommand({
      id: 'rerender-current-note',
      name: '重新渲染当前笔记中的 Mermaid 链接图',
      callback: () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        // previewMode.rerender 是 Obsidian 内部 API，做可选链保护
        const preview = (view as unknown as { previewMode?: { rerender?: (v: boolean) => void } } | null)
          ?.previewMode;
        preview?.rerender?.(false);
      },
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** 注册需要接管的代码块语言 */
  private registerProcessors(): void {
    const languages = new Set<string>(['mermaid-link']);
    if (this.settings.overrideNative) languages.add('mermaid');
    this.settings.extraLanguages
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .forEach((l) => languages.add(l));

    for (const lang of languages) {
      this.registerMarkdownCodeBlockProcessor(lang, (source, el, ctx) => {
        void this.renderBlock(source, el, ctx);
      });
    }
  }

  resolveTheme(): 'default' | 'dark' | 'forest' | 'neutral' {
    if (this.settings.theme !== 'auto') return this.settings.theme;
    return document.body.classList.contains('theme-dark') ? 'dark' : 'default';
  }

  /** 渲染单个代码块 */
  private async renderBlock(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
  ): Promise<void> {
    el.empty();
    const wrapper = el.createDiv({ cls: 'mermaid-link-wrapper' });
    wrapper.dataset.mlnState = 'loading';

    const parsed = parseDiagram(source);
    const renderId = `mln-${++renderSeq}`;

    try {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: this.resolveTheme(),
        fontFamily: 'var(--default-font, inherit)',
        flowchart: { htmlLabels: true, useMaxWidth: true, curve: 'basis' },
      });

      const result = await mermaid.render(renderId, parsed.code, wrapper);
      wrapper.innerHTML = result.svg;
      result.bindFunctions?.(wrapper);
      delete wrapper.dataset.mlnState;
      this.enhanceDiagram(wrapper, parsed.links, parsed.edges, ctx.sourcePath, renderId);
    } catch (err) {
      wrapper.empty();
      wrapper.dataset.mlnState = 'error';
      wrapper.createDiv({ cls: 'mermaid-link-error-title', text: 'Mermaid 图表解析失败' });
      wrapper.createDiv({
        cls: 'mermaid-link-error-msg',
        text: err instanceof Error ? err.message : String(err),
      });
      // mermaid 渲染失败时会在 body 留下临时 DOM
      document.getElementById(`d${renderId}`)?.remove();
    }
  }

  /** 渲染后增强：节点跳转 + 双击聚焦 */
  private enhanceDiagram(
    wrapper: HTMLElement,
    links: Map<string, NodeLink>,
    edges: FlowEdge[],
    sourcePath: string,
    renderId: string,
  ): void {
    const svg = wrapper.querySelector<SVGSVGElement>('svg');
    const nodeEls = Array.from(wrapper.querySelectorAll<SVGGElement>('g.node'));

    // 还原每个节点 g 对应的源码节点 id
    const idOf = new Map<SVGGElement, string>();
    const knownIds = new Set<string>();
    nodeEls.forEach((g) => {
      let id = extractNodeId(g, renderId);
      if (!id || !links.has(id)) {
        const byText = this.matchNodeByText(g, links);
        if (byText) id = byText;
      }
      if (id) {
        knownIds.add(id); // 所有可识别节点都纳入，供聚焦/钻取管理显隐
        if (links.has(id)) idOf.set(g, id); // 只有带链接的节点才绑定跳转
      }
    });

    // 画布式平移缩放（滚轮缩放 / 拖动平移 / 触摸板手势）
    if (svg) new PanZoomController(svg);

    // 双击聚焦控制器
    let controller: DiagramFocusController | null = null;
    let resetBtn: HTMLDivElement | null = null;
    if (svg && this.settings.dblclickFocus) {
      controller = new DiagramFocusController(svg, edges, {
        renderId,
        knownIds,
        includeAncestors: this.settings.includeAncestors,
        duration: this.settings.zoomDuration,
        paddingRatio: this.settings.zoomPaddingRatio,
        onFocusChange: (focused) => {
          if (resetBtn) resetBtn.style.display = focused ? '' : 'none';
          wrapper.classList.toggle('mln-focused', focused);
        },
      });

      resetBtn = wrapper.createDiv({ cls: 'mln-reset-btn', text: '↩ 返回全图' });
      resetBtn.style.display = 'none';
      resetBtn.addEventListener('click', () => controller?.restore());

      // 双击空白区域复位；Esc 复位
      svg.addEventListener('dblclick', (ev) => {
        if (svg.dataset.mlnPan === '1') return; // 拖动结束后的误触发
        if (!(ev.target as Element | null)?.closest('g.node')) controller?.restore();
      });
      wrapper.tabIndex = -1;
      wrapper.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') controller?.restore();
      });
    }

    nodeEls.forEach((g) => {
      const nodeId = idOf.get(g);
      const link = nodeId ? links.get(nodeId) : undefined;
      g.style.userSelect = 'none';

      /* ---- 单击跳转 ---- */
      if (nodeId && link) {
        g.classList.add('mermaid-link-node');
        if (this.settings.hoverHighlight) g.classList.add('mln-hover-highlight');

        const targetPath = link.target.split('#')[0];
        const exists =
          !targetPath ||
          !!this.app.metadataCache.getFirstLinkpathDest(targetPath, sourcePath);
        if (!exists) g.classList.add('is-unresolved');

        g.setAttribute('tabindex', '0');
        g.setAttribute('role', 'link');
        g.setAttribute('aria-label', `跳转到 ${link.target}`);
        g.dataset.link = link.target;

        if (this.settings.showTooltip) {
          const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
          title.textContent =
            (exists ? `Ctrl/⌘+单击跳转到：${link.target}` : `Ctrl/⌘+单击跳转到：${link.target}（笔记不存在，将自动创建）`) +
            (this.settings.dblclickFocus ? '\n双击：聚焦此分支，再双击返回全图' : '');
          g.appendChild(title);
        }

        const open = async (ev: MouseEvent): Promise<void> => {
          ev.preventDefault();
          ev.stopPropagation();
          // 链接不存在且设置了目标文件夹、且链接本身未指定路径时，自动在该文件夹创建
          const targetPath = link.target.split('#')[0];
          const existed = !!this.app.metadataCache.getFirstLinkpathDest(targetPath, sourcePath);
          if (!existed && this.settings.newNoteFolder && !targetPath.includes('/')) {
            const folder = this.app.vault.getAbstractFileByPath(this.settings.newNoteFolder);
            if (folder instanceof TFolder) {
              const newPath = this.settings.newNoteFolder + '/' + targetPath + '.md';
              if (!this.app.vault.getAbstractFileByPath(newPath)) {
                await this.app.vault.create(newPath, '');
              }
            }
          }
          // 点击后笔记已被创建（无论是我们创建的还是 openLinkText 创建的），更新节点样式为实线
          if (!existed) {
            g.classList.remove('is-unresolved');
            if (this.settings.showTooltip) {
              const oldTitle = g.querySelector('title');
              if (oldTitle) oldTitle.remove();
              const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
              title.textContent =
                `Ctrl/⌘+单击跳转到：${link.target}` +
                (this.settings.dblclickFocus ? '\n双击：聚焦此分支，再双击返回全图' : '');
              g.appendChild(title);
            }
          }
          await this.app.workspace.openLinkText(
            link.target,
            sourcePath,
            this.paneTypeFromEvent(ev),
          );
        };

        // 仅 Ctrl/⌘（或 Alt）+ 单击才跳转查看详情，普通左键单击不跳转
        g.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (ev.ctrlKey || ev.metaKey || ev.altKey) void open(ev);
        });
        g.addEventListener('auxclick', (ev) => {
          if (ev.button === 1) void open(ev); // 鼠标中键：新标签页
        });
        g.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            void this.app.workspace.openLinkText(
              link.target,
              sourcePath,
              this.paneTypeFromModifiers(ev.ctrlKey || ev.metaKey, ev.altKey),
            );
          }
        });
      } else if (nodeId && this.settings.dblclickFocus && this.settings.showTooltip) {
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = '双击：聚焦此分支，再双击返回全图';
        g.appendChild(title);
      }

      /* ---- 双击聚焦 ---- */
      if (controller && nodeId) {
        g.addEventListener('dblclick', (ev) => {
          if (svg?.dataset.mlnPan === '1') return; // 拖动结束后的误触发
          ev.preventDefault();
          ev.stopPropagation();
          controller!.toggle(nodeId);
        });
      }
    });
  }

  /** data-id 缺失时，用节点文本兜底匹配 */
  private matchNodeByText(g: SVGGElement, links: Map<string, NodeLink>): string | undefined {
    const text = normalizeLabel(g.textContent ?? '');
    for (const [id, link] of links) {
      if (link.displayText && link.displayText === text) return id;
    }
    return undefined;
  }

  private paneTypeFromEvent(ev: MouseEvent): PaneType | boolean {
    return this.paneTypeFromModifiers(ev.ctrlKey || ev.metaKey, ev.altKey);
  }

  /** Ctrl/Cmd 新标签页，Alt 分屏；否则使用设置中的默认方式 */
  private paneTypeFromModifiers(primary: boolean, alt: boolean): PaneType | boolean {
    if (primary) return 'tab';
    if (alt) return 'split';
    switch (this.settings.openMode) {
      case 'tab':
        return 'tab';
      case 'split':
        return 'split';
      default:
        return false;
    }
  }
}

class MermaidLinkNavSettingTab extends PluginSettingTab {
  private readonly plugin: MermaidLinkNavPlugin;

  constructor(app: App, plugin: MermaidLinkNavPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('接管原生 mermaid 代码块')
      .setDesc('开启后，普通 ```mermaid 代码块也由本插件渲染（节点链接/聚焦生效）；关闭时请使用 ```mermaid-link 代码块。修改此项需重新加载插件。')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.overrideNative).onChange(async (v) => {
          this.plugin.settings.overrideNative = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('额外生效的代码块语言')
      .setDesc('逗号分隔，例如 mmd、flowchart。修改此项需重新加载插件。')
      .addText((text) =>
        text
          .setPlaceholder('mmd')
          .setValue(this.plugin.settings.extraLanguages)
          .onChange(async (v) => {
            this.plugin.settings.extraLanguages = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('图表主题')
      .setDesc('自动模式会跟随 Obsidian 的明暗主题。')
      .addDropdown((dd) =>
        dd
          .addOptions({
            auto: '自动（跟随 Obsidian）',
            default: '浅色 default',
            dark: '深色 dark',
            forest: 'forest',
            neutral: 'neutral',
          })
          .setValue(this.plugin.settings.theme)
          .onChange(async (v) => {
            this.plugin.settings.theme = v as ThemeMode;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('点击节点的默认打开方式')
      .setDesc('无论怎么设置，Ctrl/Cmd + 点击始终在新标签页打开，Alt + 点击始终分屏打开。')
      .addDropdown((dd) =>
        dd
          .addOptions({
            active: '当前标签页',
            tab: '新标签页',
            split: '左右分屏',
          })
          .setValue(this.plugin.settings.openMode)
          .onChange(async (v) => {
            this.plugin.settings.openMode = v as OpenMode;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName('交互').setHeading();

    new Setting(containerEl)
      .setName('双击节点聚焦分支')
      .setDesc('双击节点放大显示其下游分支（保留上游路径），再次双击该节点或双击空白处恢复全图，Esc 也可恢复。')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.dblclickFocus).onChange(async (v) => {
          this.plugin.settings.dblclickFocus = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('聚焦时保留上游路径')
      .setDesc('关闭后只显示聚焦节点及其下游，不显示祖先链。')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.includeAncestors).onChange(async (v) => {
          this.plugin.settings.includeAncestors = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('单击/双击判定延时')
      .setDesc(`当前 ${this.plugin.settings.clickDelayMs}ms。需要区分单击跳转与双击聚焦，数值过小可能误触。设为 0 且开启双击聚焦时不推荐。`)
      .addSlider((slider) =>
        slider
          .setLimits(0, 500, 10)
          .setValue(this.plugin.settings.clickDelayMs)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.clickDelayMs = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('聚焦动画时长')
      .setDesc(`当前 ${this.plugin.settings.zoomDuration}ms，设为 0 表示无动画直接切换。`)
      .addSlider((slider) =>
        slider
          .setLimits(0, 800, 20)
          .setValue(this.plugin.settings.zoomDuration)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.zoomDuration = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('聚焦留白比例')
      .setDesc(`当前 ${this.plugin.settings.zoomPaddingRatio.toFixed(2)}，数值越大节点周围越宽松。`)
      .addSlider((slider) =>
        slider
          .setLimits(0, 0.5, 0.01)
          .setValue(this.plugin.settings.zoomPaddingRatio)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.zoomPaddingRatio = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName('笔记创建').setHeading();

    new Setting(containerEl)
      .setName('新笔记默认文件夹')
      .setDesc('点击流程图中不存在的链接时，自动在此文件夹下创建笔记。留空则使用 Obsidian 默认位置；若链接本身已含路径（如 folder/note）则尊重链接路径。')
      .addText((text) =>
        text
          .setPlaceholder('例如：Inbox 或 学习笔记/草稿')
          .setValue(this.plugin.settings.newNoteFolder)
          .onChange(async (v) => {
            this.plugin.settings.newNoteFolder = v.trim().replace(/^\/+|\/+$/g, '');
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName('外观').setHeading();

    new Setting(containerEl)
      .setName('悬停提示目标笔记')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showTooltip).onChange(async (v) => {
          this.plugin.settings.showTooltip = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('悬停高亮可点击节点')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.hoverHighlight).onChange(async (v) => {
          this.plugin.settings.hoverHighlight = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('重新加载插件')
      .setDesc('修改代码块语言相关设置后，点击此处重新加载即可生效。')
      .addButton((btn) =>
        btn
          .setButtonText('重新加载')
          .setCta()
          .onClick(async () => {
            const plugins = (
              this.app as unknown as {
                plugins: {
                  disablePlugin: (id: string) => Promise<void>;
                  enablePlugin: (id: string) => Promise<void>;
                };
              }
            ).plugins;
            await plugins.disablePlugin(PLUGIN_ID);
            await plugins.enablePlugin(PLUGIN_ID);
            new Notice('Mermaid Link Navigator 已重新加载');
          }),
      );
  }
}
