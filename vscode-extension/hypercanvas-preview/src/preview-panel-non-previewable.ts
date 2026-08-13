/**
 * @file Host-side glue that turns a non-previewable opened file into the canvas
 *   error payload (clear message + ranked component recommendations).
 *
 * Reached from extension.ts `onComponentMissing`: when the previewed file fires the
 * iframe's `_ComponentMissingSignal` (no registry Component, no SampleDefault), the
 * host asks here whether the file can EVER converge into a preview. A ReactDOM entry
 * (`main.tsx`) or a file with no renderable component export cannot, so we stop the
 * self-heal retry loop and hand back a `NonPreviewableFilePayload` for the
 * NonPreviewableFileOverlay instead of leaving the iframe on "Generating sample…".
 *
 * The pure classification + ranking live in `@lib/preview-generator/previewability`;
 * the I/O (reading the file, scanning the project) is injected so this stays unit-
 * testable without the VS Code API.
 */

import {
  classifyNonPreviewable,
  type ComponentRecommendation,
  type NonPreviewableReason,
  rankComponentRecommendations,
} from '@lib/preview-generator';
import type { ComponentInfo, ComponentTree } from './services/ComponentService';
import type { NonPreviewableFilePayload } from './types';

export interface NonPreviewableDeps {
  /** Project-relative path of the opened file (for the payload + self-exclusion). */
  filePath: string;
  /** Read the opened file's source; resolves null when unreadable. */
  readSource: () => Promise<string | null>;
  /** All renderable component files in the project, as {path, name}. */
  listRenderableComponents: () => Promise<ComponentRecommendation[]>;
}

/** Flatten a scanned ComponentTree into {path, name} recommendation candidates. */
export function flattenComponentTree(tree: ComponentTree): ComponentRecommendation[] {
  const toRec = (c: ComponentInfo): ComponentRecommendation => ({ path: c.path, name: c.name });
  // Drop HyperIDE-generated scaffolds (__canvas_preview__.tsx / __canvas_preview_standalone__.tsx)
  // — they are infrastructure, not user components to recommend previewing.
  const isGenerated = (c: ComponentInfo) => /__canvas_preview/.test(c.path);
  return [...tree.pages, ...tree.composites, ...tree.atoms].filter((c) => !isGenerated(c)).map(toRec);
}

/**
 * Classify the opened file and, when it cannot be previewed, build the canvas error
 * payload with ranked recommendations. Returns null when the file IS previewable
 * (the caller then continues the normal preview/retry pipeline).
 */
export async function buildNonPreviewablePayload(deps: NonPreviewableDeps): Promise<NonPreviewableFilePayload | null> {
  const source = await deps.readSource();
  if (source == null) return null;

  let reason: NonPreviewableReason | null;
  try {
    reason = classifyNonPreviewable(source);
  } catch {
    // Source the parser can't read AND the iframe couldn't render — it will never
    // converge into a preview, so treat it as non-previewable rather than retrying.
    reason = 'no-renderable-export';
  }
  if (reason == null) return null;

  const components = await deps.listRenderableComponents().catch(() => []);
  const recommendations = rankComponentRecommendations(components, { excludePath: deps.filePath });
  return { filePath: deps.filePath, reason, recommendations };
}
