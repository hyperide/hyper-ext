/** Site search (asked for directly, not tracked by an R-id): one Orama index over
 *  everything already bundled into the page — nav routes, the glossary, the compare
 *  matrix, the landscape, REPL examples, the "no useEffect" catalogue, and the four
 *  numbered documents (requirements/decisions/spec/brief) plus the two deep dives.
 *  Client-side and in-memory on purpose: the site is a single committed HTML file
 *  opened from disk half the time (see CLAUDE.md), so there is no server to hit —
 *  Orama is exactly the "in-memory, typo-tolerant, no backend" shape that fits
 *  (chosen over Algolia/Typesense/Elastic, which all want a server).
 *
 *  The index is built lazily on first open, not at module load, so a reader who
 *  never opens search never pays for it.
 */
import { create, insertMultiple, search as oramaSearch } from '@orama/orama';
import { PRIMARY, DOCS } from './routes';
import { GLOSSARY } from '../data/glossary';
import { CATS } from '../data/compare';
import { ROWS } from '../data/landscape';
import { EXAMPLES } from '../data/examples';
import { EFFECTS } from '../data/effects';
import { LANDSCAPE_NAME } from '../pages/Library';
import { REQ, SEC } from './linkify';
import decisionsMd from '../content/decisions.md?raw';
import briefMd from '../content/brief.md?raw';
import diveDataMd from '../content/dive-data.md?raw';
import diveStoresMd from '../content/dive-stores.md?raw';

export type SearchDoc = {
  id: string;
  title: string;
  body: string;
  kind: string;
  route: string;
  anchor: string;
};

function stripMd(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_>`~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The exact id algorithm `useHeadings` (src/lib/Toc.tsx) derives at render time from an
 *  h2/h3's text, reproduced here over the raw markdown so a doc result's anchor lands on
 *  the real rendered heading instead of the top of the page. Both this and the injected
 *  R25/§4.8/d12 spans (Doc.tsx `injectAnchors`) are real, independent anchors on the same
 *  page — requirements/decisions/spec below use the latter (REQ/SEC/decision-row ids,
 *  which are what the rest of the site already links with); this one is for the pages
 *  that only have the former: the brief and the two deep dives. */
function slugifyHeading(text: string, used: Set<string>): string {
  const base = `h-${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)}`;
  let id = base;
  for (let k = 2; used.has(id); k++) id = `${base}-${k}`;
  used.add(id);
  return id;
}

/** Splits one markdown document into one search doc per h2/h3 section, skipping code
 *  fences so a `## ` inside a snippet is never mistaken for a heading. */
function docsFromMarkdown(
  md: string,
  route: string,
  pageTitle: string,
): { title: string; body: string; anchor: string }[] {
  const used = new Set<string>();
  const out: { title: string; body: string; anchor: string }[] = [];
  let title = '';
  let anchor = '';
  let buf: string[] = [];
  let inFence = false;
  const flush = () => {
    const body = stripMd(buf.join('\n')).slice(0, 500);
    if (body) out.push({ title: title || pageTitle, body, anchor });
    buf = [];
  };
  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const m = !inFence && /^(#{2,3})\s+(.*)$/.exec(line);
    if (m) {
      flush();
      title = m[2].replace(/[`*_]/g, '').trim();
      anchor = slugifyHeading(title, used);
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

function buildDocs(): SearchDoc[] {
  const docs: SearchDoc[] = [];
  let n = 0;
  const add = (title: string, body: string, kind: string, route: string, anchor = '') => {
    docs.push({ id: `d${n++}`, title, body, kind, route, anchor });
  };

  for (const [route, label] of [...PRIMARY, ...DOCS]) add(label, label, 'page', route);

  for (const [term, t] of Object.entries(GLOSSARY)) {
    add(term, t.def, 'concept', '/concepts', `g-${term.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  }

  for (const cat of CATS) {
    for (const a of cat.axes) {
      add(a.axis, `${cat.name}. ${a.why} ${a.ours}`, 'compare', '/compare', `cmp-${a.id}`);
    }
  }

  const reverseLandscape = Object.fromEntries(Object.entries(LANDSCAPE_NAME).map(([id, name]) => [name, id]));
  for (const r of ROWS) {
    const [, name, , , , , what, take, , note] = r;
    const libId = reverseLandscape[name];
    add(name, `${what} ${take} ${note}`, 'landscape', libId ? `/lib/${libId}` : '/landscape');
  }

  for (const e of EXAMPLES) {
    add(e.title, `${e.short ?? ''} ${e.about ?? ''}`, 'example', `/repl/${e.id}`);
  }

  for (const e of EFFECTS) {
    add(e.reason, `${e.target} ${e.note}`, 'effect', '/effects', `eff-${e.n}`);
  }

  // Requirements/decisions/spec reuse the site's own injected anchors (R25, d12, §4.8 →
  // s4-8) rather than the generic heading slug, because those are the ids every other
  // cross-reference on the site already points at. REQ/SEC are the same id → text maps
  // linkify.ts already built to power the R54 tooltip system — reused rather than
  // re-parsed, so the two can't quietly disagree about what a requirement says.
  for (const [id, body] of Object.entries(REQ)) add(id, body, 'requirement', '/requirements', id);

  for (const m of decisionsMd.matchAll(/^\|\s*(\d+)\s*\|[^|]*\|([^|]+)\|([^|]+)\|/gm)) {
    add(`Decision #${m[1]}`, stripMd(`${m[2]} — ${m[3]}`), 'decision', '/decisions', `d${m[1]}`);
  }

  for (const [num, title] of Object.entries(SEC)) {
    add(`§${num} ${title.split(' — ').pop()!}`, title, 'spec', '/spec', `s${num.replace(/\./g, '-')}`);
  }

  for (const s of docsFromMarkdown(briefMd, '/brief', 'Research brief'))
    add(s.title, s.body, 'brief', '/brief', s.anchor);
  for (const s of docsFromMarkdown(diveDataMd, '/dive-data', 'Dive: data'))
    add(s.title, s.body, 'dive', '/dive-data', s.anchor);
  for (const s of docsFromMarkdown(diveStoresMd, '/dive-stores', 'Dive: stores'))
    add(s.title, s.body, 'dive', '/dive-stores', s.anchor);

  return docs;
}

let db: Awaited<ReturnType<typeof buildDb>> | null = null;
let building: Promise<void> | null = null;

async function buildDb() {
  const d = create({
    schema: { title: 'string', body: 'string', kind: 'string', route: 'string', anchor: 'string' } as const,
  });
  await insertMultiple(d, buildDocs());
  return d;
}

export function ensureIndex(): Promise<void> {
  if (db) return Promise.resolve();
  if (!building) building = buildDb().then((d) => void (db = d));
  return building;
}

export type SearchHit = { title: string; body: string; kind: string; route: string; anchor: string; score: number };

export async function runSearch(query: string): Promise<SearchHit[]> {
  await ensureIndex();
  if (!db || !query.trim()) return [];
  const results = await oramaSearch(db, {
    term: query,
    properties: ['title', 'body'],
    boost: { title: 3 },
    tolerance: query.trim().length > 4 ? 1 : 0,
    limit: 20,
  });
  return results.hits.map((h) => ({ ...(h.document as SearchDoc), score: h.score }));
}
