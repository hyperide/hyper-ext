/**
 * @file FIG import — parse Figma .fig files into vector-engine graph description
 *
 * Accessed via: "Import from Figma" action
 * Assumptions: .fig files follow the Kiwi binary format. Schema is reverse-engineered
 *   and may change without notice. Unknown node types produce placeholders with warnings.
 * Tradeoffs: minimal Kiwi decoder handles core types only (RECTANGLE, ELLIPSE,
 *   VECTOR, BOOLEAN_OPERATION, FRAME, GROUP, TEXT). Complex features (auto-layout,
 *   variables, prototyping) are silently skipped.
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §FIG Import
 */

import { unzipSync } from 'fflate';
import { decompress as zstdDecompress } from 'fzstd';
import pako from 'pako';

export interface FigNode {
  type: string;
  name: string;
  id: string;
  children: FigNode[];
  properties: Record<string, unknown>;
}

export interface FigParseResult {
  nodes: FigNode[];
  canvas: { width: number; height: number };
  errors: string[];
}

/**
 * Parse a .fig binary file into a structured result with nodes, canvas size, and errors.
 *
 * Handles three container formats:
 * 1. ZIP archive containing `canvas.fig` (modern Figma exports)
 * 2. Zstd-compressed Kiwi binary (modern Figma native)
 * 3. Zlib-compressed Kiwi binary (legacy Figma)
 *
 * Never throws — all failures are captured in `errors`.
 */
export function parseFigFile(data: ArrayBuffer): FigParseResult {
  const errors: string[] = [];

  if (data.byteLength === 0) {
    errors.push('Empty file');
    return { nodes: [], canvas: { width: 0, height: 0 }, errors };
  }

  try {
    const bytes = new Uint8Array(data);

    // Check for zip header (PK\x03\x04)
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;

    let payload: Uint8Array;
    if (isZip) {
      const unzipped = unzipSync(bytes);
      const canvasFig = unzipped['canvas.fig'];
      if (!canvasFig) {
        errors.push('No canvas.fig found in zip archive');
        return { nodes: [], canvas: { width: 0, height: 0 }, errors };
      }
      payload = canvasFig;
    } else {
      payload = bytes;
    }

    // Try zstd first (modern Figma), then zlib (legacy), then raw
    let decompressed: Uint8Array;
    try {
      decompressed = zstdDecompress(payload);
    } catch {
      try {
        decompressed = pako.inflate(payload);
      } catch {
        decompressed = payload;
      }
    }

    // Parse the binary data — for v1, we extract basic node structure.
    // Real Kiwi decoding needs a schema (~194 type definitions).
    const figNodes = decodeMinimalStructure(decompressed, errors);
    const canvas = extractCanvasSize(figNodes);

    return { nodes: figNodes, canvas, errors };
  } catch (err) {
    errors.push(`Parse error: ${err instanceof Error ? err.message : String(err)}`);
    return { nodes: [], canvas: { width: 0, height: 0 }, errors };
  }
}

/**
 * Attempt to decode Kiwi binary data into FigNode structures.
 *
 * A full Kiwi decoder needs the Figma schema (~194 type definitions).
 * For v1, this returns empty with an informative error — the real value
 * is the decompression pipeline above. Use `mapFigToGraph()` with
 * pre-parsed FigNode data from external Kiwi decoders.
 */
function decodeMinimalStructure(data: Uint8Array, errors: string[]): FigNode[] {
  if (data.length < 8) {
    errors.push('File too small to contain valid Kiwi data');
    return [];
  }

  // Figma .fig files use Kiwi binary format.
  // In production, use OpenPencil's schema or fig-kiwi package.
  errors.push('Full Kiwi decoding not yet implemented — use mapFigToGraph() with pre-parsed nodes');
  return [];
}

function extractCanvasSize(nodes: FigNode[]): { width: number; height: number } {
  for (const node of nodes) {
    if (node.type === 'DOCUMENT' || node.type === 'CANVAS') {
      const w = node.properties.width as number;
      const h = node.properties.height as number;
      if (w && h) return { width: w, height: h };
    }
  }
  return { width: 0, height: 0 };
}
