/**
 * @file NodeRef stability algorithm — maps old nodeRefs to new nodeRefs across re-parses
 *
 * Accessed via: Internal module — consumed by NodeMapService during re-parse
 * Assumptions: NodeMapEntry arrays are built by buildNodeMap() with consistent traversal order
 *
 * Uses 3-tier matching cascade:
 *   Tier 1 — Structural key: parentTag/tag#siblingIndexByTag~fingerprint (exact match)
 *   Tier 2 — Ancestry path: last-3-ancestor-tags/tag~fingerprint (fuzzy subsequence)
 *   Tier 3 — Position proximity: nearest unmatched same-tag node within ±5 lines (unique only)
 */

import type { NodeMapEntry, NodeRef } from '../../shared/element-tracing/types';

const PROXIMITY_LINE_THRESHOLD = 5;
const ANCESTRY_DEPTH = 3;
const MIN_ANCESTRY_MATCH = 2;

/**
 * Computes the index of `entry` among siblings with the same tag.
 * Counts how many previous siblings share the same tag.
 */
function siblingIndexByTag(entry: NodeMapEntry, refToEntry: Map<NodeRef, NodeMapEntry>): number {
  if (entry.parentRef === null) return 0;
  const parent = refToEntry.get(entry.parentRef);
  if (!parent) return 0;

  let index = 0;
  for (const sibRef of parent.children) {
    if (sibRef === entry.nodeRef) break;
    const sib = refToEntry.get(sibRef);
    if (sib && sib.tag === entry.tag) index++;
  }
  return index;
}

/**
 * Collects up to `depth` ancestor tags (immediate parent first).
 */
function collectAncestorTags(entry: NodeMapEntry, refToEntry: Map<NodeRef, NodeMapEntry>, depth: number): string[] {
  const tags: string[] = [];
  let current = entry;
  while (current.parentRef !== null && tags.length < depth) {
    const parent = refToEntry.get(current.parentRef);
    if (!parent) break;
    tags.push(parent.tag);
    current = parent;
  }
  return tags;
}

/**
 * Generates Tier 1 structural key: `"parentTag/tag#siblingIndex~fingerprint"`.
 * Exported for tests.
 */
export function buildCompositeKey(entry: NodeMapEntry, refToEntry: Map<NodeRef, NodeMapEntry>): string {
  const parentTag = entry.parentRef !== null ? (refToEntry.get(entry.parentRef)?.tag ?? 'UNKNOWN') : 'ROOT';
  const sibIndex = siblingIndexByTag(entry, refToEntry);
  return `${parentTag}/${entry.tag}#${sibIndex}~${entry.fingerprint}`;
}

/**
 * Checks if `subTags` is a subsequence of `superTags`.
 * Used for fuzzy ancestry matching — wrapping adds ancestors but the original
 * sequence should still be present as a subsequence.
 */
function isSubsequence(subTags: string[], superTags: string[]): boolean {
  let si = 0;
  for (let i = 0; i < superTags.length && si < subTags.length; i++) {
    if (subTags[si] === superTags[i]) si++;
  }
  return si === subTags.length;
}

/**
 * Counts how many segments of `a` match segments of `b` using subsequence matching.
 */
function countAncestryMatches(aAncestors: string[], bAncestors: string[]): number {
  // Try both directions — shorter is subsequence of longer
  const [shorter, longer] =
    aAncestors.length <= bAncestors.length ? [aAncestors, bAncestors] : [bAncestors, aAncestors];

  let matches = 0;
  let li = 0;
  for (let si = 0; si < shorter.length && li < longer.length; si++) {
    for (; li < longer.length; li++) {
      if (shorter[si] === longer[li]) {
        matches++;
        li++;
        break;
      }
    }
  }
  return matches;
}

/**
 * Tier 2: Fuzzy ancestry matching.
 * For each unmatched old entry, find a new entry with:
 * - same tag + fingerprint
 * - at least MIN_ANCESTRY_MATCH ancestor segments matching (subsequence)
 * Returns unique matches only — ambiguous entries are skipped.
 */
