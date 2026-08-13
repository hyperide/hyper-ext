/**
 * @file Gallery corpus — the source-of-truth scripts for the visual-regression harness.
 *
 * Accessed via: test/gallery.test.ts (VECLI-8 / HYP-526).
 * Assumptions:
 *  - Every entry uses ONLY pure svgPath word-art helpers + generators (ribbon, badge,
 *    burst, heart, spiralPath, star, polygon). None go through a boolean/clip node, so the
 *    rendered geometry is independent of the PathOps backend (MockPathOps vs CanvasKit) —
 *    the committed goldens stay stable on any branch.
 *  - `renderEntry` builds on a FRESH context per call, so entries never share graph state.
 */

import type { ChainableNode } from '../../src/chainable';
import { createContext } from '../../src/context';
import { createGlobals, type GlobalBindings } from '../../src/globals';

export interface GalleryEntry {
  /** Stable file-safe name; the golden lives at `gallery/<name>.svg`. */
  name: string;
  /** Build the shape from the public DSL; returns the terminal node to render. */
  build: (g: GlobalBindings) => ChainableNode;
}

export const GALLERY: GalleryEntry[] = [
  { name: 'ribbon', build: (g) => g.ribbon(120, 35, 10).fill('#e74c3c').stroke('#c0392b', 1) },
  { name: 'badge', build: (g) => g.badge(80, 100, 8).fill('#3498db').stroke('#2471a3', 2) },
  { name: 'burst', build: (g) => g.burst(12, 60, 30).fill('#f1c40f') },
  { name: 'heart', build: (g) => g.heart(50).fill('#e91e63') },
  { name: 'spiral', build: (g) => g.spiralPath(3, 60, 80).stroke('#16a085', 2) },
  { name: 'star', build: (g) => g.star(5, 50, 20).fill('#9b59b6') },
  { name: 'polygon-hex', build: (g) => g.polygon(6, 50).fill('#2ecc71') },
  // Subsumes the pre-existing static `10-speech-bubble.svg` / `11-ribbon.svg` orphans
  // (no code referenced them) — the corpus now owns both shapes as code-driven goldens.
  { name: 'speech-bubble', build: (g) => g.bubble(140, 35).fill('#e74c3c').stroke('#c0392b', 1) },
];

/** Build an entry on a fresh context and return its rendered SVG string. */
export function renderEntry(entry: GalleryEntry): string {
  const ctx = createContext();
  const g = createGlobals(ctx);
  return entry.build(g).svg();
}
