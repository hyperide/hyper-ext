/**
 * @file HarfBuzz text shaper — complex script layout via WASM
 *
 * Accessed via: textToPath node — shapes text before glyph extraction
 * Assumptions: harfbuzzjs WASM must be initialized before first use.
 *   Falls back to empty glyph list if WASM unavailable.
 * Tradeoffs: WASM init is async (~50ms). Subsequent calls are fast (~1ms).
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Text to Path
 */

export interface ShapedGlyph {
  glyphId: number;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
  cluster: number;
}

interface HarfBuzzBlob {
  destroy(): void;
}

interface HarfBuzzFace {
  destroy(): void;
}

interface HarfBuzzFont {
  setScale(xScale: number, yScale: number): void;
  destroy(): void;
}

interface HarfBuzzBuffer {
  addText(text: string): void;
  guessSegmentProperties(): void;
  json(): Array<{ g: number; ax: number; ay: number; dx: number; dy: number; cl: number }>;
  destroy(): void;
}

interface HarfBuzzInstance {
  createBlob(data: ArrayBuffer): HarfBuzzBlob;
  createFace(blob: HarfBuzzBlob, index: number): HarfBuzzFace;
  createFont(face: HarfBuzzFace): HarfBuzzFont;
  createBuffer(): HarfBuzzBuffer;
  shape(font: HarfBuzzFont, buffer: HarfBuzzBuffer): void;
}

let hbInstance: HarfBuzzInstance | null = null;
let initPromise: Promise<void> | null = null;

export async function initShaper(): Promise<void> {
  if (hbInstance) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      // harfbuzzjs index.js exports a Promise<HarfBuzzInstance> directly (CJS)
      const hbModule = await import('harfbuzzjs');
      const resolved = hbModule.default ?? hbModule;
      hbInstance = (resolved instanceof Promise ? await resolved : resolved) as HarfBuzzInstance;
    } catch {
      // WASM not available — shapeText will return empty
    }
  })();
  return initPromise;
}

export function shapeText(fontBlob: ArrayBuffer | null, text: string, fontSize: number): ShapedGlyph[] {
  if (!fontBlob || !text || !hbInstance) return [];

  try {
    const blob = hbInstance.createBlob(fontBlob);
    const face = hbInstance.createFace(blob, 0);
    const font = hbInstance.createFont(face);
    // HarfBuzz uses 26.6 fixed-point — scale by 64
    font.setScale(fontSize * 64, fontSize * 64);

    const buffer = hbInstance.createBuffer();
    buffer.addText(text);
    buffer.guessSegmentProperties();

    hbInstance.shape(font, buffer);
    const result = buffer.json();

    buffer.destroy();
    font.destroy();
    face.destroy();
    blob.destroy();

    return result.map((g) => ({
      glyphId: g.g,
      xAdvance: g.ax / 64,
      yAdvance: g.ay / 64,
      xOffset: g.dx / 64,
      yOffset: g.dy / 64,
      cluster: g.cl,
    }));
  } catch {
    return [];
  }
}

/** Reset shaper state (for testing). */
export function resetShaper(): void {
  hbInstance = null;
  initPromise = null;
}
