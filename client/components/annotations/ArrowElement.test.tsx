/**
 * @file ArrowElement dark-mode contrast regression test (HYP-400)
 *
 * Accessed via: AnnotationsLayer renders ArrowElement for each arrow annotation.
 * Assumptions:
 * - The arrow BODY outline and arrowhead outline use --annotation-outline, which
 *   stays light in BOTH themes (those fills are the user's strokeColor, typically
 *   dark), NOT --background (which goes near-black in dark mode).
 * - The arrow LABEL fill is --foreground (near-black light / near-white dark), so
 *   its outline must contrast with --foreground in BOTH themes. It therefore uses a
 *   SEPARATE --annotation-label-outline token (the inverse of --foreground), NOT
 *   --annotation-outline — in dark mode both --foreground and --annotation-outline
 *   are white, so reusing --annotation-outline for the label leaves it haloless.
 */

import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { ArrowElement } from './ArrowElement';
import type { ArrowAnnotation } from '../../../shared/types/annotations';

const baseArrow: ArrowAnnotation = {
  id: 'arrow-1',
  type: 'arrow',
  startX: 10,
  startY: 10,
  endX: 110,
  endY: 110,
  strokeColor: '#000000',
  strokeWidth: 3,
  label: 'hello',
  version: 1,
} as ArrowAnnotation;

const OUTLINE = 'hsl(var(--annotation-outline))';
const LABEL_OUTLINE = 'hsl(var(--annotation-label-outline))';
const LABEL_FILL = 'hsl(var(--foreground))';

describe('ArrowElement dark-mode contrast outlines (HYP-400)', () => {
  it('uses the annotation-outline contrast token for the body outline line', () => {
    const { container } = render(<ArrowElement arrow={baseArrow} isSelected={false} />);
    // The wider outline line is strokeWidth + 4 (= 7) vs the visible line (= 3).
    const lines = Array.from(container.querySelectorAll('line'));
    const outline = lines.find((l) => l.getAttribute('stroke-width') === '7');
    expect(outline).toBeTruthy();
    expect(outline?.getAttribute('stroke')).toBe(OUTLINE);
    expect(outline?.getAttribute('stroke')).not.toBe('hsl(var(--background))');
  });

  it('uses the annotation-outline contrast token for the arrowhead polygon outline', () => {
    const { container } = render(<ArrowElement arrow={baseArrow} isSelected={false} />);
    const polygon = container.querySelector('polygon');
    expect(polygon).toBeTruthy();
    expect(polygon?.getAttribute('stroke')).toBe(OUTLINE);
    expect(polygon?.getAttribute('stroke')).not.toBe('hsl(var(--background))');
  });

  it('uses the label-outline token (contrasting with the label fill) for the label outline text', () => {
    const { container } = render(<ArrowElement arrow={baseArrow} isSelected={false} />);
    const texts = Array.from(container.querySelectorAll('text'));
    const outlineText = texts.find((t) => t.getAttribute('stroke') && t.getAttribute('stroke') !== 'none');
    const fillText = texts.find((t) => t.getAttribute('fill') === LABEL_FILL);
    expect(outlineText).toBeTruthy();
    expect(fillText).toBeTruthy();
    // The label outline must use a token distinct from the label fill so it
    // contrasts in BOTH themes (in dark mode --foreground === --annotation-outline,
    // both white, so reusing --annotation-outline leaves the white label haloless).
    expect(outlineText?.getAttribute('stroke')).toBe(LABEL_OUTLINE);
    expect(outlineText?.getAttribute('stroke')).not.toBe(OUTLINE);
    expect(outlineText?.getAttribute('stroke')).not.toBe(LABEL_FILL);
  });
});
