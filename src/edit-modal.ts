/**
 * 节点编辑模态框：添加节点 / 编辑节点名称和跳转链接。
 */
import { App, FuzzySuggestModal, Modal, Setting } from 'obsidian';

export interface NodeEditResult {
  label: string;
  link: string;
  /** 添加节点时：从哪个现有节点连过来 */
  connectFrom?: string;
}

export interface NodeOption {
  id: string;
  label: string;
}

export class NodeEditModal extends Modal {
  private result: NodeEditResult;
  private readonly onSubmit: (result: NodeEditResult) => void;
  private readonly isEdit: boolean;
  private readonly nodeOptions: NodeOption[];

  constructor(
    app: App,
    opts: {
      title: string;
      initialLabel?: string;
      initialLink?: string;
      nodeOptions?: NodeOption[];
      showConnectFrom?: boolean;
      onSubmit: (result: NodeEditResult) => void;
    },
  ) {
    super(app);
    this.result = {
      label: opts.initialLabel ?? '',
      link: opts.initialLink ?? '',
      connectFrom: opts.nodeOptions?.[0]?.id,
    };
    this.onSubmit = opts.onSubmit;
    this.isEdit = !opts.showConnectFrom;
    this.nodeOptions = opts.nodeOptions ?? [];
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.isEdit ? '编辑节点' : '添加节点' });

    new Setting(contentEl)
      .setName('节点名称')
      .addText((text) =>
        text
          .setPlaceholder('例如：学习前端')
          .setValue(this.result.label)
          .onChange((v) => {
            this.result.label = v;
          }),
      );

    new Setting(contentEl)
      .setName('跳转笔记链接')
      .setDesc('填写笔记名，如 "前端学习" 或 "文件夹/笔记"。留空则不跳转。')
      .addText((text) =>
        text
          .setPlaceholder('例如：前端学习')
          .setValue(this.result.link)
          .onChange((v) => {
            this.result.link = v;
          }),
      );

    if (!this.isEdit && this.nodeOptions.length > 0) {
      new Setting(contentEl)
        .setName('从哪个节点连过来')
        .setDesc('新节点将作为所选节点的下游。选"不连线"则创建孤立节点。')
        .addDropdown((dd) => {
          dd.addOption('', '不连线');
          this.nodeOptions.forEach((n) => {
            const display = n.label ? `${n.label}（${n.id}）` : n.id;
            dd.addOption(n.id, display);
          });
          dd.setValue(this.result.connectFrom ?? '');
          dd.onChange((v) => {
            this.result.connectFrom = v || undefined;
          });
        });
    }

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText('确定')
        .setCta()
        .onClick(() => {
          if (!this.result.label.trim()) {
            btn.setButtonText('请填写节点名称');
            btn.setDisabled(true);
            window.setTimeout(() => {
              btn.setButtonText('确定');
              btn.setDisabled(false);
            }, 1500);
            return;
          }
          this.onSubmit(this.result);
          this.close();
        }),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** 从已存在节点中搜索选择一个，用于添加父子连线 */
export class NodeSelectModal extends FuzzySuggestModal<NodeOption> {
  private readonly onChoose: (id: string) => void;
  private readonly items: NodeOption[];

  constructor(app: App, items: NodeOption[], onChoose: (id: string) => void, title?: string) {
    super(app);
    this.items = items;
    this.onChoose = onChoose;
    this.setPlaceholder('输入节点名称搜索…');
    if (title && this.titleEl) this.titleEl.setText(title);
  }

  getItems(): NodeOption[] {
    return this.items;
  }

  getItemText(item: NodeOption): string {
    return item.label ? `${item.label}（${item.id}）` : item.id;
  }

  onChooseItem(item: NodeOption): void {
    this.onChoose(item.id);
  }
}
