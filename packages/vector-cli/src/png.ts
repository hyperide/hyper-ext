/**
 * @file PNG conversion — SVG to PNG via @resvg/resvg-js
 *
 * Accessed via: .png() method on ChainableNode, --format png flag
 * Assumptions: rendering is in-process (@resvg/resvg-js ships prebuilt
 *   native binaries); no external binary like rsvg-convert is required.
 */

import { Resvg } from '@resvg/resvg-js';

export function svgToPng(svg: string, width = 400): Buffer {
  try {
    const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width } });
    return resvg.render().asPng();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`PNG render failed: ${reason}`);
  }
}
