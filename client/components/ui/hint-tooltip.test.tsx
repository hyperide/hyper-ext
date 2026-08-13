import { describe, expect, it } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import { HintTooltip } from './hint-tooltip';

// HYP-1001: HintTooltip renders a REAL in-DOM tooltip (Radix, portaled) — NOT a native `title`
// attribute. These tests assert the hint text actually becomes visible on interaction, so a
// regression that renders nothing (or falls back to `title`) fails loudly.
describe('HintTooltip', () => {
  it('renders the trigger child and adds no native title attribute', () => {
    const { getByTestId } = render(
      <HintTooltip label="Some hint">
        <button data-testid="trig" type="button">
          x
        </button>
      </HintTooltip>,
    );
    const trig = getByTestId('trig');
    expect(trig).not.toBeNull();
    expect(trig.getAttribute('title')).toBeNull();
  });

  it('shows the hint text when a focusable trigger (button) is focused', async () => {
    const label = 'Grid — rows and columns (display: grid)';
    const { getByTestId, findAllByText } = render(
      <HintTooltip label={label}>
        <button data-testid="trig" type="button">
          x
        </button>
      </HintTooltip>,
    );
    fireEvent.focus(getByTestId('trig'));
    const found = await findAllByText(label);
    expect(found.length).toBeGreaterThan(0);
  });

  it('shows the hint text when a non-focusable field trigger (div) is hovered', async () => {
    const label = 'Gap — spacing between stacked children';
    const { getByTestId, findAllByText } = render(
      <HintTooltip label={label}>
        <div data-testid="field">
          <input aria-label="gap" />
        </div>
      </HintTooltip>,
    );
    const field = getByTestId('field');
    fireEvent.pointerEnter(field);
    fireEvent.pointerMove(field);
    const found = await findAllByText(label);
    expect(found.length).toBeGreaterThan(0);
  });
});
