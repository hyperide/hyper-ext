import type { Heading } from './Toc';
import type { SearchHit } from './search';

export type NavigationScope = 'site' | 'page';
export type PageEntry = SearchHit & { level: number };

/** One text-only traversal; never clone highlighted HTML or force layout to build an index. */
export function pageEntries(headings: Heading[], route: string): PageEntry[] {
  const root = document.getElementById('page-content');
  if (!root) return [];
  const byId = new Map(headings.map((heading) => [heading.id, heading]));
  const found: (PageEntry & { chunks: string[] })[] = [];
  const stack = Array.from(root.childNodes).reverse();
  let current: (PageEntry & { chunks: string[] }) | undefined;
  while (stack.length) {
    const node = stack.pop()!;
    if (node.nodeType === 3) {
      if (current) current.chunks.push(node.textContent ?? '');
      continue;
    }
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    if (
      element.matches(
        'script, style, button, svg, [hidden], [aria-hidden="true"], [data-no-export], .toc, .cm-editor, .ref-backlinks',
      )
    )
      continue;
    const diagramSource = element.getAttribute('data-diagram-source');
    if (diagramSource) current?.chunks.push(` ${diagramSource} `);
    const heading = byId.get(element.id);
    if (heading && /^H[1-6]$/.test(element.tagName)) {
      current = {
        title: heading.text.replace(/\s*[¶#↗]$/, '').trim(),
        body: '',
        kind: 'heading',
        route,
        anchor: heading.id,
        score: 0,
        level: heading.level,
        chunks: [],
      };
      found.push(current);
      continue;
    }
    if (/^(P|DIV|PRE|LI|TABLE|TR|SECTION|ARTICLE|FIGCAPTION|BR|H[1-6])$/.test(element.tagName))
      current?.chunks.push(' ');
    // Read terminal prose/code blocks in one operation, but never include hidden
    // or interactive content that the traversal below deliberately excludes.
    if (
      /^(P|CODE|FIGCAPTION)$/.test(element.tagName) &&
      !element.querySelector(
        'h1,h2,h3,h4,h5,h6,p,div,pre,li,table,tr,section,article,figcaption,br,script,style,button,svg,details,[hidden],[aria-hidden="true"],[data-no-export],.toc,.ref-backlinks',
      )
    ) {
      current?.chunks.push(element.textContent ?? '', ' ');
      continue;
    }
    if (element.tagName === 'DETAILS' && !element.hasAttribute('open')) {
      const summary = element.querySelector(':scope > summary');
      if (summary) stack.push(summary);
      continue;
    }
    stack.push(...Array.from(element.childNodes).reverse());
  }
  return found.map(({ chunks, ...entry }) => ({ ...entry, body: chunks.join('').replace(/\s+/g, ' ').trim() }));
}

export function filterPageEntries(entries: PageEntry[], query: string): PageEntry[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return entries;
  return entries
    .map((entry) => {
      const title = entry.title.toLocaleLowerCase(),
        body = entry.body.toLocaleLowerCase();
      const matches = terms.every((term) => title.includes(term) || body.includes(term));
      return { ...entry, score: matches ? 1 + terms.filter((term) => title.includes(term)).length * 4 : 0 };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}
export function resultExcerpt(body: string, query: string): string {
  const term = query.trim().split(/\s+/)[0]?.toLocaleLowerCase() ?? '';
  const position = term ? body.toLocaleLowerCase().indexOf(term) : 0;
  const start = Math.max(0, position - 35);
  return `${start ? '…' : ''}${body.slice(start, start + 150)}${body.length > start + 150 ? '…' : ''}`;
}
