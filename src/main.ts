import {
  App,
  MarkdownPostProcessorContext,
  MarkdownView,
  Menu,
  Notice,
  PaneType,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  AbstractInputSuggest,
} from 'obsidian';
import mermaid from 'mermaid';
import { PanZoomController } from './pan-zoom';
import { extractNodeId } from './node-id';
import { normalizeLabel, parseDiagram, type FlowEdge, type NodeLink } from './parser';
import { addEdge, addNode, changeDecisionTarget, changeNodeShape, deleteNode, editNode, NODE_SHAPES, normalizeDiagram, removeIncomingEdges, removeOutgoingEdges, setAsDecision, setParent, swapNodes, updateNoteSource } from './diagram-edit';
import { NodeEditModal, NodeEditResult } from './edit-modal';
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
  /** 点击不存在的链接时，自动创建笔记的目标文件夹（留空=Obsidian 默认位置） */
  newNoteFolder: string;
  /** PNG 导出文件夹（留空=使用「笔记名+PNG图片」自动命名） */
  exportFolderPng: string;
  /** SVG 导出文件夹（留空=使用「笔记名+SVG图片」自动命名） */
  exportFolderSvg: string;
}

const DEFAULT_SETTINGS: MermaidLinkNavSettings = {
  overrideNative: true,
  extraLanguages: 'mmd',
  theme: 'auto',
  openMode: 'active',
  showTooltip: true,
  hoverHighlight: true,
  newNoteFolder: '',
  exportFolderPng: '',
  exportFolderSvg: '',
};

/** 文件夹选择器：Obsidian 当前版本未导出 FolderSuggest，这里基于 AbstractInputSuggest 实现 */
class FolderSuggest extends AbstractInputSuggest<string> {
  private target: HTMLInputElement;
  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.target = inputEl;
  }
  getSuggestions(inputStr: string): string[] {
    const lower = inputStr.toLowerCase();
    return this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder)
      .map((f) => f.path)
      .filter((p) => p.toLowerCase().includes(lower))
      .slice(0, 50);
  }
  renderSuggestion(item: string, el: HTMLElement): void {
    el.setText(item);
  }
  selectSuggestion(item: string): void {
    this.setValue(item);
    this.target.dispatchEvent(new Event('input', { bubbles: true }));
    this.close();
  }
}

let renderSeq = 0;

/** 安全地设置提示框文字，将 redWord 渲染为红色高亮（不用 innerHTML） */
function setHintText(hint: HTMLElement, text: string, redWord: string): void {
  hint.empty();
  const idx = text.indexOf(redWord);
  if (idx === -1) {
    hint.appendText(text);
    return;
  }
  hint.appendText(text.slice(0, idx));
  const span = hint.createSpan({ cls: 'mln-hint-red' });
  span.setText(redWord);
  hint.appendText(text.slice(idx + redWord.length));
}

/** 当前选中节点的 localStorage key */

/** 当前节点高亮色（与红色选择按钮一致） */
const CURRENT_NODE_COLOR = '#e93147';
/** 当前节点高亮色（与红色选择按钮一致） */

/** 应用当前节点高亮：红色底填充 + 粗描边 + 呼吸光晕（record 原值便于恢复） */
function applyCurrentNodeHighlight(nodeG: SVGGElement): void {
  nodeG.classList.add('mln-current-node');
  nodeG.querySelectorAll<SVGElement>('rect, path, circle, polygon, ellipse').forEach((shape) => {
    shape.dataset.mlnOrigFill = shape.style.fill || shape.getAttribute('fill') || '';
    shape.dataset.mlnOrigStroke = shape.style.stroke || shape.getAttribute('stroke') || '';
    shape.style.stroke = CURRENT_NODE_COLOR;
    shape.style.strokeWidth = '4px';
    shape.style.fill = 'rgba(255, 90, 105, 0.3)';
  });
}

/** 清除当前节点高亮，恢复 mermaid 默认样式 */
function clearCurrentNodeHighlight(nodeG: SVGGElement): void {
  nodeG.classList.remove('mln-current-node');
  nodeG.querySelectorAll<SVGElement>('rect, path, circle, polygon, ellipse').forEach((shape) => {
    shape.style.stroke = shape.dataset.mlnOrigStroke ?? '';
    shape.style.strokeWidth = '';
    shape.style.fill = shape.dataset.mlnOrigFill ?? '';
    delete shape.dataset.mlnOrigFill;
    delete shape.dataset.mlnOrigStroke;
  });
}

