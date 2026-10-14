import { useEffect } from 'react';
import { useRoute } from './router';
import { snippetHref } from './snippet-transfer';
import { guideFor, guideHref } from './learning';

/** Decorate authored Markdown locally; React Code components own their own actions. */
export function SnippetActions() {
  const route = useRoute();
  useEffect(() => {
    if (route.startsWith('/repl') || route.startsWith('/playground')) return;
    const root = document.getElementById('page-content');
    if (!root) return;
    const sources = new WeakMap<Element, string>();
    const decorate = (element: HTMLElement) => {
      if (element.closest('.cm-editor, .repl-output, [data-no-try]') || element.classList.contains('codeblock')) return;
      if (element.tagName === 'PRE' && element.parentElement?.closest('[data-code-source], [data-literate-source]'))
        return;
      let source = element.dataset.codeSource ?? element.querySelector('code')?.textContent;
      if (source == null) {
        const clone = element.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('.snippet-inline-action').forEach((action) => action.remove());
        source = clone.textContent ?? '';
      }
      if (sources.get(element) === source) return;
      const code = element.querySelector('code');
      const lang =
        element.dataset.sourceLang ??
        /(?:language-|lang-)([\w-]+)/.exec(`${code?.className ?? ''} ${element.className}`)?.[1] ??
        'text';
      const context = element.closest('article, section')?.querySelector('h2, h3, h4')?.textContent ?? '';
      const guide = guideFor(source, context);
      let sourceUrl: string;
      try {
        sourceUrl = snippetHref(source, lang);
      } catch {
        return;
      }
      element.querySelector(':scope > .snippet-inline-action')?.remove();
      const actions = document.createElement('span');
      actions.className = 'sample-actions snippet-inline-action';
      actions.setAttribute('data-no-export', '');
      if (guide) {
        const example = document.createElement('a');
        example.className = 'code-repl';
        example.href = guideHref(guide.id);
        example.textContent = 'Try example →';
        example.title = `Related complete example: ${guide.title}`;
        actions.append(example);
      }
      const reference = document.createElement('a');
      reference.className = 'code-source';
      reference.href = sourceUrl;
      reference.textContent = 'View source';
      reference.title = 'Inspect this exact source; no automatic execution';
      actions.append(reference);
      element.append(actions);
      sources.set(element, source);
    };
    const scan = (element: Element) => {
      if (element.matches('pre, [data-code-source]')) decorate(element as HTMLElement);
      element.querySelectorAll<HTMLElement>('pre, [data-code-source]').forEach(decorate);
    };
    const observer = new MutationObserver((records) => {
      const affected = new Set<Element>();
      for (const record of records) {
        const parent = record.target instanceof Element ? record.target : record.target.parentElement;
        const block = parent?.closest('pre, [data-code-source]');
        if (block) affected.add(block);
        for (const node of record.addedNodes)
          if (node instanceof Element && !node.closest('.snippet-inline-action')) affected.add(node);
      }
      affected.forEach(scan);
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    scan(root);
    return () => observer.disconnect();
  }, [route]);
  return null;
}
