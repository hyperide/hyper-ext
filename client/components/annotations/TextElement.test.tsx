/**
 * @file TextElement dark-mode contrast regression test (HYP-400)
 *
 * Accessed via: AnnotationsLayer renders TextElement for each text annotation.
 * Assumptions: the non-editing text shadow must use a theme-aware contrast token
 * (--annotation-outline) that stays light in BOTH themes, NOT --background (which
 * goes near-black in dark mode and kills contrast against dark text fills).
 */

import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react';
import { TextElement } from './TextElement';
import type { TextAnnotation } from '../../../shared/types/annotations';

const baseText: TextAnnotation = {
  id: 'text-1',
  type: 'text',
  x: 10,
  y: 10,
  text: 'hello',
  fontSize: 16,
  color: '#000000',
  version: 1,
};

describe('TextElement dark-mode contrast shadow (HYP-400)', () => {
  it('uses the annotation-outline contrast token for the non-editing text shadow', () => {
    const { container } = render(
      <TextElement
        text={baseText}
        isSelected={false}
        isEditing={false}
        onEndEdit={mock(() => {})}
        onChange={mock(() => {})}
      />,
    );

    const div = container.querySelector('[data-text-area] div') as HTMLElement | null;
    expect(div).toBeTruthy();
    const shadow = div?.style.textShadow ?? '';
    expect(shadow).toContain('var(--annotation-outline)');
    expect(shadow).not.toContain('var(--background)');
  });
});
