/**
 * 从渲染后的 SVG 节点 <g> 上还原 mermaid 源码中的节点 id。
 * 不同 mermaid 渲染路径输出不同：
 * - neo 等新路径：g[data-id="源id"]
 * - classic 路径：g[id="{renderId}-flowchart-{源id}-{序号}"]，没有 data-id
 * 拿不到时返回 undefined，由调用方按节点文本兜底匹配。
 */

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractNodeId(el: Element, renderId: string): string | undefined {
  const dataId = el.getAttribute('data-id');
  if (dataId) return dataId;

  const domId = el.getAttribute('id') ?? '';
  const re = new RegExp(`^${escapeRegExp(renderId)}-(?:flowchart|graph)-(.*)-\\d+$`);
  const matched = domId.match(re);
  if (matched) return matched[1];

  return undefined;
}
