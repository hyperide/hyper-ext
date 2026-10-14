/** Anchor integrity: every in-page anchor a link points at must actually exist on the page it
 *  points at. This exists because the site shipped hundreds of `#R25`-style cross-references with
 *  no matching element id anywhere — breakage nothing else catches, because the markup is valid,
 *  the route renders clean, and the click just silently does nothing. check-routes.mts proves a
 *  route loads; this proves its cross-references land. Run: tsx tools/anchor-integrity.mts */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './browser.mts';
import type { Page } from 'playwright';
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/index.html');

const ROUTES = [
  '/',
  '/init',
  '/concepts',
  '/landscape',
  '/compare',
  '/playground',
  '/repl',
  '/bench',
  '/cli',
  '/devtools',
  '/dive-data',
  '/dive-stores',
  '/requirements',
  '/decisions',
  '/spec',
  '/brief',
  '/lib/zustand',
  '/api',
  '/adapters',
  '/concepts/practical',
  '/query-research',
  '/selectors-vs-datalog',
  '/diagrams',
];

/** A resolved link: some page linked to (route, anchor). */
type Ref = { from: string; route: string; anchor: string; href: string };

const normRoute = (r: string): string => r.replace(/\/+$/, '') || '/';
const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Resolve one raw href attribute to the (route, anchor) it targets, or null if it targets no
 *  in-page anchor. Two shapes matter: the file:// hash fallback puts the route first and the
 *  anchor second (`#/requirements#R25`), while a same-page anchor is written bare (`#R25`).
 *  History-mode hrefs (`/requirements#R25`) are handled too — hand-written JSX can carry them. */
function parseRef(raw: string, from: string): { route: string; anchor: string } | null {
  const h = raw.trim();
  if (!h || h === '#') return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null; // http(s), mailto, anything with a scheme
  let route: string;
  let anchor: string;
  if (h.startsWith('#/') || h.startsWith('/')) {
    const rest = h.startsWith('#') ? h.slice(1) : h;
    const cut = rest.indexOf('#');
    route = cut < 0 ? rest : rest.slice(0, cut);
    anchor = cut < 0 ? '' : rest.slice(cut + 1);
  } else if (h.startsWith('#')) {
    route = from;
    anchor = h.slice(1);
  } else {
    return null; // relative path, not a route link this site produces
  }
  if (route === '/repl/snippet' && anchor.startsWith('code-')) return null; // editor payload, not a DOM anchor
  if (!anchor) return null; // a pure route link, nothing to scroll to
  return { route: normRoute(route), anchor: decode(anchor) };
}

/** Load one route and read back every link href and every element id on it. Ids for headings
 *  rendered from markdown are assigned in a post-mount effect, so sample until the count stops
 *  growing rather than trusting one fixed wait. */
async function collectPage(page: Page, route: string): Promise<{ hrefs: string[]; ids: string[] }> {
  await page.goto(`file://${dist}#${route}`);
  let ids: string[] = [];
  let prev = -1;
  for (let i = 0; i < 10 && ids.length !== prev; i++) {
    prev = ids.length;
    await page.waitForTimeout(i === 0 ? 600 : 300);
    ids = await page.$$eval('[id]', (es: Element[]) => es.map((e) => e.id).filter(Boolean));
  }
  const hrefs = await page.$$eval('a[href]', (as: Element[]) => as.map((a) => a.getAttribute('href') ?? ''));
  return { hrefs, ids };
}

async function crawl(): Promise<{ refs: Ref[]; idsByRoute: Map<string, Set<string>> }> {
  const b = await chromium.launch();
  const refs: Ref[] = [];
  const idsByRoute = new Map<string, Set<string>>();
  for (const route of ROUTES) {
    const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
    p.on('pageerror', (e: Error) => console.error(`  PAGEERROR ${route}: ${e.message}`));
    const { hrefs, ids } = await collectPage(p, route);
    if (new Set(ids).size !== ids.length) throw new Error(`Duplicate element ids on ${route}`);
    idsByRoute.set(route, new Set(ids));
    let onPage = 0;
    for (const href of hrefs) {
      const r = parseRef(href, route);
      if (!r) continue;
      refs.push({ from: route, route: r.route, anchor: r.anchor, href });
      onPage++;
    }
    console.log(
      `scanned ${route.padEnd(14)} ${String(ids.length).padStart(4)} ids  ${String(hrefs.length).padStart(4)} links  ${String(onPage).padStart(4)} anchor refs`,
    );
    await p.close();
  }
  await b.close();
  return { refs, idsByRoute };
}

function bucket<T>(m: Map<string, T[]>, k: string, v: T): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

/** Split every reference into: broken (target id absent), unchecked (route not crawled),
 *  and the set of anchors actually referenced per route (for the reverse report). */
