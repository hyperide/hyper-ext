/** R54 — turn term/R-id/§ references in rendered HTML into calm tooltip links. */
import { GLOSSARY } from '../data/glossary';
import requirementsMd from '../content/requirements.md?raw';
import specMd from '../content/spec.md?raw';
import { href } from './router';
import briefMd from '../content/brief.md?raw';
import decisionsMd from '../content/decisions.md?raw';
import { INSIGHTS } from '../data/insights';
import { WHY } from '../data/landscape';
import { REF_ID_SRC, withoutCode } from './ref-pattern';

// Re-exported so consumers keep importing the reference system from one place; the rules
// themselves live in a module with no `?raw` imports so they can be unit tested.
export { REF_ID_SRC } from './ref-pattern';

// Build R-id → text map from REQUIREMENTS.md. Exported for search.ts, which wants the
// same id → summary pairs rather than re-parsing the markdown a second way.
export const REQ: Record<string, string> = {};
for (const m of requirementsMd.matchAll(new RegExp(`\\*\\*(${REF_ID_SRC})[^*]*\\*\\*\\s*(.+)`, 'g'))) {
  const text = m[2].replace(/\*\*/g, '').replace(/`/g, '');
  REQ[m[1]] = text.slice(0, 280) + (text.length > 280 ? '…' : '');
}

// Build § → "chapter — section title" map from the spec's headings. Exported for search.ts.
export const SEC: Record<string, string> = {};
{
  let chapter = '';
  for (const line of specMd.split('\n')) {
    let m = /^##\s+(\d+)\.\s+(.+)/.exec(line);
    if (m) {
      chapter = m[2].replace(/[`*]/g, '');
      SEC[m[1]] = chapter;
      continue;
    }
    m = /^###\s+(\d+\.\d+)\s+(.+)/.exec(line);
    if (m) {
      SEC[m[1]] = `${chapter} — ${m[2].replace(/[`*]/g, '')}`;
      continue;
    }
    // Three levels deep as well: a reference like §4.13.3 stayed plain text
    // while its neighbours were links, and the anchor (s4-13-3) already existed.
    m = /^####\s+(\d+\.\d+\.\d+)\s+(.+)/.exec(line);
    if (m) SEC[m[1]] = `${chapter} — ${m[2].replace(/[`*]/g, '')}`;
  }
}
const secTip = (n: string) =>
  SEC[n] || SEC[n.split('.').slice(0, 2).join('.')] || SEC[n.split('.')[0]] || 'Open the master spec at this section';

/** The class a DEFINED marker wears so linkify leaves it as plain text. Written by Doc.tsx
 *  and handed straight back to `linkify` as its skip selector — one name, two call sites. */
export const REF_DEF = 'ref-def';

/** The selector matching a rendered reference link, and the class a backlink chip wears. The tour
 *  finds its targets with the first and decides whether it owns the arrow keys with the second, so
 *  both belong next to the code that mints them rather than as strings in another file that would
 *  silently match nothing if either class were ever renamed. */
export const REF_LINK = 'a.gr';
export const BACKLINK_CHIP = 'backlink-chip';

const TERMS = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termRe = new RegExp(`(^|[^\\w-])(${TERMS.map(escRe).join('|')})(?![\\w-])`, 'g');
// F-ids are bounded the same way R-ids are: `F\d` would match only the `F1` of an `F10`.
// An unknown id is dropped by the REQ lookup below, so widening this cannot invent links.
const refRe = new RegExp(`\\b(${REF_ID_SRC})\\b`, 'g');
const secRe = /§(\d+(?:\.\d+)*)/g;
/** The section numbers the brief actually has headings for, read from its own `## N.` lines. */
const BRIEF_SECTIONS = new Set([...briefMd.matchAll(/^##\s+(\d+)\./gm)].map((m) => m[1]));
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function replaceText(
  t: string,
  seenTerms: Set<string>,
  termsOnce = true,
  skipRefs = false,
  doc?: string,
): string | null {
  type M = { start: number; end: number; html: string };
  const ms: M[] = [];
  if (!skipRefs) {
    for (const m of t.matchAll(refRe)) {
      if (!REQ[m[1]]) continue;
      ms.push({
        start: m.index!,
        end: m.index! + m[0].length,
        html: `<a class="g gr" href="${href('/requirements', m[1])}" data-tip="${escAttr(REQ[m[1]])}">${m[1]}</a>`,
      });
    }
    for (const m of t.matchAll(secRe)) {
      // On the research brief a bare §N is the brief's OWN section (its headings are
      // numbered `## N.` and Doc.tsx gives them `bN` anchors); it is not spec §N, and
      // sending a reader to the spec was the reported bug. Top-level numbers only —
      // the brief has no §N.M sections, so a dotted ref there still means the spec.
      if (doc === 'Research brief' && !m[1].includes('.')) {
        // The brief numbers its headings 0,1,2,5,6,7,8 — there is no §3 or §4 —
        // and it still says "§4" once. A link to a heading that does not exist is
        // worse than plain text, which is the rule the spec side already applies.
        if (!BRIEF_SECTIONS.has(m[1])) continue;
        ms.push({
          start: m.index!,
          end: m.index! + m[0].length,
          html: `<a class="g gs" href="${href('/brief', `b${m[1]}`)}" data-tip="${escAttr(`This document, section ${m[1]}`)}">§${m[1]}</a>`,
        });
        continue;
      }
      // Only link a section that exists. Four §refs in the corpus point at sections that
      // were never written, and one (§2.5) means a section of the adopter doc, not this
      // spec — linkify cannot tell which document a bare § belongs to. A dead link is
      // worse than plain text, so an unresolvable reference stays plain text.
      if (!SEC[m[1]]) continue;
      ms.push({
        start: m.index!,
        end: m.index! + m[0].length,
        html: `<a class="g gs" href="${href('/spec', `s${m[1].replace(/\./g, '-')}`)}" data-tip="${escAttr(`Spec: ${secTip(m[1])}`)}">§${m[1]}</a>`,
      });
    }
    // Decisions are referenced in prose as "decision #23"; the anchors exist (Doc.tsx
    // emits d1…dN) and nothing was linking to them.
    for (const m of t.matchAll(/\bdecisions? #(\d{1,2})\b/gi)) {
      ms.push({
        start: m.index!,
        end: m.index! + m[0].length,
        html: `<a class="g gr" href="${href('/decisions', `d${m[1]}`)}" data-tip="${escAttr(`Decision #${m[1]} in the decision log`)}">${m[0]}</a>`,
      });
    }
  }
  for (const m of t.matchAll(termRe)) {
    const term = m[2];
    if (termsOnce && seenTerms.has(term)) continue;
    const start = m.index! + m[1].length;
    if (ms.some((x) => start < x.end && start + term.length > x.start)) continue;
    seenTerms.add(term);
    const g = GLOSSARY[term];
    const anchor = `g-${term.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    ms.push({
      start,
      end: start + term.length,
      // A term always lands on its definition: the g-* ids exist only on
      // /concepts, so a `link` elsewhere (the spec, a dive) dropped the anchor
      // and put a phone reader at the top of a 250k-character page with the
      // definition nowhere in sight — the desktop hover masked it. The deeper
      // pointer, when there is one, is shown inside the definition instead.
      html: `<a class="g gt" href="${href('/concepts', anchor)}" data-tip="${escAttr(g.def + (g.compare ? ' · ' + g.compare : ''))}">${term}</a>`,
    });
  }
  if (!ms.length) return null;
  ms.sort((a, b) => a.start - b.start);
  // drop overlaps (keep earliest)
  const kept: M[] = [];
  for (const m of ms) if (!kept.length || m.start >= kept[kept.length - 1].end) kept.push(m);
  let out = '';
  let i = 0;
  for (const m of kept) {
    out += escAttrText(t.slice(i, m.start)) + m.html;
    i = m.end;
  }
  out += escAttrText(t.slice(i));
  return out;
}
const escAttrText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** For table cells / short fragments: every reference gets a tooltip (no first-mention limit). */
export function linkifyCell(html: string): string {
  return linkifyImpl(html, { termsOnce: false });
}

/**
 * The same, for a string that is PROSE rather than markup.
 *
 * `linkifyCell` parses its input as HTML, which is right for the landscape
 * table's deliberately marked-up cells and wrong for everything else: a
 * sentence containing `<input bind={s.query}/>` rendered a live text field in
 * the middle of a paragraph on the Compare page. Prose gets escaped first, so
 * angle brackets in prose stay angle brackets — and so a string that ever comes
 * from anywhere but this repository cannot inject markup.
 */
export function linkifyText(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return linkifyImpl(escaped, { termsOnce: false });
}

/** Apply to already-rendered HTML; walks text nodes, skips code/links/headings. */
export function linkify(html: string, skipRefsIn?: string, doc?: string): string {
  return linkifyImpl(html, { termsOnce: true, skipRefsIn, doc });
}

function linkifyImpl(html: string, opts: { termsOnce: boolean; skipRefsIn?: string; doc?: string }): string {
  const doc = new DOMParser().parseFromString(`<div id="x">${html}</div>`, 'text/html');
  const root = doc.getElementById('x')!;
  for (const code of root.querySelectorAll('code')) {
    if (code.closest('pre, a')) continue;
    const term = code.textContent ?? '';
    const entry = GLOSSARY[term];
    if (!entry) continue;
    const link = doc.createElement('a');
    link.className = 'g gt';
    link.href = href('/concepts', `g-${term.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
    link.dataset.tip = entry.def;
    code.replaceWith(link);
    link.append(code);
  }

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      // .backlinks is chrome, not prose: its chips are buttons, so without this a glossary
      // term that happened to be named after a document would become an <a> inside a <button>.
      return n.parentElement?.closest('a, code, pre, h1, script, style, .g, .backlinks')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  let seenTerms = new Set<string>();
  let lastSection: Element | null = null;
  for (const node of nodes) {
    // first mention per SECTION (h2/h3 scope), not per page — sections are read independently (R54)
    const sec = node.parentElement?.closest('section') ?? null;
    const heading = node.parentElement?.closest('h2, h3');
    if (heading || (sec && sec !== lastSection)) {
      seenTerms = new Set();
      lastSection = sec;
    }
    const skipRefs = !!opts.skipRefsIn && !!node.parentElement?.closest(opts.skipRefsIn);
    const out = replaceText(node.textContent || '', seenTerms, opts.termsOnce, skipRefs, opts.doc);
    if (out == null) continue;
    const span = doc.createElement('span');
    span.innerHTML = out;
    node.replaceWith(...Array.from(span.childNodes));
  }
  return root.innerHTML;
}

// ---- R54 backlinks: where is each requirement referenced? ----

/** One document the reference tour can walk. `label` is how the control names it in prose;
 *  `defines` marks the document that DEFINES these ids, so its own definition line is not
 *  counted as a reference to itself. */
export type RefDoc = { name: string; label: string; route: string };
type CorpusDoc = RefDoc & { text: string; defines?: boolean };

/** A mention inside a code fence or a code span is never turned into a link — `linkifyImpl`'s
 *  walker rejects `code` and `pre` — so it must not be counted when deciding whether a
 *  document is worth offering. Without this a chip can lead somewhere with nothing to step to.
 *  Applied only to the markdown documents: the landscape corpus is plain strings, where a
 *  backtick is not a code span and stripping one would lose a mention that does render. */

const CORPUS: CorpusDoc[] = [
  // Requirements first: a reader who clicks a chip on /requirements is kept on the page they
  // are already reading before being sent to another document.
  {
    name: 'requirements',
    label: 'these requirements',
    route: '/requirements',
    text: withoutCode(requirementsMd),
    defines: true,
  },
  { name: 'spec', label: 'the master spec', route: '/spec', text: withoutCode(specMd) },
  { name: 'brief', label: 'the research brief', route: '/brief', text: withoutCode(briefMd) },
  { name: 'decisions', label: 'the decision log', route: '/decisions', text: withoutCode(decisionsMd) },
  {
    name: 'landscape',
    label: 'the landscape',
    route: '/landscape',
    text: `${Object.values(WHY).join(' ')} ${Object.values(INSIGHTS).flat().join(' ')}`,
  },
];

const DOCS: Record<string, RefDoc[]> = {};
/** Which documents reference `id` at all. Deliberately a yes/no per document and not a count:
 *  the number here is counted in the source, while what a reader can actually step through is
 *  what survives rendering, and the tour reports the count it measures there instead — the only
 *  place that number is true. The two must still AGREE on yes/no, or a chip leads to a document
 *  with nothing to step to, so code is stripped before counting (see `withoutCode`).
 *  `reference-tour.mts` asserts the agreement across every document and every id. */
export function referenceDocs(id: string): RefDoc[] {
  if (!DOCS[id]) {
    // escRe: nothing but a captured R-id reaches this today, but the id also arrives from a
    // chip's data attribute at runtime, and markdown passes raw HTML through unfiltered.
    const re = new RegExp(`\\b${escRe(id)}\\b`, 'g');
    DOCS[id] = CORPUS.filter((d) => (d.text.match(re) || []).length - (d.defines ? 1 : 0) > 0).map(
      ({ name, label, route }) => ({ name, label, route }),
    );
  }
  return DOCS[id];
}

/** Chips appended at a requirement's definition (R54). Each starts a walk through one
 *  document's references to this id. They used to be links to the route, which dropped the
 *  reader at the top of a quarter-megabyte document with no idea which of seven mentions was
 *  meant. They are buttons rather than links because there is no anchor to point at: the use
 *  sites are found in the rendered document, not written into it. */
export function backlinksFor(id: string): string {
  const docs = referenceDocs(id);
  if (!docs.length) return '';
  return `<span class="backlinks">${docs
    .map(
      (d) =>
        `<button type="button" class="${BACKLINK_CHIP}" data-ref-id="${escAttr(id)}" data-doc="${escAttr(d.name)}"` +
        ` data-tip="${escAttr('Walk through every reference to ' + id + ' in ' + d.label + '.')}">${d.name}</button>`,
    )
    .join(' · ')}</span> `;
}
