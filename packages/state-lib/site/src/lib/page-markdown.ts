/** One semantic export, shared by Copy page and the static build. Never copy
 * innerText alone: that loses code fences, links, headings and table structure. */
export function pageMarkdown(root: Element, url: string): string {
  const copy = root.cloneNode(true) as Element;
  copy
    .querySelectorAll(
      '[data-no-export], .toc, .ref-backlinks, .repl-pick, .repl-sidebar-switch, .heading-link, .headinglinks, button, script, style, .cm-gutters, .cm-tooltip',
    )
    .forEach((e) => e.remove());
  const absolute = (path: string) => {
    try {
      return new URL(path, url).href;
    } catch {
      return path;
    }
  };
  const text = (n: Node, inTable = false): string =>
    Array.from(n.childNodes)
      .map((child) => walk(child, inTable))
      .join('');
  const code = (body: string, language = '') => {
    const longest = Math.max(2, ...Array.from(body.matchAll(/`+/g), (m) => m[0].length));
    const fence = '`'.repeat(longest + 1);
    return `\n\n${fence}${language}\n${body.trimEnd()}\n${fence}\n\n`;
  };
  function walk(n: Node, inTable = false): string {
    if (n.nodeType === 3) {
      const value = (n.textContent ?? '').replace(/\s+/g, ' ');
      return inTable ? value.replace(/[\\|*_`[\]]/g, (char) => `\\${char}`) : value;
    }
    if (!(n instanceof Element)) return '';
    const tag = n.tagName.toLowerCase();
    if (n.hasAttribute('data-diagram-source'))
      return `\n${n.querySelector('figcaption')?.textContent ?? ''}\n${code(n.getAttribute('data-diagram-source') ?? '', 'text')}`;
    if (n.hasAttribute('data-code-source') || n.hasAttribute('data-literate-source'))
      return code(
        n.getAttribute('data-code-source') ?? n.getAttribute('data-literate-source') ?? '',
        n.getAttribute('data-source-lang') ?? 'ts',
      );
    if (n.classList.contains('editor-shell')) return code(n.querySelector('.editor-static')?.textContent ?? '', 'tsx');
    if (n.classList.contains('cm-host')) {
      const lines = Array.from(n.querySelectorAll('.cm-line'), (e) => e.textContent ?? '');
      return code(lines.join('\n'), 'tsx');
    }
    if (tag === 'pre')
      return code(n.textContent ?? '', /(?:language-|lang-)([\w-]+)/.exec(`${n.innerHTML} ${n.className}`)?.[1] ?? '');
    if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${text(n, inTable).trim()}\n\n`;
    if (tag === 'code') {
      const body = n.textContent ?? '';
      // GFM's table prepass treats backslashes before pipes differently from
      // inline code. HTML character references preserve both without column splits.
      if (inTable)
        return `<code>${body.replace(/[&<>|\\]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '|': '&#124;', '\\': '&#92;' })[char]!)}</code>`;
      const fence = '`'.repeat(Math.max(0, ...Array.from(body.matchAll(/`+/g), (m) => m[0].length)) + 1);
      return `${fence} ${body} ${fence}`;
    }
    if (tag === 'svg')
      return `\n\n[Diagram: ${n.getAttribute('aria-label') ?? n.querySelector('title')?.textContent ?? 'see adjacent caption'}]\n\n`;
    if (tag === 'img') return `![${n.getAttribute('alt') ?? ''}](${absolute(n.getAttribute('src') ?? '')})`;
    if (tag === 'a') {
      const label = text(n, inTable).trim();
      return label ? `[${label}](${absolute(n.getAttribute('href') ?? '')})` : '';
    }
    if (tag === 'table') {
      const rows = Array.from(n.querySelectorAll('tr'), (row) =>
        Array.from(row.children, (c) => text(c, true).trim().replace(/\n+/g, '<br>')),
      );
      const width = Math.max(0, ...rows.map((r) => r.length));
      if (!width) return '';
      const line = (r: string[]) => `| ${[...r, ...Array(width - r.length).fill('')].join(' | ')} |`;
      return `\n\n${[line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n')}\n\n`;
    }
    if (tag === 'li') {
      const parent = n.parentElement;
      let marker = '- ';
      if (parent?.tagName.toLowerCase() === 'ol') {
        const siblings = Array.from(parent.children).filter((e) => e.tagName.toLowerCase() === 'li');
        const integer = (value: string | null): number | undefined => {
          if (value === null) return undefined;
          const parsed = Number.parseInt(value, 10);
          return Number.isSafeInteger(parsed) ? parsed : undefined;
        };
        const direction = parent.hasAttribute('reversed') ? -1 : 1;
        let ordinal = integer(parent.getAttribute('start')) ?? (direction === -1 ? siblings.length : 1);
        for (const sibling of siblings) {
          ordinal = integer(sibling.getAttribute('value')) ?? ordinal;
          if (sibling === n) break;
          ordinal += direction;
        }
        marker = `${ordinal}. `;
      }
      return `\n${marker}${text(n, inTable).trim().replace(/\n/g, '\n  ')}`;
    }
    if (tag === 'ul' || tag === 'ol') return `\n${text(n, inTable)}\n`;
    if (tag === 'br') return '\n';
    if (tag === 'strong' || tag === 'b') return `**${text(n, inTable).trim()}**`;
    if (tag === 'em' || tag === 'i') return `*${text(n, inTable).trim()}*`;
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return '';
    if (
      ['p', 'section', 'article', 'header', 'footer', 'figure', 'figcaption', 'div', 'details', 'summary'].includes(tag)
    )
      return `\n${text(n, inTable)}\n`;
    return text(n, inTable);
  }
  return `${walk(copy)
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

export function markdownPath(route: string): string {
  return route === '/' ? '/index.md' : `${route.replace(/\/+$/, '')}.md`;
}