const CURRENT_NODE_KEY = 'mermaid-link-nav:current-node';

/** 读取某笔记的当前选中节点 ID */
function getCurrentNode(sourcePath: string): string | null {
  try {
    const raw = localStorage.getItem(CURRENT_NODE_KEY);
    if (raw) return (JSON.parse(raw) as Record<string, string>)[sourcePath] ?? null;
  } catch { /* ignore */ }
  return null;
}

/** 设置某笔记的当前选中节点 ID（传 null 清除） */
function setCurrentNode(sourcePath: string, nodeId: string | null): void {
  try {
    const raw = localStorage.getItem(CURRENT_NODE_KEY);
    const data = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    if (nodeId) data[sourcePath] = nodeId;
    else delete data[sourcePath];
    localStorage.setItem(CURRENT_NODE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

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
                '';
              g.appendChild(title);
            }
          }
        });
      }),
    );

    // 全局监听：文件重命名时，同步更新所有 mermaid 代码块中的跳转链接
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        void this.updateMermaidLinksOnRename(file, oldPath);
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

  /** 文件重命名时，遍历所有笔记，更新 mermaid 代码块中的跳转链接 */
  private async updateMermaidLinksOnRename(file: TFile, oldPath: string): Promise<void> {
    // 只处理 Markdown 文件
    if (file.extension !== 'md') return;

    // 计算旧/新链接路径（去掉 .md 扩展名）和文件名（不含路径）
    const oldLinkPath = oldPath.replace(/\.md$/i, '');
    const newLinkPath = file.path.replace(/\.md$/i, '');
    const oldBasename = oldPath.split('/').pop()?.replace(/\.md$/i, '') ?? '';
    const newBasename = file.path.split('/').pop()?.replace(/\.md$/i, '') ?? '';

    // 需要替换的链接形式（完整路径优先，其次文件名）
    const replacements: Array<[string, string]> = [];
    if (oldLinkPath && oldLinkPath !== newLinkPath) {
      replacements.push([oldLinkPath, newLinkPath]);
    }
    if (oldBasename && oldBasename !== newBasename && oldBasename !== oldLinkPath) {
      replacements.push([oldBasename, newBasename]);
    }
    if (replacements.length === 0) return;

    // 遍历所有 Markdown 笔记
    const files = this.app.vault.getMarkdownFiles();
    for (const note of files) {
      try {
        const content = await this.app.vault.read(note);
        if (!content.includes('```mermaid') && !content.includes('~~~mermaid')) continue;

        let modified = false;
        // 匹配 mermaid 代码块（支持 ``` 和 ~~~）
        const blockRe = /^[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^[ \t]*\1/gm;
        const newContent = content.replace(blockRe, (full, marker: string, inner: string) => {
          let updated = inner;
          for (const [oldLink, newLink] of replacements) {
            const oldEsc = oldLink.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // 替换 [[oldLink]] 和 [[oldLink|alias]]，保留锚点和别名
            const re = new RegExp(`\\[\\[${oldEsc}(#[^\\]|]*)?(\\|[^\\]]*)?\\]\\]`, 'g');
            let replacedOnce = false;
            updated = updated.replace(re, (_m, anchor: string, alias: string) => {
              replacedOnce = true;
              return `[[${newLink}${anchor ?? ''}${alias ?? ''}]]`;
            });
            if (replacedOnce) modified = true;
          }
          if (!modified) return full;
          const header = full.slice(0, full.indexOf('\n') + 1);
          return header + updated.replace(/\n$/, '') + '\n' + marker;
        });

        if (modified) {
          await this.app.vault.modify(note, newContent);
        }
      } catch {
        // 忽略单个文件的读取错误
      }
    }
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

      // 单行压缩格式规范化后再渲染，避免 mermaid 11 解析/渲染崩溃（孤立节点定义夹在语句间）
      const renderCode = normalizeDiagram(parsed.code);
      const result = await mermaid.render(renderId, renderCode, wrapper);
      const svgDoc = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
      wrapper.appendChild(svgDoc.documentElement);
      result.bindFunctions?.(wrapper);
      delete wrapper.dataset.mlnState;
      this.enhanceDiagram(wrapper, parsed.links, parsed.edges, ctx.sourcePath, renderId, source);
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

  /** 渲染后增强：节点跳转等交互 */
  private enhanceDiagram(
    wrapper: HTMLElement,
    links: Map<string, NodeLink>,
    edges: FlowEdge[],
    sourcePath: string,
    renderId: string,
    diagramSource: string,
  ): void {
    const svg = wrapper.querySelector<SVGSVGElement>('svg');
    const nodeEls = Array.from(wrapper.querySelectorAll<SVGGElement>('g.node'));

    // 手机端 WebView 不支持 svg height:auto 按 viewBox 比例推导（高度塌陷为 0），
    // 这里按 viewBox 比例显式计算并设置高度；窗口尺寸变化时重算。
    if (svg) {
      const vb = svg.viewBox.baseVal;
      const fixSvgHeight = (): void => {
        if (vb.width > 0 && svg.clientWidth > 0) {
          const h = Math.round((svg.clientWidth * vb.height) / vb.width);
          if (h > 0) svg.style.height = `${h}px`;
        }
      };
      fixSvgHeight();
      window.addEventListener('resize', fixSvgHeight);
      window.setTimeout(fixSvgHeight, 60); // 等布局完成后再算一次
    }

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
        knownIds.add(id); // 所有可识别节点都纳入管理
        if (links.has(id)) idOf.set(g, id); // 只有带链接的节点才绑定跳转
      }
    });

    // 节点形状映射（用于判断是否为判断节点/菱形）
    const nodeOpener = new Map<string, string>();
    try {
      const parsedForShape = parseDiagram(diagramSource);
      for (const n of parsedForShape.nodes) nodeOpener.set(n.id, n.opener);
    } catch { /* ignore */ }

    // 画布式平移缩放（滚轮缩放 / 拖动平移 / 触摸板手势）
    let panZoom: PanZoomController | null = null;
    if (svg) {
      // 用笔记路径作为稳定 cacheKey，编辑节点/跳转返回后重新渲染仍能恢复视图状态
      const cacheKey = sourcePath;
      panZoom = new PanZoomController(svg, {}, cacheKey);
    }

    // 点击图上节点选择（用于添加节点时选上下游、设置判断节点时选是/否目标）
    const pickNode = (hintText: string, redWord: string, excludeId: string | null): Promise<string | null> => {
      return new Promise((resolve) => {
        if (!svg) { resolve(null); return; }
        const hint = document.createElement('div');
        hint.classList.add('mln-hint-center');
        setHintText(hint, hintText, redWord);
        document.body.appendChild(hint);

        const cleanup = (result: string | null) => {
          svg!.removeEventListener('click', onClick, true);
          document.removeEventListener('keydown', onKey);
          hint.remove();
          resolve(result);
        };
        const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') cleanup(null); };
        const onClick = (ev: MouseEvent) => {
          const targetG = (ev.target as Element)?.closest('g.node') as SVGGElement | null;
          if (!targetG) return;
          const targetId = extractNodeId(targetG, renderId);
          if (!targetId || !knownIds.has(targetId)) return;
          if (excludeId && targetId === excludeId) return;
          ev.stopPropagation();
          cleanup(targetId);
        };
        svg.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKey);
      });
    };

    // 右键菜单：添加节点 / 编辑节点 / 删除节点
    wrapper.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const g = (ev.target as Element)?.closest('g.node') as SVGGElement | null;
      const menu = new Menu();
      let hasItems = false;

      if (g) {
        hasItems = true;
        const nodeId = extractNodeId(g, renderId);
        if (nodeId && knownIds.has(nodeId)) {
          const link = links.get(nodeId);

          // 选择父节点（替换原有父节点：删除入边，建立 选中 --> 当前）
          menu.addItem((item) =>
            item.setTitle('选择父节点').onClick(async () => {
              const curLabel = link?.displayText ?? (g.textContent ?? '').trim();
              const selectedId = await pickNode(
                `请点击选择要添加为【父】节点的节点（当前节点：${curLabel}，Esc 取消）`,
                '【父】', nodeId,
              );
              if (!selectedId) return;
              const newSource = setParent(diagramSource, nodeId, selectedId);
              const ok = await updateNoteSource(this.app, sourcePath, diagramSource, newSource);
              if (!ok) new Notice('选择父节点失败');
            }),
          );

          // 选择子节点（选择已存在节点，建立 当前 --> 选中 的连线）
          menu.addItem((item) =>
            item.setTitle('选择子节点').onClick(async () => {
              const curLabel = link?.displayText ?? (g.textContent ?? '').trim();
              const selectedId = await pickNode(
                `请点击选择要添加为【子】节点的节点（当前节点：${curLabel}，Esc 取消）`,
                '【子】', nodeId,
              );
              if (!selectedId) return;
              const newSource = addEdge(diagramSource, nodeId, selectedId);
              const ok = await updateNoteSource(this.app, sourcePath, diagramSource, newSource);
              if (!ok) new Notice('选择子节点失败');
            }),
          );

          menu.addSeparator();

          // 编辑节点
          menu.addItem((item) =>
            item.setTitle('编辑节点').onClick(() => {
              const currentLabel = link?.displayText ?? (g.textContent ?? '').trim();
              const currentLink = link?.target ?? '';
              new NodeEditModal(this.app, {
                title: '编辑节点',
                initialLabel: currentLabel,
                initialLink: currentLink,
                onSubmit: async (result) => {
                  // 链接留空时默认用节点名称（与添加节点一致）
                  const link = result.link.trim() ? result.link : result.label;
                  const newSource = editNode(diagramSource, nodeId, {
                    label: result.label,
                    link,
                  });
                  const ok = await updateNoteSource(this.app, sourcePath, diagramSource, newSource);
                  if (!ok) new Notice('更新笔记失败');
                },
              }).open();
            }),
          );

          // 更换位置（与另一个节点交换显示内容）
          menu.addItem((item) =>
            item.setTitle('更换位置').onClick(async () => {
              const curLabel = link?.displayText ?? (g.textContent ?? '').trim();
              const targetId = await pickNode(
                `请点击选择要与【${curLabel}】更换位置的节点（Esc 取消）`,
                `【${curLabel}】`, nodeId,
              );
              if (!targetId) return;
              const newSource = swapNodes(diagramSource, nodeId, targetId);
              const ok = await updateNoteSource(this.app, sourcePath, diagramSource, newSource);
              if (!ok) new Notice('更换位置失败');
            }),
          );

          // 改变形状
          menu.addItem((item) =>
            item.setTitle('改变形状').onClick((ev) => {
              const shapeMenu = new Menu();
              NODE_SHAPES.forEach((shape) => {
                shapeMenu.addItem((sub) =>
                  sub.setTitle(shape.label).onClick(async () => {
                    const newSource = changeNodeShape(diagramSource, nodeId, shape.type);
                    const ok = await updateNoteSource(this.app, sourcePath, diagramSource, newSource);
                    if (!ok) new Notice('改变形状失败');
                  }),
                );
              });
              shapeMenu.showAtMouseEvent(ev as MouseEvent);
            }),
          );

          // 设置为判断节点（点击图上节点选择是/否目标）
          menu.addItem((item) =>
            item.setTitle('设置为判断节点').onClick(() => {
              if (!svg) return;
              let phase: 'yes' | 'no' = 'yes';
              let yesTarget: string | null = null;

              // 浮动提示：定位在当前节点上方
              const hint = document.createElement('div');
              hint.classList.add('mln-hint-above');
              const setHint = (text: string, redWord: string) => {
                setHintText(hint, text, redWord);
                const rect = g.getBoundingClientRect();
                hint.style.left = `${rect.left + rect.width / 2}px`;
                hint.style.top = `${rect.top - 8}px`;
              };
              setHint('请点击选择为【是】时的子节点（Esc 取消）', '【是】');
              document.body.appendChild(hint);

              const cleanup = () => {
                svg.removeEventListener('click', onClick, true);
                document.removeEventListener('keydown', onKey);
                hint.remove();
              };

              const onKey = (ev: KeyboardEvent) => {
                if (ev.key === 'Escape') cleanup();
              };

              const onClick = (ev: MouseEvent) => {
                const targetG = (ev.target as Element)?.closest('g.node') as SVGGElement | null;
                if (!targetG) return;
                const targetId = extractNodeId(targetG, renderId);
                if (!targetId || targetId === nodeId || !knownIds.has(targetId)) return;
                ev.stopPropagation();

                if (phase === 'yes') {
                  yesTarget = targetId;
                  phase = 'no';
                  setHint('请点击选择为【否】时的子节点（Esc 取消）', '【否】');
                } else {
                  const noTarget = targetId;
                  cleanup();
                  const newSource = setAsDecision(diagramSource, nodeId, yesTarget!, noTarget);
                  updateNoteSource(this.app, sourcePath, diagramSource, newSource).then((ok) => {
                    if (!ok) new Notice('设置判断节点失败');
                  });
                }
              };

              svg.addEventListener('click', onClick, true);
              document.addEventListener('keydown', onKey);
            }),
          );

          // 如果当前是判断节点（菱形），提供更换是/否目标的选项
          if (nodeOpener.get(nodeId) === '{') {
            menu.addItem((item) =>
              item.setTitle('更换【是】节点').onClick(async () => {
                const curLabel = link?.displayText ?? (g.textContent ?? '').trim();
                const newTarget = await pickNode(
                  `请点击选择新的【是】子节点（当前节点：${curLabel}，Esc 取消）`,
                  '【是】', nodeId,
                );
                if (!newTarget) return;
                const newSource = changeDecisionTarget(diagramSource, nodeId, 'yes', newTarget);
                const ok = await updateNoteSource(this.app, sourcePath, diagramSource, newSource);
                if (!ok) new Notice('更换【是】节点失败');
              }),
            );
            menu.addItem((item) =>
              item.setTitle('更换【否】节点').onClick(async () => {
                const curLabel = link?.displayText ?? (g.textContent ?? '').trim();
                const newTarget = await pickNode(
                  `请点击选择新的【否】子节点（当前节点：${curLabel}，Esc 取消）`,
                  '【否】', nodeId,
                );
                if (!newTarget) return;
                const newSource = changeDecisionTarget(diagramSource, nodeId, 'no', newTarget);
                const ok = await updateNoteSource(this.app, sourcePath, diagramSource, newSource);
                if (!ok) new Notice('更换【否】节点失败');
              }),
            );
          }

          menu.addSeparator();

          // 断开父节点（删除所有入边）
          menu.addItem((item) =>
            item.setTitle('断开父节点').onClick(async () => {
              const newSource = removeIncomingEdges(diagramSource, nodeId);
              const ok = await updateNoteSource(this.app, sourcePath, diagramSource, newSource);
              if (!ok) new Notice('断开父节点失败');
            }),
          );

          // 断开子节点（删除所有出边）
          menu.addItem((item) =>
            item.setTitle('断开子节点').onClick(async () => {
              const newSource = removeOutgoingEdges(diagramSource, nodeId);
              const ok = await updateNoteSource(this.app, sourcePath, diagramSource, newSource);
              if (!ok) new Notice('断开子节点失败');
            }),
          );

          menu.addSeparator();

          // 删除节点
          menu.addItem((item) =>
            item.setTitle('删除节点').setWarning(true).onClick(async () => {
              const newSource = deleteNode(diagramSource, nodeId);
              const ok = await updateNoteSource(this.app, sourcePath, diagramSource, newSource);
              if (!ok) new Notice('删除节点失败');
            }),
          );
        }
      } else {
        // 空白处右键：添加节点（可指定上下游，链接默认为节点名称）
        hasItems = true;
        menu.addItem((item) =>
          item.setTitle('添加节点').onClick(() => {
            if (!svg) return;
            new NodeEditModal(this.app, {
              title: '添加节点',
              initialLabel: '',
              initialLink: '',
              onSubmit: async (result) => {
                const label = result.label.trim();
                if (!label) return;
                const link = result.link.trim() || label; // 链接默认为节点名称

                // 点击选择上游节点（Esc 跳过）
                const upstream = await pickNode('请点击选择【上游】节点（Esc 跳过）', '【上游】', null);
                // 点击选择下游节点（Esc 跳过，不能与上游重复）
                const downstream = await pickNode('请点击选择【下游】节点（Esc 跳过）', '【下游】', upstream);

                // 创建节点并连接
                const { newSource } = addNode(diagramSource, {
                  label,
                  link,
                  connectFrom: upstream || undefined,
                  connectTo: downstream || undefined,
                });
                const ok = await updateNoteSource(this.app, sourcePath, diagramSource, newSource);
                if (!ok) {
                  const file = this.app.vault.getAbstractFileByPath(sourcePath);
                  if (!(file instanceof TFile)) new Notice('添加失败：找不到笔记文件');
                  else new Notice('添加失败：笔记源码已变化，请重新打开笔记后再试');
                }
              },
            }).open();
          }),
        );
      }
      if (hasItems) menu.showAtMouseEvent(ev);
    });

    // 当前选中节点
    const currentNodeId = getCurrentNode(sourcePath);

    // 当前节点按钮区域（选择当前节点 + 定位当前节点，同一行）
    const btnBar = wrapper.createDiv({ cls: 'mln-btn-bar' });
    // 按钮栏为 fixed 悬浮层（随屏幕滚动），append 即可，位置由 CSS 控制

    // ---- 导出整张完整图（非当前缩放视口） ----
    const fileNameBase = (sourcePath.split('/').pop() || 'mermaid-diagram').replace(/\.(md|markdown)$/i, '');
    // 导出目标文件夹：默认「笔记名+格式」命名（如：找工作流程的PNG图片），可在设置中更改
    const getExportFolder = async (kind: 'svg' | 'png'): Promise<string> => {
      const key = kind === 'png' ? this.settings.exportFolderPng : this.settings.exportFolderSvg;
      let folder = (key || '').trim().replace(/^\/+|\/+$/g, '');
      if (!folder) {
        const active = this.app.workspace.getActiveFile();
        const base = active ? active.basename : 'Mermaid导图';
        folder = `${base}的${kind === 'png' ? 'PNG' : 'SVG'}图片`;
      }
      const existing = this.app.vault.getAbstractFileByPath(folder);
      if (!(existing instanceof TFolder)) {
        try {
          await this.app.vault.createFolder(folder);
        } catch {
          // 文件夹已存在等情况，忽略
        }
      }
      return folder;
    };
    /** 写入 vault，同名文件自动加序号避免覆盖 */
    const writeToVault = async (name: string, data: ArrayBuffer, kind: 'svg' | 'png'): Promise<string | null> => {
      const folder = await getExportFolder(kind);
      const dot = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      let p = `${folder}/${name}`;
      for (let i = 1; this.app.vault.getAbstractFileByPath(p); i++) p = `${folder}/${stem}-${i}${ext}`;
      try {
        await this.app.vault.createBinary(p, data);
        return p;
      } catch (e) {
        new Notice(`写入失败：${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    };
    const getFullSvgClone = (): SVGSVGElement | null => {
      if (!svg) return null;
      const base = panZoom?.getBaseSize();
      if (!base || !base.width || !base.height) return null;
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('viewBox', `0 0 ${base.width} ${base.height}`);
      clone.setAttribute('width', String(base.width));
      clone.setAttribute('height', String(base.height));
      // 导出文件显示时居中
      clone.setAttribute('style', 'display:block;margin:0 auto;max-width:100%;height:auto;');
      // 移除可能引入外部资源（污染 canvas）的引用，保证 PNG 可导出
      // mermaid 节点文字在 <foreignObject> 里，必须保留；只移除可能加载外部资源的 <image>
      clone.querySelectorAll('image').forEach((el) => el.remove());
      clone.querySelectorAll('style').forEach((st) => {
        st.textContent = (st.textContent ?? '')
          .replace(/@import[^;]+;/gi, '')
          .replace(/url\(\s*(?!#)[^)]*\)/gi, 'url(#none)');
      });
      // 导出不保留"当前节点"红色高亮：恢复原样式、移除高亮类，所有节点格式一致
      clone.querySelectorAll<SVGElement>('.mln-current-node rect, .mln-current-node path, .mln-current-node circle, .mln-current-node polygon, .mln-current-node ellipse').forEach((shape) => {
        shape.style.stroke = shape.dataset.mlnOrigStroke ?? '';
        shape.style.strokeWidth = '';
        shape.style.fill = shape.dataset.mlnOrigFill ?? '';
        delete shape.dataset.mlnOrigStroke;
        delete shape.dataset.mlnOrigFill;
      });
      clone.querySelectorAll('.mln-current-node').forEach((el) => el.classList.remove('mln-current-node'));
      return clone;
    };
    const exportSvg = async () => {
      try {
        const clone = getFullSvgClone();
        if (!clone) { new Notice('导出失败：找不到 SVG'); return; }
        const xml = new XMLSerializer().serializeToString(clone);
        const data = new TextEncoder().encode(xml).buffer as ArrayBuffer;
        const p = await writeToVault(`${fileNameBase}.svg`, data, 'svg');
        if (p) new Notice(`SVG 已导出：${p}`);
      } catch (e) {
        new Notice(`SVG 导出失败：${e instanceof Error ? e.message : String(e)}`);
      }
    };
    const exportPng = async () => {
      const clone = getFullSvgClone();
      const base = panZoom?.getBaseSize();
      if (!clone || !base) { new Notice('导出失败：找不到 SVG'); return; }
      new Notice('正在导出 PNG…');
      const xml = new XMLSerializer().serializeToString(clone);
      // 用 data URL 加载（避免 blob URL 在部分环境触发跨域限制）
      const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      try {
        const img = new Image();
        await new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(new Error('SVG 图片加载失败'));
          img.src = dataUrl;
        });
        // 2 倍高清；超大图自动降级避免 canvas 尺寸上限（16384 边）
        const maxEdge = Math.max(base.width, base.height);
        const scale = Math.min(2, 16384 / maxEdge);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(base.width * scale));
        canvas.height = Math.max(1, Math.round(base.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('无法创建画布');
        // 纯白背景（默认 SVG 背景透明，导出 PNG 时填白）
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        // 画布被跨域资源污染时提前拦截，给出明确提示
        try {
          ctx.getImageData(0, 0, 1, 1);
        } catch {
          throw new Error('画布受浏览器跨域限制，无法导出 PNG，请改用 SVG 导出');
        }
        const pngBlob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
        if (!pngBlob) throw new Error('PNG 编码失败');
        const p = await writeToVault(`${fileNameBase}.png`, await pngBlob.arrayBuffer(), 'png');
        if (p) new Notice(`PNG 已导出：${p}（${canvas.width}×${canvas.height}）`);
      } catch (e) {
        new Notice(`PNG 导出失败：${e instanceof Error ? e.message : String(e)}`);
      }
    };
    const exportSvgBtn = btnBar.createDiv({ cls: 'mln-export-btn', text: '💾导出SVG' });
    exportSvgBtn.addEventListener('click', exportSvg);
    const exportPngBtn = btnBar.createDiv({ cls: 'mln-export-btn', text: '🖼️导出PNG' });
    exportPngBtn.addEventListener('click', exportPng);

    const selectBtn = btnBar.createDiv({ cls: 'mln-select-btn', text: currentNodeId ? '重新选择当前正在执行的节点' : '选择当前正在执行的节点' });
    let locateBtn: HTMLDivElement | null = null;
    let clearBtn: HTMLDivElement | null = null;

    /** 取消选中：清当前节点、清高亮、复位按钮 */
    const clearSelection = () => {
      setCurrentNode(sourcePath, null);
      nodeEls.forEach((g) => { if (g.classList.contains('mln-current-node')) clearCurrentNodeHighlight(g); });
      selectBtn.setText('选择当前正在执行的节点');
      locateBtn?.remove();
      locateBtn = null;
      clearBtn?.remove();
      clearBtn = null;
    };

    /** 确保定位/取消按钮存在（选中后显示） */
    const ensureActionButtons = () => {
      if (!locateBtn) {
        locateBtn = btnBar.createDiv({ cls: 'mln-locate-btn', text: '🎯 定位当前正在执行的节点' });
        locateBtn.addEventListener('click', () => {
          const cid = getCurrentNode(sourcePath);
          if (!cid) return;
          const targetG = nodeEls.find((g) => idOf.get(g) === cid);
          if (targetG && panZoom) panZoom.focusElement(targetG);
        });
      }
      if (!clearBtn) {
        clearBtn = btnBar.createDiv({ cls: 'mln-clear-btn', text: '取消选中当前正在执行的节点' });
        clearBtn.addEventListener('click', clearSelection);
      }
    };

    if (currentNodeId && knownIds.has(currentNodeId)) {
      ensureActionButtons();
    }

    // 选择当前节点模式：屏幕中间提示，点击节点即选中
    const startSelectMode = () => {
      const hint = document.createElement('div');
      hint.classList.add('mln-hint-center', 'mln-hint-bold');
      hint.textContent = '请选中当前正在执行的节点';
      document.body.appendChild(hint);

      const cleanup = () => {
        svg?.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKey);
        hint.remove();
      };
      const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') cleanup(); };
      const onClick = (ev: MouseEvent) => {
        const targetG = (ev.target as Element)?.closest('g.node') as SVGGElement | null;
        if (!targetG) return;
        const targetId = extractNodeId(targetG, renderId);
        if (!targetId || !knownIds.has(targetId)) return;
        ev.stopPropagation();
        setCurrentNode(sourcePath, targetId);
        cleanup();
        // 切换当前节点高亮：先清旧，再标新
        nodeEls.forEach((g) => { if (g.classList.contains('mln-current-node')) clearCurrentNodeHighlight(g); });
        applyCurrentNodeHighlight(targetG);
        // 更新按钮状态
        selectBtn.setText('重新选择当前正在执行的节点');
        ensureActionButtons();
        new Notice('已设为当前节点');
      };
      svg?.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey);
    };
    selectBtn.addEventListener('click', startSelectMode);

    nodeEls.forEach((g) => {
      const nodeId = idOf.get(g);
      const link = nodeId ? links.get(nodeId) : undefined;
      g.classList.add('mln-noselect');

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
            '';
          g.appendChild(title);
        }

        const open = async (ev: MouseEvent): Promise<void> => {
          ev.preventDefault();
          ev.stopPropagation();
          // 链接不存在且设置了目标文件夹、且链接本身未指定路径时，自动在该文件夹创建
          const targetPath = link.target.split('#')[0];
          const existed = !!this.app.metadataCache.getFirstLinkpathDest(targetPath, sourcePath);
          if (!existed && this.settings.newNoteFolder && !targetPath.includes('/')) {
            let folder = this.app.vault.getAbstractFileByPath(this.settings.newNoteFolder);
            if (!(folder instanceof TFolder)) {
              // 文件夹不存在，自动创建（含嵌套父文件夹）
              try {
                folder = await this.app.vault.createFolder(this.settings.newNoteFolder);
              } catch {
                folder = null;
              }
            }
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
                '';
              g.appendChild(title);
            }
          }
          await this.app.workspace.openLinkText(
            link.target,
            sourcePath,
            this.paneTypeFromEvent(ev),
          );
        };

        // 触屏设备（手机/平板）：单击直接跳转查看详情；桌面端：仅 Ctrl/⌘（或 Alt）+ 单击跳转
        g.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const isTouch = (window.matchMedia?.('(pointer: coarse)').matches ?? false) || ('ontouchstart' in window);
          if (isTouch || ev.ctrlKey || ev.metaKey || ev.altKey) void open(ev);
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
      } else if (nodeId && this.settings.showTooltip) {
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = link?.target ?? nodeId;
        g.appendChild(title);
      }
    });
    // 渲染时恢复当前节点高亮
    if (currentNodeId) {
      const curG = nodeEls.find((g) => idOf.get(g) === currentNodeId);
      if (curG) applyCurrentNodeHighlight(curG);
    }
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
    if (ev.button === 1) return 'tab'; // 鼠标中键始终新标签页
    if (ev.altKey) return 'split'; // Alt 始终分屏
    // Ctrl/⌘+单击尊重设置中的默认打开方式（当前标签页/新标签页/分屏）
    switch (this.settings.openMode) {
      case 'tab':
        return 'tab';
      case 'split':
        return 'split';
      default:
        return false; // 当前标签页
    }
  }

  /** 键盘事件的打开方式：Alt 分屏，Ctrl/⌘ 按设置默认方式 */
  private paneTypeFromModifiers(primary: boolean, alt: boolean): PaneType | boolean {
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
      .setDesc('开启后，普通 ```mermaid 代码块也由本插件渲染（节点跳转/定位生效）；关闭时请使用 ```mermaid-link 代码块。修改此项需重新加载插件。')
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

    new Setting(containerEl).setName('导出').setHeading();

    new Setting(containerEl)
      .setName('PNG 导出文件夹')
      .setDesc('导出 PNG 图片的存放位置。留空时自动使用「笔记名的PNG图片」文件夹（如“找工作流程的PNG图片”）；点击输入框可从仓库中选择固定文件夹，之后所有 PNG 都导出到那里。')
      .addText((text) => {
        new FolderSuggest(this.app, text.inputEl);
        text
          .setPlaceholder('留空 = 笔记名的PNG图片')
          .setValue(this.plugin.settings.exportFolderPng)
          .onChange(async (v) => {
            this.plugin.settings.exportFolderPng = v.trim().replace(/^\/+|\/+$/g, '');
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('SVG 导出文件夹')
      .setDesc('导出 SVG 图片的存放位置。留空时自动使用「笔记名的SVG图片」文件夹（如“找工作流程的SVG图片”）；点击输入框可从仓库中选择固定文件夹，之后所有 SVG 都导出到那里。')
      .addText((text) => {
        new FolderSuggest(this.app, text.inputEl);
        text
          .setPlaceholder('留空 = 笔记名的SVG图片')
          .setValue(this.plugin.settings.exportFolderSvg)
          .onChange(async (v) => {
            this.plugin.settings.exportFolderSvg = v.trim().replace(/^\/+|\/+$/g, '');
            await this.plugin.saveSettings();
          });
      });

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
