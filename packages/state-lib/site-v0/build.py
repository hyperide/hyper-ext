#!/usr/bin/env python3
"""Regenerate the md-derived pages of the state-lib site. Run from site/."""
import markdown, pathlib
with open('index.html', encoding='utf-8') as f:
    NAV = f.read().split('<nav class="top">')[1].split('</nav>')[0]
def page(src, out, title, wide=False):
    body = markdown.markdown(pathlib.Path(src).read_text(), extensions=['tables','fenced_code'])
    nav = '<nav class="top">' + NAV.replace('class="on" ','').replace(f'href="{out}"', f'class="on" href="{out}"') + '</nav>'
    pathlib.Path(out).write_text(f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="state.css"></head><body>{nav}
<div class="wrap{' wide' if wide else ''}"><header class="page"><p class="kicker">state-lib · docs</p></header><div class="tblwrap">{body}</div>
<footer>Generated from markdown — edit the .md, rerun build.py.</footer></div></body></html>''')
page('../REQUIREMENTS.md','requirements.html','Requirements')
page('../DECISIONS.md','decisions.html','Decision log', wide=True)
page('../docs/2026-09-01-state-master-spec.md','spec.html','Master spec', wide=True)
page('../docs/2026-09-01-state-management-research-brief.md','brief.html','Research brief', wide=True)
