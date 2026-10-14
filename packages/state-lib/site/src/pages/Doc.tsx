import { useMemo } from 'react';
import { Toc, useHeadings } from '../lib/Toc';
import { marked } from 'marked';
import { highlightHtml } from '../lib/highlight';

/** Wrap every <table> in its own overflow box so only the table scrolls. */
function scrollTables(html: string): string {
  return html.replace(/<table\b[\s\S]*?<\/table>/g, (t) => `<div class="tblwrap">${t}</div>`);
}
import { REF_DEF, REF_ID_SRC, linkify, backlinksFor } from '../lib/linkify';

/** The anchors the whole cross-reference system points at (R54, R69).
 *
 *  `linkify` turns every `R25` into a link to `/requirements#R25` and every `§4.8` into a
 *  link to `/spec#s4-8`. Nothing was creating those targets, so every one of those links
 *  scrolled nowhere — the router's retry logic was faithfully waiting for an element that
 *  never existed. They are injected into the markdown before rendering, which is the one
 *  place that sees the ids in their source form.
 */
/** `- **R25.** …` and `- **F1.** …` — a definition bullet, at the top level of the document.
 *  This one pattern decides BOTH where an anchor is created and, through `definedIds` below,
 *  which marker is a definition, so the two cannot disagree about what a definition is. */
const DEFINITION_BULLET = new RegExp(`^- \\*\\*(${REF_ID_SRC})`, 'gm');

/** The ids `injectAnchors` created an anchor for on this page. */
function definedIds(title: string, md: string): Set<string> {
  if (title !== 'Requirements') return new Set();
  return new Set(Array.from(md.matchAll(DEFINITION_BULLET), (m) => m[1]));
}

