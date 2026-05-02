import type { ReactNode } from 'react';

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightSearch(text: string, query: string): ReactNode {
  if (!query) return text;
  // nosemgrep: detect-non-literal-regexp -- query is sanitized via escapeRegExp above
  const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  const lower = query.toLowerCase();
  return parts.map((part, i) =>
    part.toLowerCase().includes(lower) ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: stable split order from regex, no reordering
      <mark key={i} className="bg-yellow-500/30 dark:bg-yellow-400/20 text-inherit rounded-sm">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

const MARK_CLASS = 'bg-yellow-500/30 dark:bg-yellow-400/20 text-inherit rounded-sm';

/**
 * Wrap search matches in <mark> inside an already-rendered HTML string
 * (e.g. output of AnsiUp.ansi_to_html). Walks text nodes only so existing
 * tags (span classes/styles from ansi_up) are preserved verbatim.
 *
 * Runs in a detached document fragment via DOMParser; assumes the host
 * environment is a browser/webview (DOMParser is globally available).
 */
export function highlightSearchInHtml(html: string, query: string): string {
  if (!query) return html;
  const trimmed = query.trim();
  if (!trimmed) return html;

  // Wrap into a host element so DOMParser returns a well-formed body
  // even for fragment-level HTML like "<span>foo</span>bar".
  const doc = new DOMParser().parseFromString(`<div id="__root">${html}</div>`, 'text/html');
  const root = doc.getElementById('__root');
  if (!root) return html;

  // nosemgrep: detect-non-literal-regexp -- query is sanitized via escapeRegExp
  const regex = new RegExp(escapeRegExp(trimmed), 'gi');

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    targets.push(current as Text);
    current = walker.nextNode();
  }

  for (const textNode of targets) {
    const text = textNode.nodeValue ?? '';
    if (!text) continue;
    regex.lastIndex = 0;
    if (!regex.test(text)) continue;
    regex.lastIndex = 0;

    const frag = doc.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null = regex.exec(text);
    while (match !== null) {
      if (match.index > lastIndex) {
        frag.appendChild(doc.createTextNode(text.slice(lastIndex, match.index)));
      }
      const mark = doc.createElement('mark');
      mark.className = MARK_CLASS;
      mark.textContent = match[0];
      frag.appendChild(mark);
      lastIndex = match.index + match[0].length;
      // Guard against zero-length matches (shouldn't happen with escaped literal)
      if (match[0].length === 0) regex.lastIndex++;
      match = regex.exec(text);
    }
    if (lastIndex < text.length) {
      frag.appendChild(doc.createTextNode(text.slice(lastIndex)));
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }

  return root.innerHTML;
}
