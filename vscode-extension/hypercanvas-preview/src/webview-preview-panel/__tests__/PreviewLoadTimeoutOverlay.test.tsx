/**
 * Unit tests for PreviewLoadTimeoutOverlay — the recovery UI shown when the
 * preview iframe doesn't fire `load` within PREVIEW_LOAD_TIMEOUT_MS. Verifies
 * the wiring of the retry / open-output buttons. The timeout *trigger* itself
 * is integration-tested via E2E in Task 5.
 *
 * Why not @testing-library/react's getByTestId here: in the full bun:test
 * suite, happy-dom's selector parser leaks state across files (it grabs
 * `window.SyntaxError` at parse-eagerly time and another test's setup leaves
 * it undefined). Using container.querySelector directly bypasses that path —
 * the rendered DOM is the same, we just look it up ourselves. LoadingSpinner's
 * test gets away with getByTestId because it runs before the parser corrupts;
 * we don't have that luxury and shouldn't depend on test ordering.
 */

import { describe, expect, it, mock } from 'bun:test';
import { TID } from '@shared/data-testid-map';
import { fireEvent, render } from '@testing-library/react';
import { PreviewLoadTimeoutOverlay } from '../PreviewLoadTimeoutOverlay';

// happy-dom's selector parser eagerly does `new this.window.SyntaxError(...)`
// for its error-template, and a sibling test in the full bun:test suite
// leaves the rendered container's window without a SyntaxError constructor —
// every querySelector throws TypeError before parsing the selector at all.
// Walk the DOM manually instead; we only need to find a known data-testid,
// not a real CSS selector.
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

describe('PreviewLoadTimeoutOverlay', () => {
  it('renders the recovery copy and both action buttons', () => {
    const { container } = render(<PreviewLoadTimeoutOverlay onRetry={() => {}} onOpenOutput={() => {}} />);

    expect(container.textContent).toContain("Component didn't load");
    expect(find(container, TID.preview.loadingTimeout)).not.toBeNull();
    expect(find(container, TID.preview.loadingTimeoutRetry)).not.toBeNull();
    expect(find(container, TID.preview.loadingTimeoutOpenOutput)).not.toBeNull();
  });

  it('invokes onRetry when the Retry button is clicked', () => {
    const onRetry = mock(() => {});
    const { container } = render(<PreviewLoadTimeoutOverlay onRetry={onRetry} onOpenOutput={() => {}} />);

    fireEvent.click(find(container, TID.preview.loadingTimeoutRetry));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('invokes onOpenOutput when the Open output panel button is clicked', () => {
    const onOpenOutput = mock(() => {});
    const { container } = render(<PreviewLoadTimeoutOverlay onRetry={() => {}} onOpenOutput={onOpenOutput} />);

    fireEvent.click(find(container, TID.preview.loadingTimeoutOpenOutput));
    expect(onOpenOutput).toHaveBeenCalledTimes(1);
  });

  it('exposes the canonical "Retry" button label so users have a clear action', () => {
    const { container } = render(<PreviewLoadTimeoutOverlay onRetry={() => {}} onOpenOutput={() => {}} />);

    expect(find(container, TID.preview.loadingTimeoutRetry).textContent).toBe('Retry');
  });

  it('labels the secondary action "Open output panel" so users find dev-server logs', () => {
    const { container } = render(<PreviewLoadTimeoutOverlay onRetry={() => {}} onOpenOutput={() => {}} />);

    expect(find(container, TID.preview.loadingTimeoutOpenOutput).textContent).toBe('Open output panel');
  });
});
