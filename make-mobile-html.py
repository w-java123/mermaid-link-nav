# -*- coding: utf-8 -*-
"""Rebuild preview at MOBILE width (390px) to reproduce the user's phone rendering."""
import io

note_path = r"C:\Users\w\Documents\找工作流程\找工作流程\找工作流程.md"
out_path = r"C:\Users\w\Doubao\chats\2026-09-14\new-chat\mermaid-link-nav\flow-mobile.html"
with io.open(note_path, encoding="utf-8") as f:
    content = f.read()
m = content.split("```mermaid\n")[1].split("\n```")[0]

html = """<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=390">
<style>
  body { margin: 0; background: #ffffff; width: 390px; }
  #diagram { margin: 0 auto; }
  #diagram svg { display: block; }
</style>
</head>
<body>
<div id="diagram" class="mermaid">
__CODE__
</div>
<script src="file:///C:/Users/w/Doubao/chats/2026-09-14/new-chat/mermaid-link-nav/node_modules/mermaid/dist/mermaid.min.js"></script>
<script>
  mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'loose',
    flowchart: { curve: 'basis', htmlLabels: true, useMaxWidth: true } });
</script>
</body>
</html>
"""
html = html.replace("__CODE__", m)
with io.open(out_path, "w", encoding="utf-8", newline="") as f:
    f.write(html)
print("mobile html rebuilt")
