/**
 * @file Shared source resolution logic for element click/hover.
 *
 * Accessed via: SaaS ElementTracer + Extension iframe-interaction.ts
 * Assumptions: fiber _debugSource available (React dev mode with Babel plugin).
 *
 * Handles the "call site vs component internal" problem:
 * - Elements from the rendered component file → use direct fiber source
 * - Elements from imported components (Button.tsx internals) → walk up fiber
 *   to find the CALL SITE (where <Button> is used in the parent component)
 */

import { debugSourceToLocation, type Fiber } from '../element-tracing/fiber-internals';
import type { SourceLocation } from '../element-tracing/types';

/**
 * Resolve the effective source location for a clicked/hovered element.
 * Walks up the fiber tree to find the call site when the element is inside
 * an imported component (different file than the rendered component).
 *
 * @param directSource - Source from the element's own fiber (_debugSource)
 * @param fiber - The element's React fiber
 * @param renderedFile - Currently rendered component path (e.g. "src/App.tsx")
 * @returns The resolved source (direct or call site)
 */
export function resolveCallSiteSource(
  directSource: SourceLocation,
  fiber: Fiber | null,
  renderedFile: string | null,
): SourceLocation {
  // If no rendered file info, can't determine — use direct source
  if (!renderedFile || !fiber) return directSource;

  // Check if direct source is from the rendered component file
  const isFromRenderedFile =
    directSource.fileName.endsWith(renderedFile) || renderedFile.endsWith(directSource.fileName);

  if (isFromRenderedFile) return directSource;

  // Source is from an imported component (e.g. Button.tsx internal <button>).
  // Walk up fiber to find the CALL SITE — first source from a DIFFERENT file.
  let current = fiber.return;
  for (let i = 0; i < 30 && current; i++) {
    if (current._debugSource) {
      const callerSource = debugSourceToLocation(current._debugSource);
      if (callerSource.fileName !== directSource.fileName) {
        return callerSource;
      }
    }
    current = current.return;
  }

  // No cross-file match — use direct source as fallback
  return directSource;
}
