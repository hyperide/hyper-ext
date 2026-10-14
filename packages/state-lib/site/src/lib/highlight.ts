/** R80 — syntax highlighting for the code samples, in about eighty lines and no dependency.
 *
 *  A real tokeniser (shiki, prism) is 30–200 kB and this site is one self-contained file.
 *  Samples here are TypeScript and JSX, so the grammar that has to be right is small: strings,
 *  template literals, comments, numbers, keywords, JSX tags and attributes, and the two things
 *  that make our own samples readable — a store path like `/items/3/done`, and a call name.
 *
 *  It is a lexer, not a parser: one pass, longest-match-first, and every branch consumes input,
 *  so it cannot loop. Anything it does not recognise is emitted as plain text, which is the
 *  correct failure mode for highlighting — worse looking, never wrong.
 */

const KEYWORD = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'of',
  'in',
  'new',
  'class',
  'extends',
  'import',
  'from',
  'export',
  'default',
  'async',
  'await',
  'try',
  'catch',
  'finally',
  'throw',
  'typeof',
  'instanceof',
  'delete',
  'void',
  'yield',
  'type',
  'interface',
  'enum',
  'as',
  'satisfies',
  'readonly',
  'declare',
  'namespace',
  'true',
  'false',
  'null',
  'undefined',
  'this',
  'super',
  'switch',
  'case',
  'break',
  'continue',
]);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (cls: string, text: string) => `<span class="hl-${cls}">${esc(text)}</span>`;

/** Ordered longest-match-first; the first rule that matches at the cursor wins. */
const RULES: [RegExp, string][] = [
  [/^\/\/[^\n]*/, 'comment'],
  [/^\/\*[\s\S]*?\*\//, 'comment'],
  // Whole-template styling uses disjoint escape/plain branches.
  [/^`(?:\\[\s\S]|[^`\\])*`/, 'string'],
  [/^'(?:\\.|[^'\\])*'/, 'string'],
  [/^"(?:\\.|[^"\\])*"/, 'string'],
  // a store path or JSON pointer, which our samples are full of
  [/^'?\/(?:[A-Za-z0-9_$*-]+\/?)+'?/, 'path'],
  [/^0[xX][0-9a-fA-F_]+|^\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?/, 'num'],
  // a JSX tag name, opening or closing
  [/^<\/?[A-Z][A-Za-z0-9]*|^<\/?[a-z][a-z0-9-]*(?=[\s/>])/, 'tag'],
  [/^[A-Za-z_$][\w$]*(?=\s*\()/, 'fn'],
  [/^[A-Za-z_$][\w$]*/, 'word'],
  [/^\s+/, 'ws'],
  [/^[^\sA-Za-z0-9_$'"`/<]+/, 'punct'],
  [/^./, 'ws'],
];

/** Highlight one block of TypeScript/JSX into HTML. Input is escaped; output is trusted. */
export function highlight(code: string): string {
  let rest = code;
  let out = '';
  while (rest.length) {
    let matched = false;
    for (const [re, cls] of RULES) {
      const m = re.exec(rest);
      if (!m) continue;
      const text = m[0];
      if (cls === 'ws') out += esc(text);
      // Identifiers carry their name so the editor can attach a hover: the
      // reader points at `store` and gets its type, its one-line definition
      // and — while stepping — what it held at that statement (R81). Callees
      // count: `snapshot(` is the name a reader is most likely to point at,
      // and it takes the `fn` rule rather than the `word` one.
      else if (cls === 'word' || cls === 'fn')
        out += KEYWORD.has(text)
          ? span('kw', text)
          : `<span class="hl-${cls} hl-id" data-id="${esc(text)}">${esc(text)}</span>`;
      else out += span(cls, text);
      rest = rest.slice(text.length);
      matched = true;
      break;
    }
    // Unreachable: the final rule matches any single character. Kept so a future
    // rule edit that breaks that invariant fails loudly instead of hanging.
    if (!matched) throw new Error(`highlight: no rule consumed input at ${JSON.stringify(rest.slice(0, 20))}`);
  }
  return out;
}

/** Languages the TypeScript lexer would mangle rather than help: a shell
 *  transcript, a config file, plain prose. Left exactly as written. */
const NOT_CODE = new Set(['bash', 'sh', 'shell', 'console', 'text', 'txt', 'diff', 'mermaid', 'edn']);

const UNESCAPE: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
};

/**
 * Highlight every fenced code block inside already-rendered HTML (R80).
 *
 * The markdown pages — the spec alone has eighty code blocks — go through
 * `marked`, which escapes their contents and hands back plain `<pre><code>`.
 * This walks that output and runs each block through the same lexer the JSX
 * pages use, so "every source on the site is highlighted" means every source
 * and not just the ones written in JSX.
 *
 * Runs on marked's output only. It must never be given `linkify`'s output:
 * re-scanning generated HTML is what corrupted attributes the first time.
 */
export function highlightHtml(html: string): string {
  return html.replace(
    /<pre([^>]*)><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g,
    (whole, preAttrs: string, codeAttrs: string, body: string) => {
      const lang = /class="[^"]*language-([\w-]+)/.exec(codeAttrs)?.[1];
      if (lang && NOT_CODE.has(lang)) return whole;
      const raw = body.replace(/&(amp|lt|gt|quot|#x?39|#x27);/g, (m) => UNESCAPE[m] ?? m);
      return `<pre${preAttrs}><code${codeAttrs}>${highlight(raw)}</code></pre>`;
    },
  );
}
