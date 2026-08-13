/**
 * Spacing guide calculation and rendering for drag/resize operations.
 *
 * Calculates pink spacing lines with pixel values between the active element
 * and its siblings — Figma-like spacing indicators for visual alignment.
 *
 * Accessed via: intended consumer is the resize/drag drag-handler onMove hook,
 *   which feeds it the active element rect + sibling rects and renders the result
 *   into an overlay container. As of HYP-405 no live consumer is wired (resize is
 *   extension-webview-only and SaaS disables resize handles); salvaged as the
 *   pure calc + DOM renderer building block for that future wiring (HYP-402).
 * Assumptions: runs in a browser environment with `document` available (renderer only;
 *   `calculateSpacingGuides` is pure and environment-agnostic).
 */

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface GuideLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SpacingGuide {
  direction: 'horizontal' | 'vertical';
  distance: number;
  line: GuideLine;
  labelPosition: { x: number; y: number };
}

/**
 * Check if two ranges overlap (exclusive — touching edges don't count).
 */
function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Get the overlap range between two ranges, clamped to the intersection.
 * Returns midpoint of the overlap region.
 */
function overlapMidpoint(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const overlapStart = Math.max(aStart, bStart);
  const overlapEnd = Math.min(aEnd, bEnd);
  return (overlapStart + overlapEnd) / 2;
}

interface GapResult {
  distance: number;
  start: number;
  end: number;
}

/**
 * Compute horizontal gap between two non-overlapping rects.
 * Returns null if rects overlap or touch on the horizontal axis.
 */
function computeHorizontalGap(
  activeLeft: number,
  activeRight: number,
  siblingLeft: number,
  siblingRight: number,
): GapResult | null {
  if (siblingLeft > activeRight) {
    return { distance: siblingLeft - activeRight, start: activeRight, end: siblingLeft };
  }
  if (activeLeft > siblingRight) {
    return { distance: activeLeft - siblingRight, start: siblingRight, end: activeLeft };
  }
  return null;
}

/**
 * Compute vertical gap between two non-overlapping rects.
 * Returns null if rects overlap or touch on the vertical axis.
 */
function computeVerticalGap(
  activeTop: number,
  activeBottom: number,
  siblingTop: number,
  siblingBottom: number,
): GapResult | null {
  if (siblingTop > activeBottom) {
    return { distance: siblingTop - activeBottom, start: activeBottom, end: siblingTop };
  }
  if (activeTop > siblingBottom) {
    return { distance: activeTop - siblingBottom, start: siblingBottom, end: activeTop };
  }
  return null;
}

/**
 * Calculate spacing guides between the active element and its siblings.
 *
 * For each sibling:
 * - Horizontal guide: only if the sibling vertically overlaps with active
 *   (roughly on the same row). Gap = distance between edges.
 * - Vertical guide: only if the sibling horizontally overlaps with active
 *   (roughly on the same column). Gap = distance between edges.
 *
 * Filters out zero and negative gaps (overlapping/touching elements).
 */
export function calculateSpacingGuides(active: Rect, siblings: Rect[]): SpacingGuide[] {
  if (siblings.length === 0) return [];

  const guides: SpacingGuide[] = [];

  const activeRight = active.left + active.width;
  const activeBottom = active.top + active.height;

  for (const sibling of siblings) {
    const siblingRight = sibling.left + sibling.width;
    const siblingBottom = sibling.top + sibling.height;

    // Horizontal guide: elements must vertically overlap
    if (rangesOverlap(active.top, activeBottom, sibling.top, siblingBottom)) {
      const hGap = computeHorizontalGap(active.left, activeRight, sibling.left, siblingRight);
      if (hGap) {
        const y = overlapMidpoint(active.top, activeBottom, sibling.top, siblingBottom);
        guides.push({
          direction: 'horizontal',
          distance: hGap.distance,
          line: { x1: hGap.start, x2: hGap.end, y1: y, y2: y },
          labelPosition: { x: (hGap.start + hGap.end) / 2, y },
        });
      }
    }

    // Vertical guide: elements must horizontally overlap
    if (rangesOverlap(active.left, activeRight, sibling.left, siblingRight)) {
      const vGap = computeVerticalGap(active.top, activeBottom, sibling.top, siblingBottom);
      if (vGap) {
        const x = overlapMidpoint(active.left, activeRight, sibling.left, siblingRight);
        guides.push({
          direction: 'vertical',
          distance: vGap.distance,
          line: { x1: x, x2: x, y1: vGap.start, y2: vGap.end },
          labelPosition: { x, y: (vGap.start + vGap.end) / 2 },
        });
      }
    }
  }

  return guides;
}

// ============================================================================
// Rendering: DOM elements for spacing guide overlays
// ============================================================================

const GUIDE_COLOR = '#EC4899';
const LABEL_FONT_SIZE = '10px';
const LABEL_PADDING = '2px 4px';

interface Viewport {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Render spacing guide overlays into a container.
 *
 * Creates absolutely-positioned DOM elements:
 * - Pink lines (1px) connecting element edges
 * - Small badges showing distance in pixels
 *
 * The caller should clear the container before calling this function.
 */
export function renderSpacingGuides(container: HTMLElement, guides: SpacingGuide[], viewport: Viewport): void {
  const { zoom, offsetX, offsetY } = viewport;

  for (const guide of guides) {
    const line = document.createElement('div');
    line.setAttribute('data-spacing-guide', 'true');
    line.style.position = 'absolute';
    line.style.pointerEvents = 'none';
    line.style.backgroundColor = GUIDE_COLOR;

    const x1 = guide.line.x1 * zoom + offsetX;
    const y1 = guide.line.y1 * zoom + offsetY;
    const x2 = guide.line.x2 * zoom + offsetX;
    const y2 = guide.line.y2 * zoom + offsetY;

    if (guide.direction === 'horizontal') {
      const width = Math.abs(x2 - x1);
      line.style.left = `${Math.min(x1, x2)}px`;
      line.style.top = `${y1}px`;
      line.style.width = `${width}px`;
      line.style.height = '1px';
    } else {
      const height = Math.abs(y2 - y1);
      line.style.left = `${x1}px`;
      line.style.top = `${Math.min(y1, y2)}px`;
      line.style.width = '1px';
      line.style.height = `${height}px`;
    }

    container.appendChild(line);

    // Distance label badge
    const label = document.createElement('div');
    label.setAttribute('data-spacing-label', 'true');
    label.style.position = 'absolute';
    label.style.pointerEvents = 'none';
    label.style.backgroundColor = GUIDE_COLOR;
    label.style.color = '#FFFFFF';
    label.style.fontSize = LABEL_FONT_SIZE;
    label.style.padding = LABEL_PADDING;
    label.style.borderRadius = '3px';
    label.style.whiteSpace = 'nowrap';
    label.style.lineHeight = '1';
    label.style.transform = 'translate(-50%, -50%)';
    label.textContent = String(Math.round(guide.distance));

    const labelX = guide.labelPosition.x * zoom + offsetX;
    const labelY = guide.labelPosition.y * zoom + offsetY;
    label.style.left = `${labelX}px`;
    label.style.top = `${labelY}px`;

    container.appendChild(label);
  }
}
