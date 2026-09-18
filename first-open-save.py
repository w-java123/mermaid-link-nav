# -*- coding: utf-8 -*-
"""On first open (no cached viewBox), save the current view immediately so
mln-viewbox.json always exists and gets synced to mobile."""
import io

p = r"C:\Users\w\Doubao\chats\2026-09-14\new-chat\mermaid-link-nav\src\pan-zoom.ts"
with io.open(p, encoding="utf-8") as f:
    c = f.read()

old = """    // 恢复之前的缩放/平移状态
    if (cacheKey) {
      const cached = viewBoxCache.get(cacheKey);
      if (cached) this.writeBox(cached);
      // 监听 viewBox 变化（包括聚焦动画），自动保存"""
new = """    // 恢复之前的缩放/平移状态
    if (cacheKey) {
      const cached = viewBoxCache.get(cacheKey);
      if (cached) {
        this.writeBox(cached);
      } else {
        // 首次打开：立即保存当前视图，确保 mln-viewbox.json 存在并可被同步
        viewBoxCache.set(cacheKey, { ...this.current });
        saveCache();
      }
      // 监听 viewBox 变化（包括聚焦动画），自动保存"""
assert old in c, "anchor not found"
c = c.replace(old, new)

with io.open(p, "w", encoding="utf-8", newline="") as f:
    f.write(c)
print("first-open save added")
