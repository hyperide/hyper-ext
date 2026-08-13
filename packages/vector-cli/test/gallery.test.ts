/**
 * @file Visual-regression harness for the vecli gallery (VECLI-8 / HYP-526).
 *
 * For every committed gallery script: (1) re-render its SVG and golden-compare against
 * `gallery/<name>.svg`, and (2) push that SVG through the resvg PNG path and assert a
 * valid raster. A deliberate generator-math change shifts the path `d` → the golden
 * compare fails; an unrelated refactor leaves geometry identical → it passes. That is the
 * acceptance criterion for the harness.
 *
 * Regenerate goldens after an INTENTIONAL output change:
 *   GALLERY_UPDATE=1 bun test packages/vector-cli/test/gallery.test.ts
 * then review the `gallery/*.svg` diff before committing.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { svgToPng } from '../src/png';
import { GALLERY, type GalleryEntry, renderEntry } from './gallery/corpus';

const GALLERY_DIR = join(import.meta.dir, '..', 'gallery');
const UPDATE = process.env.GALLERY_UPDATE === '1';

function goldenPath(name: string): string {
  return join(GALLERY_DIR, `${name}.svg`);
}

describe('vecli gallery visual regression (VECLI-8 / HYP-526)', () => {
  for (const entry of GALLERY) {
    describe(entry.name, () => {
      it('matches the committed golden SVG', () => {
        const svg = renderEntry(entry);
        const path = goldenPath(entry.name);

        if (UPDATE) {
          writeFileSync(path, `${svg}\n`);
        }

        // A missing golden is a hard failure (not auto-pass): regenerate with GALLERY_UPDATE=1.
        expect(existsSync(path)).toBe(true);
        const golden = readFileSync(path, 'utf-8').trim();
        expect(svg.trim()).toBe(golden);
      });

      it('renders to a valid PNG via the resvg path', () => {
        const png = svgToPng(renderEntry(entry), 200);
        expect(png).toBeInstanceOf(Buffer);
        expect(png.length).toBeGreaterThan(0);
        // PNG magic bytes \x89 P N G
        expect(png[0]).toBe(0x89);
        expect(png[1]).toBe(0x50);
        expect(png[2]).toBe(0x4e);
        expect(png[3]).toBe(0x47);
        // Rendered at the requested fit width.
        expect(png.readUInt32BE(16)).toBe(200);
      });
    });
  }

  it('is deterministic — re-rendering the same entry yields byte-identical SVG', () => {
    for (const entry of GALLERY) {
      expect(renderEntry(entry)).toBe(renderEntry(entry));
    }
  });

  it('detects a deliberate geometry change (guards the harness itself)', () => {
    // Same helper, different params → different path `d` → different SVG. Proves the
    // golden compare above would catch a real generator-math regression.
    const baseline = renderEntry(GALLERY[0]);
    const altered: GalleryEntry = { name: 'ribbon-altered', build: (g) => g.ribbon(200, 35, 10) };
    expect(renderEntry(altered)).not.toBe(baseline);
  });
});
