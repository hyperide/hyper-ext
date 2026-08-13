/**
 * @file Same-source dedupe for multi-select batch writes (D2 §5.4) — single source of truth.
 *
 * Accessed via: the live server batch route (updateComponentStylesBatch) AND the D2 frozen
 *   BatchStyleWritePlan builder (batch-style-write-plan.ts). Both collapse repeated RENDERED
 *   instances of ONE source JSX node to a single mutation; they MUST agree on the dedupe key, so
 *   the key lives here once instead of being re-derived in two places.
 * Assumptions: the source identity of an element is `(filePath, elementRef)`. `elementRef` is the
 *   per-element source node ref (D4 cross-file v1). When a caller has no distinct source ref yet
 *   (the live wire carries `nodeRef`), `nodeRef` IS the source ref and is used as the key.
 * Architecture: docs/specs/2026-06-11-270-d2-source-routing.md §5.4
 */

/** The minimum identity a batch entry needs to be deduped by its source node. */
export interface SameSourceKeyed {
  /** Per-file discriminator. All entries in one batch share a file today, but the key stays file-scoped for D4 cross-file. */
  filePath: string;
  /** Source node ref — the dedupe target. Two rendered instances of one `items.map(...)` node share this. */
  sourceRef: string;
}

/** Dedupe key for one entry: file-scoped source node identity. */
export function sameSourceKey(entry: SameSourceKeyed): string {
  return `${entry.filePath}\0${entry.sourceRef}`;
}

/**
 * Collapse entries that resolve to the SAME (filePath, sourceRef) source node to the FIRST occurrence,
 * preserving input order. Multiple selected rendered instances of one source JSX node (two cells of an
 * `items.map(...)`, two instances of one component) write that node ONCE — never N times.
 */
export function dedupeBySameSource<T extends SameSourceKeyed>(entries: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of entries) {
    const key = sameSourceKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}
