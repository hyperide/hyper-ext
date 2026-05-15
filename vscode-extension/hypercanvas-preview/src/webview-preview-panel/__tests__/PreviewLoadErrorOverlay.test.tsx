/**
 * Unit tests for PreviewLoadErrorOverlay — the recovery UI shown when the
 * preview iframe `error` event fires (network failure, dev server crash,
 * blocked subresource). Verifies that:
 *   - heading + buttons render with stable testids
 *   - the error text is surfaced inside the card so the user actually sees it
 *   - retry / open-output callbacks fire on click
 *   - the error message line is suppressed when the iframe didn't supply one
 *     (some browsers leave ErrorEvent.message empty)
 *
 * Same DOM-walking workaround as PreviewLoadTimeoutOverlay.test — happy-dom's
 * selector parser leaks state across files in the full bun:test suite, so we
 * iterate `Element.children` instead of using getByTestId / querySelector.
 */

import { describe, expect, it, mock } from 'bun:test';
import { TID } from '@shared/data-testid-map';
import { fireEvent, render } from '@testing-library/react';
import { PreviewLoadErrorOverlay } from '../PreviewLoadErrorOverlay';

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

describe('PreviewLoadErrorOverlay', () => {
  it('renders the failure copy and both action buttons', () => {
    const { container } = render(
      <PreviewLoadErrorOverlay error="Network error" onRetry={() => {}} onOpenOutput={() => {}} />,
    );

    expect(container.textContent).toContain('Preview failed to load');
    expect(find(container, TID.preview.loadingError)).not.toBeNull();
    expect(find(container, TID.preview.loadingErrorRetry)).not.toBeNull();
    expect(find(container, TID.preview.loadingErrorOpenOutput)).not.toBeNull();
  });

  it('shows the error message text the user can read', () => {
    const { container } = render(
      <PreviewLoadErrorOverlay
        error="Failed to fetch http://localhost:3000/test-preview"
        onRetry={() => {}}
        onOpenOutput={() => {}}
      />,
    );

    const message = find(container, TID.preview.loadingErrorMessage);
    expect(message.textContent).toBe('Failed to fetch http://localhost:3000/test-preview');
  });

  it('omits the error message line when the browser supplied no message', () => {
    const { container } = render(<PreviewLoadErrorOverlay error="" onRetry={() => {}} onOpenOutput={() => {}} />);

    expect(findOptional(container, TID.preview.loadingErrorMessage)).toBeNull();
  });

  it('also omits the error message line when error is null', () => {
    const { container } = render(<PreviewLoadErrorOverlay error={null} onRetry={() => {}} onOpenOutput={() => {}} />);

    expect(findOptional(container, TID.preview.loadingErrorMessage)).toBeNull();
  });

  it('invokes onRetry when the Retry button is clicked', () => {
    const onRetry = mock(() => {});
    const { container } = render(<PreviewLoadErrorOverlay error="boom" onRetry={onRetry} onOpenOutput={() => {}} />);

    fireEvent.click(find(container, TID.preview.loadingErrorRetry));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('invokes onOpenOutput when the Open output panel button is clicked', () => {
    const onOpenOutput = mock(() => {});
    const { container } = render(
      <PreviewLoadErrorOverlay error="boom" onRetry={() => {}} onOpenOutput={onOpenOutput} />,
    );

    fireEvent.click(find(container, TID.preview.loadingErrorOpenOutput));
    expect(onOpenOutput).toHaveBeenCalledTimes(1);
  });

  it('exposes the canonical "Retry" button label so users have a clear action', () => {
    const { container } = render(<PreviewLoadErrorOverlay error="boom" onRetry={() => {}} onOpenOutput={() => {}} />);

    expect(find(container, TID.preview.loadingErrorRetry).textContent).toBe('Retry');
  });

  it('labels the secondary action "Open output panel" so users find dev-server logs', () => {
    const { container } = render(<PreviewLoadErrorOverlay error="boom" onRetry={() => {}} onOpenOutput={() => {}} />);

    expect(find(container, TID.preview.loadingErrorOpenOutput).textContent).toBe('Open output panel');
  });
});
