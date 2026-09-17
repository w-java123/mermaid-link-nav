# -*- coding: utf-8 -*-
"""Fix obsidian community review error 'no-static-style-assignment':
- highlight moved to CSS classes (no inline style writes in JS)
- export centering injected as <style> node instead of style attribute"""
import io

main_path = r"C:\Users\w\Doubao\chats\2026-09-14\new-chat\mermaid-link-nav\src\main.ts"
css_path = r"C:\Users\w\Doubao\chats\2026-09-14\new-chat\mermaid-link-nav\styles.css"

with io.open(main_path, encoding="utf-8") as f:
    content = f.read()

# 1. drop CURRENT_NODE_COLOR constant
old = "const CURRENT_NODE_COLOR = '#e93147';\n"
assert old in content, "const anchor not found"
content = content.replace(old, "")

# 2. applyCurrentNodeHighlight -> class only
old = """/** 应用当前节点高亮：红色底填充 + 粗描边 + 呼吸光晕（record 原值便于恢复） */
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
}"""
new = """/** 应用当前节点高亮：加 CSS 类（红色填充 + 粗描边 + 呼吸光晕），样式在 styles.css */
function applyCurrentNodeHighlight(nodeG: SVGGElement): void {
  nodeG.classList.add('mln-current-node');
}

/** 清除当前节点高亮：移除 CSS 类，恢复 mermaid 默认样式 */
function clearCurrentNodeHighlight(nodeG: SVGGElement): void {
  nodeG.classList.remove('mln-current-node');
}"""
assert old in content, "highlight funcs anchor not found"
content = content.replace(old, new)

# 3. export: centering via <style> node
old = """      // 导出文件显示时居中
      clone.setAttribute('style', 'display:block;margin:0 auto;max-width:100%;height:auto;');"""
new = """      // 导出文件显示时居中（以 svg 内 <style> 规则实现，避免直接给元素设置 style）
      const centerStyle = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      centerStyle.textContent = 'svg{display:block;margin:0 auto;max-width:100%;height:auto;}';
      clone.insertBefore(centerStyle, clone.firstChild);"""
assert old in content, "export center anchor not found"
content = content.replace(old, new)

# 4. export: drop shape style restore, keep class removal
old = """      // 导出不保留"当前节点"红色高亮：恢复原样式、移除高亮类，所有节点格式一致
      clone.querySelectorAll<SVGElement>('.mln-current-node rect, .mln-current-node path, .mln-current-node circle, .mln-current-node polygon, .mln-current-node ellipse').forEach((shape) => {
        shape.style.stroke = shape.dataset.mlnOrigStroke ?? '';
        shape.style.strokeWidth = '';
        shape.style.fill = shape.dataset.mlnOrigFill ?? '';
        delete shape.dataset.mlnOrigStroke;
        delete shape.dataset.mlnOrigFill;
      });
      clone.querySelectorAll('.mln-current-node').forEach((el) => el.classList.remove('mln-current-node'));"""
new = """      // 导出不保留"当前节点"高亮：移除高亮类（样式在 Obsidian CSS 中，不在导出文件里），所有节点格式一致
      clone.querySelectorAll('.mln-current-node').forEach((el) => el.classList.remove('mln-current-node'));"""
assert old in content, "export restore anchor not found"
content = content.replace(old, new)

with io.open(main_path, "w", encoding="utf-8", newline="") as f:
    f.write(content)
print("main.ts: static style assignments removed")

# ---- styles.css: shape highlight rules ----
with io.open(css_path, encoding="utf-8") as f:
    css = f.read()

old_css = """/* 当前节点高亮光晕 */
.mln-current-node {
  filter: drop-shadow(0 0 6px rgba(233, 49, 71, 0.75));
}"""
new_css = """/* 当前节点高亮：形状填充与描边（由 JS 添加/移除类控制） */
.mln-current-node rect,
.mln-current-node path,
.mln-current-node circle,
.mln-current-node polygon,
.mln-current-node ellipse {
  stroke: #e93147 !important;
  stroke-width: 4px !important;
  fill: rgba(255, 90, 105, 0.3) !important;
}

/* 当前节点高亮光晕 */
.mln-current-node {
  filter: drop-shadow(0 0 6px rgba(233, 49, 71, 0.75));
}"""
assert old_css in css, "css anchor not found"
css = css.replace(old_css, new_css)

with io.open(css_path, "w", encoding="utf-8", newline="") as f:
    f.write(css)
print("styles.css: shape highlight rules added")
