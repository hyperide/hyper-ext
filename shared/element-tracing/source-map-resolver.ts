/**
 * @file Minimal source map resolver — Base64 VLQ decoder + generated→original position lookup.
 *
 * Accessed via: iframe-interaction.ts (browser, approach A) and PanelRouter.ts (Node.js, approach B)
 * Assumptions: source maps are spec-compliant v3; mappings use VLQ delta-encoding (RFC 7159)
 * Architecture: https://hyperide.github.io/reports/fiber-based-element-tracing
 */

import type { SourceLocation } from './types';

/** One entry in an indexed source map's sections array. */
export interface SourceMapSection {
  offset: { line: number; column: number };
  map?: SourceMapV3; // Inline child map; absent when the section uses `url` instead
}

/**
 * Source map v3 JSON (only fields we use).
 *
 * Two variants:
 *   - Flat map: has `mappings` string (Vite, webpack, Babel output).
 *   - Indexed map: has `sections` array instead of `mappings` (Turbopack / Next.js).
 */
export interface SourceMapV3 {
  sources?: string[];
  sourceRoot?: string;
  mappings?: string; // Flat maps only; absent in indexed maps
  sections?: SourceMapSection[]; // Indexed maps only; absent in flat maps
}

// ─── Base64 VLQ decoder ───────────────────────────────────────────────────────

/**
 * Decode one Base64 VLQ integer starting at `pos` in string `s`.
 * Returns [value, nextPos].
 *
 * Source map VLQ encoding:
 *   - Each digit is a Base64 char (6 bits): [continuation|d4|d3|d2|d1|d0]
 *   - Continuation bit (bit 5) = 1 means more digits follow
 *   - Bit 0 of the assembled integer is the sign bit (1 = negative)
 */
function decodeVlqAt(s: string, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  let digit = 0;
  do {
    const c = s.charCodeAt(pos++);
    // A–Z = 0–25, a–z = 26–51, 0–9 = 52–61, + = 62, / = 63
    digit =
      c >= 65 && c <= 90 ? c - 65 : c >= 97 && c <= 122 ? c - 71 : c >= 48 && c <= 57 ? c + 4 : c === 43 ? 62 : 63;
    result |= (digit & 31) << shift;
    shift += 5;
  } while (digit & 32); // continuation bit
  // LSB is sign bit; remaining bits are magnitude
  return [result & 1 ? -(result >> 1) : result >> 1, pos];
}

// ─── Position resolver ────────────────────────────────────────────────────────

/**
 * Resolve a generated (line, column) position in a source map to the original source location.
 *
 * Handles both flat source maps (have `mappings` string) and indexed source maps (have `sections`
 * array — produced by Turbopack / Next.js dev server).
 *
 * @param sm - Parsed source map JSON
 * @param genLine - 1-based generated line (from V8 Error.stack or similar)
 * @param genCol  - 1-based generated column (from V8 Error.stack)
 * @returns Original SourceLocation, or null if no mapping is found
 */
