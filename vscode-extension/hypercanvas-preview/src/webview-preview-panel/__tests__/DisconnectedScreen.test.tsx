/**
 * Unit tests for DisconnectedScreen — the shared ConnectionErrorOverlay wrapper
 * shown when the dev server stops after a successful connection (HYP-647).
 * Replaces the old ReconnectingBanner + DisconnectedPreviewScreen pair, keeping
 * both e2e contracts: the `hyper-preview-reconnecting` root testid
 * (visual-regression.spec.ts) and the start-server button testid.
 *
 * Same DOM-walking workaround as UnsupportedFrameworkScreen.test — happy-dom's
 * selector parser leaks state across files in the full bun:test suite, so we
 * iterate Element.children instead of using getByTestId / querySelector.
 */

import { describe, expect, it, mock } from 'bun:test';
import { TID } from '@shared/data-testid-map';
import { fireEvent, render } from '@testing-library/react';
import { DisconnectedScreen } from '../DisconnectedScreen';

function find(container: Element, testid: string): HTMLElement {
  const stack: Element[] = [container];
  while (stack.length) {
    const el = stack.pop();
    if (!el) continue;
    if (el.getAttribute && el.getAttribute('data-testid') === testid) return el as HTMLElement;
    for (let i = 0; i < el.children.length; i++) stack.push(el.children[i]);
  }
  throw new Error(`No element with data-testid="${testid}"`);
}

function findOptional(container: Element, testid: string): HTMLElement | null {
  try {
    return find(container, testid);
  } catch {
    return null;
  }
}

describe('DisconnectedScreen', () => {
  it('renders the reconnecting root testid (e2e contract)', () => {
    const { container } = render(<DisconnectedScreen onStart={() => {}} />);
    expect(findOptional(container, 'hyper-preview-reconnecting')).not.toBeNull();
  });

  it('renders the disconnect message', () => {
    const { container } = render(<DisconnectedScreen onStart={() => {}} />);
    expect(container.textContent).toContain('Dev server disconnected');
  });

  it('renders the start button with the e2e-pinned testid', () => {
    const { container } = render(<DisconnectedScreen onStart={() => {}} />);
    const button = findOptional(container, TID.preview.startServerButton);
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain('Start Dev Server');
  });

  it('start button click invokes onStart', () => {
    const onStart = mock(() => {});
    const { container } = render(<DisconnectedScreen onStart={onStart} />);
    fireEvent.click(find(container, TID.preview.startServerButton));
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