function matchByAncestry(
  unmatchedOld: NodeMapEntry[],
  unmatchedNew: NodeMapEntry[],
  oldRefToEntry: Map<NodeRef, NodeMapEntry>,
  newRefToEntry: Map<NodeRef, NodeMapEntry>,
): Record<NodeRef, NodeRef> {
  const mapping: Record<NodeRef, NodeRef> = {};
  const usedNewRefs = new Set<NodeRef>();

  for (const oldEntry of unmatchedOld) {
    const oldAncestors = collectAncestorTags(oldEntry, oldRefToEntry, ANCESTRY_DEPTH);
    const candidates: NodeMapEntry[] = [];

    for (const newEntry of unmatchedNew) {
      if (usedNewRefs.has(newEntry.nodeRef)) continue;
      if (newEntry.tag !== oldEntry.tag) continue;
      if (newEntry.fingerprint !== oldEntry.fingerprint) continue;

      const newAncestors = collectAncestorTags(newEntry, newRefToEntry, ANCESTRY_DEPTH);
      const matchCount = countAncestryMatches(oldAncestors, newAncestors);

      if (
        matchCount >= MIN_ANCESTRY_MATCH ||
        isSubsequence(oldAncestors, newAncestors) ||
        isSubsequence(newAncestors, oldAncestors)
      ) {
        candidates.push(newEntry);
      }
    }

    if (candidates.length === 1) {
      mapping[oldEntry.nodeRef] = candidates[0].nodeRef;
      usedNewRefs.add(candidates[0].nodeRef);
    }
  }

  return mapping;
}

/**
 * Tier 3: Position proximity matching.
 * Nearest unmatched node of same tag within ±PROXIMITY_LINE_THRESHOLD lines.
 * Only matches if exactly 1 candidate exists (no ambiguity).
 */
function matchByProximity(unmatchedOld: NodeMapEntry[], unmatchedNew: NodeMapEntry[]): Record<NodeRef, NodeRef> {
  const mapping: Record<NodeRef, NodeRef> = {};
  const usedNewRefs = new Set<NodeRef>();

  for (const oldEntry of unmatchedOld) {
    const candidates: NodeMapEntry[] = [];

    for (const newEntry of unmatchedNew) {
      if (usedNewRefs.has(newEntry.nodeRef)) continue;
      if (newEntry.tag !== oldEntry.tag) continue;
      if (newEntry.loc.fileName !== oldEntry.loc.fileName) continue;

      const lineDiff = Math.abs(newEntry.loc.line - oldEntry.loc.line);
      if (lineDiff <= PROXIMITY_LINE_THRESHOLD) {
        candidates.push(newEntry);
      }
    }

    if (candidates.length === 1) {
      mapping[oldEntry.nodeRef] = candidates[0].nodeRef;
      usedNewRefs.add(candidates[0].nodeRef);
    }
  }

  return mapping;
}

/**
 * Builds key→nodeRef map, marking duplicates as null (ambiguous).
 */
function buildUniqueKeyMap(
  entries: NodeMapEntry[],
  refToEntry: Map<NodeRef, NodeMapEntry>,
  keyFn: (e: NodeMapEntry, m: Map<NodeRef, NodeMapEntry>) => string,
): Map<string, NodeRef | null> {
  const keyToRef = new Map<string, NodeRef | null>();
  for (const e of entries) {
    const key = keyFn(e, refToEntry);
    keyToRef.set(key, keyToRef.has(key) ? null : e.nodeRef);
  }
  return keyToRef;
}

/**
 * Builds set of nodeRefs that are "ambiguous siblings" — entries sharing the same
 * parentRef + tag + fingerprint with at least one other sibling.
 * These nodes are structurally indistinguishable, so index-based matching could
 * silently produce wrong results after a swap.
 */