export function resolveInSourceMap(sm: SourceMapV3, genLine: number, genCol: number): SourceLocation | null {
  // Indexed source map (Turbopack / Next.js): dispatch to section resolver
  if (sm.sections) {
    return resolveInIndexedSourceMap(sm.sections, genLine, genCol);
  }

  if (!sm.mappings) return null;
  const groups = sm.mappings.split(';');
  const targetGroup = genLine - 1; // 0-based
  if (targetGroup >= groups.length) return null;

  // Delta state — carried forward across all segments and lines
  let srcIdx = 0;
  let srcLine = 0;
  let srcCol = 0;

  // Best match: last segment whose generated column is ≤ targetCol
  let bestSrcIdx = -1;
  let bestSrcLine = 0;
  let bestSrcCol = 0;

  for (let gi = 0; gi <= targetGroup; gi++) {
    const group = groups[gi];
    if (!group) continue;

    let pos = 0;
    let prevGenCol = 0;

    while (pos < group.length) {
      // Generated column delta (always present)
      const [dGenCol, p1] = decodeVlqAt(group, pos);
      pos = p1;
      prevGenCol += dGenCol;

      // Source fields (optional — absent for segments with no mapping)
      if (pos < group.length && group[pos] !== ',') {
        const [dSrcIdx, p2] = decodeVlqAt(group, pos);
        pos = p2;
        const [dSrcLine, p3] = decodeVlqAt(group, pos);
        pos = p3;
        const [dSrcCol, p4] = decodeVlqAt(group, pos);
        pos = p4;
        srcIdx += dSrcIdx;
        srcLine += dSrcLine;
        srcCol += dSrcCol;

        // Optional names index — skip without using
        if (pos < group.length && group[pos] !== ',') {
          const [, p5] = decodeVlqAt(group, pos);
          pos = p5;
        }

        if (gi === targetGroup && prevGenCol <= genCol - 1) {
          bestSrcIdx = srcIdx;
          bestSrcLine = srcLine;
          bestSrcCol = srcCol;
        }
      }

      // Skip comma separator between segments
      if (pos < group.length && group[pos] === ',') pos++;
    }
  }

  const sources = sm.sources ?? [];
  if (bestSrcIdx < 0 || bestSrcIdx >= sources.length) return null;

  const rawSource = sources[bestSrcIdx] ?? '';
  if (!rawSource) return null;

  const root = (sm.sourceRoot ?? '').replace(/\/$/, '');
  let filePath = root ? `${root}/${rawSource}` : rawSource;

  // Normalise: strip protocol prefix, keeping absolute paths for file:// URIs
  try {
    const u = new URL(filePath);
    if (u.protocol === 'file:') {
      // file:///abs/path → /abs/path (keep leading slash — it's an absolute path)
      filePath = u.pathname;
    } else {
      // http://host/path → path (strip host + leading slash for workspace-relative)
      filePath = u.pathname.replace(/^\//, '');
    }
  } catch {
    // Not an absolute URL — strip scheme prefixes (webpack://) and leading slash
    filePath = filePath.replace(/^[a-z][a-z\d+\-.]*:\/\/[^/]*\//, '').replace(/^\.\.\//g, '');
    // Strip leading slash from bare absolute paths (e.g. /project/src/App.tsx)
    if (filePath.startsWith('/')) filePath = filePath.slice(1);
  }

  return {
    fileName: filePath,
    line: bestSrcLine + 1, // 0-based → 1-based
    column: bestSrcCol, // stays 0-based (SourceLocation.column is 0-based)
  };
}

// ─── Indexed source map resolver ──────────────────────────────────────────────

/**
 * Resolve a position in an indexed source map (sections format).
 *
 * Sections spec (source map v3): each section covers generated output from its offset onward.
 * Offsets are 0-based. For a given (genLine, genCol) — 1-based — we find the last section
 * whose offset precedes or equals the target, then delegate to the flat resolver with
 * coordinates adjusted relative to the section's offset.
 */
function resolveInIndexedSourceMap(
  sections: SourceMapSection[],
  genLine: number,
  genCol: number,
): SourceLocation | null {
  if (sections.length === 0) return null;

  // Convert to 0-based for offset comparison
  const genLine0 = genLine - 1;
  const genCol0 = genCol - 1;

  // Sections are ordered by offset — find the last one that precedes (genLine0, genCol0)
  let bestSection: SourceMapSection | null = null;
  for (const section of sections) {
    const { line: offLine, column: offCol } = section.offset;
    if (offLine > genLine0) break; // sections are sorted; no need to continue
    if (offLine === genLine0 && offCol > genCol0) break;
    bestSection = section;
  }
  if (bestSection === null) return null;

  const { line: offLine, column: offCol } = bestSection.offset;

  // Adjust coordinates to be relative to this section's offset.
  // The inner map's line 1 (1-based) corresponds to the offset line in the outer map.
  // Column adjustment only applies on the first generated line of the section.
  const innerGenLine = genLine - offLine; // offLine is 0-based; genLine is 1-based → inner is 1-based
  const innerGenCol = genLine0 === offLine ? genCol - offCol : genCol;

  // Sections using the `url` form (external reference) cannot be resolved here.
  if (!bestSection.map) return null;

  return resolveInSourceMap(bestSection.map, innerGenLine, innerGenCol);
}
