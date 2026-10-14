import { href } from './router';
export type Snippet = { code: string; lang: string; title?: string; origin?: string };
const MAX_BYTES = 180_000;
/** The URL carries the exact displayed text, not an id for a merely related example.
 * No snippet loaded from a URL is executed automatically. UTF-8 preserves non-ASCII code. */
export function encodeSnippet(snippet: Snippet): string {
  const bytes = new TextEncoder().encode(JSON.stringify(snippet));
  if (bytes.length > MAX_BYTES) throw new Error('Snippet exceeds the 180 kB editor limit.');
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeSnippet(encoded: string): Snippet {
  if (encoded.length > MAX_BYTES * 1.4) throw new Error('Snippet link is too large.');
  const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
  const value = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
  if (typeof value?.code !== 'string' || typeof value?.lang !== 'string') throw new Error('Invalid snippet link.');
  return {
    code: value.code,
    lang: value.lang,
    title: typeof value.title === 'string' ? value.title : undefined,
    origin: typeof value.origin === 'string' ? value.origin : undefined,
  };
}
export function snippetHref(code: string, lang = 'ts', title?: string): string {
  return href('/repl/snippet', `code-${encodeSnippet({ code, lang, title })}`);
}