function findAmbiguousSiblings(entries: NodeMapEntry[]): Set<NodeRef> {
  // Group by parentRef+tag+fingerprint
  const groups = new Map<string, NodeRef[]>();
  for (const e of entries) {
    const groupKey = `${e.parentRef ?? 'ROOT'}|${e.tag}|${e.fingerprint}`;
    const group = groups.get(groupKey);
    if (group) {
      group.push(e.nodeRef);
    } else {
      groups.set(groupKey, [e.nodeRef]);
    }
  }

  const ambiguous = new Set<NodeRef>();
  for (const refs of groups.values()) {
    if (refs.length > 1) {
      for (const ref of refs) {
        ambiguous.add(ref);
      }
    }
  }
  return ambiguous;
}

/**
 * Maps old nodeRefs to new nodeRefs using 3-tier matching cascade.
 *
 * Tier 1: Structural key (parentTag/tag#siblingIndex~fingerprint) — exact match
 * Tier 2: Ancestry path (last 3 ancestors/tag~fingerprint) — fuzzy subsequence
 * Tier 3: Position proximity (same tag within ±5 lines) — unique candidate only
 *
 * Returns a partial mapping: only entries with unambiguous matches are included.
 */
export function mapNodeRefs(oldEntries: NodeMapEntry[], newEntries: NodeMapEntry[]): Record<NodeRef, NodeRef> {
  const oldRefToEntry = new Map(oldEntries.map((e) => [e.nodeRef, e]));
  const newRefToEntry = new Map(newEntries.map((e) => [e.nodeRef, e]));

  const mapping: Record<NodeRef, NodeRef> = {};
  const matchedOldRefs = new Set<NodeRef>();
  const matchedNewRefs = new Set<NodeRef>();

  // Tier 1: Structural key matching
  // Skip entries that are ambiguous siblings (same parent + tag + fingerprint) —
  // sibling index alone can't distinguish them after reordering.
  const oldAmbiguous = findAmbiguousSiblings(oldEntries);
  const newAmbiguous = findAmbiguousSiblings(newEntries);

  const oldKeyToRef = buildUniqueKeyMap(oldEntries, oldRefToEntry, buildCompositeKey);
  const newKeyToRef = buildUniqueKeyMap(newEntries, newRefToEntry, buildCompositeKey);

  for (const [key, oldRef] of oldKeyToRef) {
    if (oldRef === null) continue;
    if (oldAmbiguous.has(oldRef)) continue;
    const newRef = newKeyToRef.get(key);
    if (newRef === null || newRef === undefined) continue;
    if (newAmbiguous.has(newRef)) continue;
    mapping[oldRef] = newRef;
    matchedOldRefs.add(oldRef);
    matchedNewRefs.add(newRef);
  }

  // Tier 2: Ancestry path fuzzy matching (unmatched only)
  const unmatchedOld2 = oldEntries.filter((e) => !matchedOldRefs.has(e.nodeRef));
  const unmatchedNew2 = newEntries.filter((e) => !matchedNewRefs.has(e.nodeRef));

  const tier2Mapping = matchByAncestry(unmatchedOld2, unmatchedNew2, oldRefToEntry, newRefToEntry);
  for (const [oldRef, newRef] of Object.entries(tier2Mapping)) {
    mapping[oldRef] = newRef;
    matchedOldRefs.add(oldRef);
    matchedNewRefs.add(newRef);
  }

  // Tier 3: Position proximity (unmatched only)
  const unmatchedOld3 = oldEntries.filter((e) => !matchedOldRefs.has(e.nodeRef));
  const unmatchedNew3 = newEntries.filter((e) => !matchedNewRefs.has(e.nodeRef));

  const tier3Mapping = matchByProximity(unmatchedOld3, unmatchedNew3);
  for (const [oldRef, newRef] of Object.entries(tier3Mapping)) {
    mapping[oldRef] = newRef;
  }

  return mapping;
}
