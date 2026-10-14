import { useEffect } from 'react';
import { useRoute } from './router';

const descriptions: Record<string, string> = {
  '/': 'state is a state-management library built around UX by default: coherent changes, precise updates, cancellation and history. Explore the working prototype.',
  '/api':
    'Explore state-lib types, functions and contracts, with TypeScript signatures and examples. Working prototype APIs are separate from planned production APIs.',
  '/concepts':
    'Understand state-lib concepts: reactive reads, atomic changes, history, collections and ownership. Each concept links to a specific explanation.',
  '/concepts/practical':
    'Learn state-lib through practical examples of transactions, normalized data, reactive selectors, cancellation and safe user-interface updates.',
  '/spec':
    'Read the state-lib design specification: requirements, architecture, public API proposals, native-kernel research and explicit implementation boundaries.',
};
export function pageDescription(route: string, title = ''): string {
  if (descriptions[route]) return descriptions[route];
  if (route === '/repl/snippet')
    return 'Inspect and edit the exact source snippet you opened, including comments and declared dependencies. Nothing runs on entry; execution is an explicit action.';
  if (route === '/playground' || route === '/repl' || route.startsWith('/repl/'))
    return 'Try an interactive state-management example: run it, change the live UI, inspect the result and edit the code. Execution starts only when you choose.';
  return `${title || 'Documentation'} — state-lib state-management concepts, implementation notes and examples. Explore the source and distinguish working APIs from planned features.`;
}
export function SiteMetadata() {
  const route = useRoute();
  useEffect(() => {
    const title = document.querySelector('#page-content h1')?.textContent?.replace(/\s+/g, ' ').trim() || 'state';
    for (const name of ['description', 'og:description']) {
      const key = name.startsWith('og:') ? 'property' : 'name';
      let node = document.head.querySelector<HTMLMetaElement>(`meta[${key}="${name}"]`);
      if (!node) {
        node = document.createElement('meta');
        node.setAttribute(key, name);
        document.head.append(node);
      }
      node.content = pageDescription(route, title);
    }
    document.title = route === '/' ? 'state — State management, UX by default' : `${title} · state`;
  }, [route]);
  return null;
}