function injectAnchors(title: string, md: string): string {
  if (title === 'Requirements') {
    return md.replace(DEFINITION_BULLET, (m, id: string) => `<span id="${id}" class="anchor"></span>\n\n${m}`);
  }
  if (title === 'Master spec') {
    // `## 13. …` → s13 · `### 13.1 …` → s13-1 · `#### 13.1.7 …` → s13-1-7
    return md.replace(
      /^(#{2,4})\s+(\d+(?:\.\d+)*)\.?\s/gm,
      (m, _h: string, num: string) => `<span id="s${num.replace(/\./g, '-')}" class="anchor"></span>\n\n${m}`,
    );
  }
  if (title === 'Research brief') {
    // `## 6. …` → b6. The brief's own cross-references ("details in §6") point at
    // these; without them a bare §6 was linkified as spec §6 and sent the reader
    // to the wrong document.
    return md.replace(
      /^(#{2,3})\s+(\d+)\.\s/gm,
      (m, _h: string, n: string) => `<span id="b${n}" class="anchor"></span>\n\n${m}`,
    );
  }
  if (title === 'Decision log') {
    // `| 12 | 09-03 | …` → d12, so a decision can be linked to directly
    return md.replace(/^\|\s*(\d+)\s*\|/gm, (m, n: string) => `<span id="d${n}" class="anchor"></span>\n${m}`);
  }
  return md;
}

/** A definition is not a reference (R54).
 *
 *  `linkify` turns every `R25` into a link to `/requirements#R25`, which on the line that
 *  DEFINES R25 is a link to itself — the reader is already there. The same holds for a spec
 *  heading, which defines its own section number.
 *
 *  The rule used here: a marker is a definition exactly where this page creates the anchor
 *  for it. `DEFINITION_BULLET` above is that authority for a requirement, and its match set is
 *  passed in as `defined` — so a bullet naming an id that got no anchor is never mistaken for a
 *  definition, which would silently cost it its link and hand it chips pointing at an anchor
 *  that does not exist; and since an id is defined once, only the FIRST such occurrence is the
 *  definition, so a later bullet mentioning an already-defined id stays a use. For the spec it
 *  is the heading that opens with the section number. Those tokens are wrapped in `.ref-def` and
 *  `linkify` is told to leave references inside it alone; everywhere else the marker is a use
 *  and stays a link.
 *
 *  The HTML side deliberately tolerates a LOOSE list (`<li><p><strong>`, which marked emits as
 *  soon as one blank line appears between bullets). A regex demanding `<li><strong>` would go
 *  from matching 85 to matching 0 on a whitespace edit, silently restoring every self-link it
 *  exists to remove. `reference-tour.mts` asserts marks == anchors, so a future divergence
 *  fails loudly rather than reverting the fix in silence.
 *
 *  This runs on the output of `marked`, never on the output of `linkify` — re-scanning
 *  generated HTML is what corrupted `data-tip` attributes before, and the single-pass
 *  tokenizer in linkify.ts exists to prevent exactly that. `skipRefsIn` was already there for
 *  this purpose and had no caller.
 *
 *  On the spec this is a guard rather than a fix: headings write bare numbers (`### 4.8 …`)
 *  and linkify only links a section written as `§4.8`, so no spec heading self-links today.
 *  Wrapping the number means none can start to.
 */
function markDefinitions(title: string, html: string, defined: Set<string>): string {
  if (title === 'Requirements') {
    // The ANCHOR is the authority for which bullet is the definition — not document order.
    //
    // "Mark the first `<li><strong>R25` on the page" looks equivalent and is not. Requirements
    // are numbered ascending, so a forward reference is the natural direction: a nested
    // `- **R25** refines this` under R10 renders BEFORE R25's own bullet. Document order would
    // mark that use as the definition — stripping its link and giving it chips — and then skip
    // the real definition as already marked, so linkify would turn it into a link to itself.
    // Which is the entire bug this change exists to remove, reintroduced by a content edit.
    //
    // `injectAnchors` already emits `<span id="R25" class="anchor">` immediately before the
    // real bullet, so searching forward from that anchor finds the definition and nothing else.
    let out = html;
    for (const id of defined) {
      const anchor = out.indexOf(`id="${id}" class="anchor"`);
      if (anchor < 0) continue;
      // Loose-list tolerance: a blank line between bullets makes marked wrap each one in `<p>`.
      // Ids are `[RF]\d{1,3}` by construction (REF_ID_SRC), so none is a regex metacharacter.
      const found = new RegExp(`(<li>(?:\\s|<p>)*)<strong>${id}`).exec(out.slice(anchor));
      if (!found) continue;
      const at = anchor + found.index;
      const withMark = `${found[1]}${backlinksFor(id)}<strong><span class="${REF_DEF}">${id}</span>`;
      out = out.slice(0, at) + withMark + out.slice(at + found[0].length);
    }
    return out;
  }
  if (title === 'Master spec') {
    return html.replace(
      /<(h[2-4])([^>]*)>(\d+(?:\.\d+)*)(\.?)(?=\s)/g,
      (_m, tag: string, attrs: string, num: string, dot: string) =>
        `<${tag}${attrs}><span class="${REF_DEF}">${num}${dot}</span>`,
    );
  }
  return html;
}

export default function Doc({ title, md, wide }: { title: string; md: string; wide?: boolean }) {
  const html = useMemo(() => {
    // Highlight before linkify, never after: linkify must not re-scan generated HTML.
    // Each table scrolls in its own box. The whole article used to be the
    // scroller, so one 1000px table made every paragraph on the page pan
    // sideways — and the product's own column in the summary table sat off
    // screen at 1440px with nothing to say it was there.
    // The page header already shows the title; the markdown's own leading `# …`
    // rendered a second h1 eighty pixels below it on every document page.
    const body = md.replace(/^# [^\n]*\n+/, '');
    const rendered = scrollTables(highlightHtml(marked.parse(injectAnchors(title, body), { async: false }) as string));
    return linkify(markDefinitions(title, rendered, definedIds(title, md)), `.${REF_DEF}`, title);
  }, [md, title]);
  const headings = useHeadings('.md', [html]);
  return (
    <div className={`wrap withtoc${wide ? ' wide' : ''}`}>
      <header className="page">
        <p className="kicker">state · docs</p>
        <h1>{title}</h1>
      </header>
      <div className="tocwrap">
        <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
        <Toc headings={headings} />
      </div>
      <footer>Rendered from the markdown source in packages/state-lib.</footer>
    </div>
  );
}
