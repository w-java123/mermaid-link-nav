/**
 * 节点编辑模态框：添加节点 / 编辑节点名称和跳转链接。
 */
import { App, Modal, Setting } from 'obsidian';

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
