import { useEffect, useRef, useState } from 'react';
import { currentRoute, HISTORY_MODE, useRoute } from './router';
import { pageMarkdown, markdownPath } from './page-markdown';

declare global {
  interface Window {
    __STATE_DOCS__?: { markdown: () => string };
  }
}
export function CopyPage() {
  const route = useRoute();
  const [status, setStatus] = useState('');
  const menu = useRef<HTMLDetailsElement>(null);
  const current = () =>
    pageMarkdown(document.querySelector('#page-content')!, `https://state-lib.vercel.app${currentRoute()}`);
  useEffect(() => {
    window.__STATE_DOCS__ = { markdown: current };
    setStatus('');
    if (menu.current) menu.current.open = false;
    return () => {
      delete window.__STATE_DOCS__;
    };
  }, [route]);
  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof KeyboardEvent || !menu.current?.contains(e.target as Node)) {
        if (menu.current) menu.current.open = false;
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
  const copy = async (kind: 'page' | 'url') => {
    try {
      let value = kind === 'url' ? location.href : current();
      if (kind === 'page' && HISTORY_MODE) {
        try {
          const response = await fetch(markdownPath(route));
          if (response.ok && /text\/(plain|markdown)/.test(response.headers.get('content-type') ?? ''))
            value = await response.text();
        } catch {
          /* The same exporter works from disk and during local development. */
        }
      }
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const input = document.createElement('textarea');
        input.value = value;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.append(input);
        input.select();
        const ok = document.execCommand('copy');
        input.remove();
        if (!ok) throw new Error('clipboard unavailable');
      }
      setStatus(kind === 'page' ? 'Markdown copied' : 'Link copied');
    } catch {
      setStatus('Copy unavailable — use View Markdown');
    }
    if (menu.current) menu.current.open = false;
  };
  return (
    <div className="doc-actions wrap" data-no-export>
      <span className="copy-status" role="status">
        {status}
      </span>
      <div className="copy-split">
        <button type="button" onClick={() => void copy('page')}>
          Copy page
        </button>
        <details ref={menu}>
          <summary aria-label="More page actions">▾</summary>
          <div className="copy-menu">
            <a
              data-native
              href={HISTORY_MODE ? markdownPath(route) : `https://state-lib.vercel.app${markdownPath(route)}`}
            >
              View Markdown
            </a>
            <button type="button" onClick={() => void copy('url')}>
              Copy page link
            </button>
            <a data-native href={HISTORY_MODE ? '/llms.txt' : 'https://state-lib.vercel.app/llms.txt'}>
              Documentation index · llms.txt
            </a>
            <a data-native href={HISTORY_MODE ? '/llms-full.txt' : 'https://state-lib.vercel.app/llms-full.txt'}>
              All documentation · text
            </a>
          </div>
        </details>
      </div>
    </div>
  );
}