function classify(refs: Ref[], idsByRoute: Map<string, Set<string>>) {
  const missing = new Map<string, Map<string, Ref[]>>();
  const unchecked = new Map<string, Ref[]>();
  const linked = new Map<string, Set<string>>();
  for (const r of refs) {
    const ids = idsByRoute.get(r.route);
    if (!ids) {
      bucket(unchecked, r.route, r);
      continue;
    }
    if (!linked.has(r.route)) linked.set(r.route, new Set());
    linked.get(r.route)!.add(r.anchor);
    if (ids.has(r.anchor)) continue;
    if (!missing.has(r.route)) missing.set(r.route, new Map());
    const byAnchor = missing.get(r.route)!;
    if (!byAnchor.has(r.anchor)) byAnchor.set(r.anchor, []);
    byAnchor.get(r.anchor)!.push(r);
  }
  return { missing, unchecked, linked };
}

const ROUTE_CAP = 10;
const ANCHOR_CAP = 10;

function reportMissing(missing: Map<string, Map<string, Ref[]>>): number {
  let total = 0;
  for (const byAnchor of missing.values()) for (const rs of byAnchor.values()) total += rs.length;
  if (!total) {
    console.log('\nno broken anchor references');
    return 0;
  }
  const worst = [...missing.entries()]
    .map(([route, byAnchor]) => ({
      route,
      byAnchor,
      links: [...byAnchor.values()].reduce((n, rs) => n + rs.length, 0),
    }))
    .sort((a, b) => b.links - a.links);
  console.log(
    `\nBROKEN — ${total} link(s) point at an id that does not exist, across ${missing.size} target route(s):`,
  );
  for (const { route, byAnchor, links } of worst.slice(0, ROUTE_CAP)) {
    console.log(`\n  ${route}  —  ${links} link(s) to ${byAnchor.size} missing id(s)`);
    const anchors = [...byAnchor.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [anchor, rs] of anchors.slice(0, ANCHOR_CAP)) {
      console.log(
        `    #${anchor.padEnd(24)} ${String(rs.length).padStart(4)} link(s)   e.g. from ${rs[0].from} as ${JSON.stringify(rs[0].href)}`,
      );
    }
    if (anchors.length > ANCHOR_CAP)
      console.log(`    … and ${anchors.length - ANCHOR_CAP} more missing id(s) on this route`);
  }
  if (worst.length > ROUTE_CAP) console.log(`\n  … and ${worst.length - ROUTE_CAP} more target route(s)`);
  return total;
}

/** References into routes this run did not load. Not a failure — it means the route list is
 *  narrower than the link graph, and whoever reads this should widen ROUTES. */
function reportUnchecked(unchecked: Map<string, Ref[]>): void {
  if (!unchecked.size) return;
  const total = [...unchecked.values()].reduce((n, rs) => n + rs.length, 0);
  console.log(
    `\nNOTE — ${total} reference(s) into ${unchecked.size} route(s) that were not crawled (not verified either way):`,
  );
  for (const [route, rs] of [...unchecked.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, ROUTE_CAP)) {
    console.log(
      `    ${route.padEnd(24)} ${String(rs.length).padStart(4)} link(s)   e.g. #${rs[0].anchor} from ${rs[0].from}`,
    );
  }
}

/** Ids nothing links to. Not a bug — it says how much of the anchor surface is reachable. */
function reportOrphans(idsByRoute: Map<string, Set<string>>, linked: Map<string, Set<string>>): void {
  console.log('\nNOTE — anchor surface reachability (ids that exist vs. ids anything links to):');
  for (const route of ROUTES) {
    const ids = idsByRoute.get(route) ?? new Set<string>();
    const hit = linked.get(route) ?? new Set<string>();
    const orphans = [...ids].filter((id) => !hit.has(id));
    const reached = ids.size - orphans.length;
    const pct = ids.size ? Math.round((reached / ids.size) * 100) : 100;
    const sample = orphans
      .slice(0, 5)
      .map((id) => `#${id}`)
      .join(' ');
    console.log(
      `    ${route.padEnd(14)} ${String(reached).padStart(4)}/${String(ids.size).padEnd(4)} linked (${String(pct).padStart(3)}%)  unlinked e.g. ${sample || '—'}`,
    );
  }
}

const { refs, idsByRoute } = await crawl();
const { missing, unchecked, linked } = classify(refs, idsByRoute);
const broken = reportMissing(missing);
reportUnchecked(unchecked);
reportOrphans(idsByRoute, linked);
console.log(
  broken
    ? `\nFAIL — ${broken} of ${refs.length} anchor reference(s) across ${ROUTES.length} route(s) point at an id that does not exist`
    : `\nok — all ${refs.length} anchor reference(s) across ${ROUTES.length} route(s) resolve to a real id`,
);
process.exit(broken ? 1 : 0);
