/**
 * @file PNG conversion — SVG to PNG via rsvg-convert
 *
 * Accessed via: .png() method on ChainableNode, --format png flag
 * Assumptions: rsvg-convert must be installed (brew install librsvg)
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function svgToPng(svg: string, width = 400): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'vecli-png-'));
  const svgPath = join(dir, 'input.svg');
  const pngPath = join(dir, 'output.png');
  try {
    writeFileSync(svgPath, svg);
    execSync(`rsvg-convert -w ${width} --keep-aspect-ratio "${svgPath}" -o "${pngPath}"`, {
      timeout: 10000,
    });
    return readFileSync(pngPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function isRsvgAvailable(): boolean {
  try {
    execSync('which rsvg-convert', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
