import { useEffect } from 'react';
import { useRoute } from './router';
import { snippetHref } from './snippet-transfer';
/** Add actions without reparenting React-owned nodes. A mutation-local scan avoids
 * revisiting every code block on long spec pages whenever a tooltip opens. */
export function SnippetActions() {
  const route = useRoute();
  useEffect(() => {
    if (route.startsWith('/repl') || route.startsWith('/playground')) return;
    const sources = new WeakMap<HTMLPreElement, string>();
    const decorate = (pre: HTMLPreElement) => {
      if (pre.closest('.cm-editor, .repl-output, [data-no-try]')) return;
      if (pre.parentElement?.classList.contains('codeblock') && pre.parentElement.querySelector(':scope > .code-repl'))
        return;
      const code = pre.querySelector('code');
      let source = code?.textContent;
      if (source == null) {
        const clone = pre.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('.snippet-inline-action').forEach((a) => a.remove());
        source = clone.textContent ?? '';
      }
      const prior = pre.querySelector<HTMLAnchorElement>(':scope > .snippet-inline-action');
      if (prior && sources.get(pre) === source) return;
      const classes = `${code?.className ?? ''} ${pre.className}`;
      const lang = /(?:language-|lang-)([\w-]+)/.exec(classes)?.[1] ?? 'text';
      const link = prior ?? document.createElement('a');
      link.className = 'code-repl snippet-inline-action';
      link.textContent = 'try it →';
      link.title = 'Open this exact source. Unloaded languages stay editable reference examples.';
      try {
        link.href = snippetHref(source, lang);
      } catch {
        return;
      }
      sources.set(pre, source);
      if (!prior) pre.append(link);
      pre.classList.add('has-snippet-action');
    };
    const scan = (el: Element) => {
      if (el.matches('pre')) decorate(el as HTMLPreElement);
      else el.querySelectorAll<HTMLPreElement>('pre').forEach(decorate);
    };
    const observer = new MutationObserver((records) => {
      const affected = new Set<Element>();
      for (const record of records) {
        const el = record.target instanceof Element ? record.target : record.target.parentElement;
        const pre = el?.closest('pre');
        if (pre) affected.add(pre);
        for (const node of record.addedNodes)
          if (node instanceof Element && !node.matches('.snippet-inline-action')) affected.add(node);
      }
      affected.forEach(scan);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    scan(document.body);
    return () => observer.disconnect();
  }, [route]);
  return null;
}
