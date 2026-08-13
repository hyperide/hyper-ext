/**
 * Unit tests for DevServerUnreachableOverlay — the trusted webview action surface
 * shown when the raw iframe warning page reports that `/test-preview` is unreachable.
 */

import { describe, expect, it, mock } from 'bun:test';
import { TID } from '@shared/data-testid-map';
import { fireEvent, render } from '@testing-library/react';
import { buildDevServerUnreachablePrompt, DevServerUnreachableOverlay } from '../DevServerUnreachableOverlay';

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

describe('DevServerUnreachableOverlay', () => {
  it('renders the unreachable-route message and actions', () => {
    const { container } = render(
      <DevServerUnreachableOverlay
        proxyPath="/test-preview?component=src%2FApp.tsx"
        statusCode={404}
        targetPort={3000}
        onAutoFix={() => {}}
        onDismiss={() => {}}
      />,
    );

    expect(find(container, TID.preview.devServerUnreachable)).not.toBeNull();
    expect(container.textContent).toContain("HyperCanvas can't reach this preview route");
    expect(container.textContent).toContain('localhost:3000');
    expect(container.textContent).toContain('404');
    expect(container.textContent).toContain('/test-preview?component=src%2FApp.tsx');
    expect(container.textContent).toContain('fallback/catch-all route');
    expect(find(container, TID.preview.devServerUnreachableAutoFix)).not.toBeNull();
    expect(find(container, TID.preview.devServerUnreachableDismiss)).not.toBeNull();
  });

  it('sends the exact Auto Fix prompt when Auto Fix is clicked', () => {
    const onAutoFix = mock((_prompt: string) => {});
    const proxyPath = '/test-preview?component=src%2FApp.tsx';
    const { container } = render(
      <DevServerUnreachableOverlay
        proxyPath={proxyPath}
        statusCode={503}
        targetPort={5173}
        onAutoFix={onAutoFix}
        onDismiss={() => {}}
      />,
    );

    fireEvent.click(find(container, TID.preview.devServerUnreachableAutoFix));

    expect(onAutoFix).toHaveBeenCalledTimes(1);
    expect(onAutoFix.mock.calls[0][0]).toBe(buildDevServerUnreachablePrompt(proxyPath, 503, 5173));
  });

  it('invokes onDismiss when Dismiss is clicked', () => {
    const onDismiss = mock(() => {});
    const { container } = render(
      <DevServerUnreachableOverlay
        proxyPath="/test-preview"
        statusCode={null}
        targetPort={3000}
        onAutoFix={() => {}}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(find(container, TID.preview.devServerUnreachableDismiss));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
