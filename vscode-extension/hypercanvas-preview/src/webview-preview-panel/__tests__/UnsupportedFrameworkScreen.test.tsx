/**
 * Unit tests for UnsupportedFrameworkScreen — the framework-compatibility table
 * shown in the preview panel when the project has no supported bundler/framework.
 * This screen REPLACES the old "unsupported project type" toast (HYP-442): the
 * compatibility table is the authoritative, non-redundant surface for this case.
 *
 * Same DOM-walking workaround as PreviewLoadErrorOverlay.test — happy-dom's
 * selector parser leaks state across files in the full bun:test suite, so we
 * iterate Element.children instead of using getByTestId / querySelector.
 */

import { describe, expect, it } from 'bun:test';
import { FRAMEWORK_SUPPORT } from '@shared/framework-support';
import { TID } from '@shared/data-testid-map';
import { render } from '@testing-library/react';
import { UnsupportedFrameworkScreen } from '../UnsupportedFrameworkScreen';

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

describe('UnsupportedFrameworkScreen', () => {
  it('renders the compatibility table root', () => {
    const { container } = render(<UnsupportedFrameworkScreen message="No supported framework detected." />);
    expect(findOptional(container, TID.preview.unsupportedFrameworkRoot)).not.toBeNull();
  });

  it('renders a row for every framework in FRAMEWORK_SUPPORT', () => {
    const { container } = render(<UnsupportedFrameworkScreen message="No supported framework detected." />);
    for (const { name } of FRAMEWORK_SUPPORT) {
      expect(findOptional(container, TID.preview.unsupportedFrameworkRow(name))).not.toBeNull();
    }
  });

  it('surfaces the explanatory message', () => {
    const { container } = render(<UnsupportedFrameworkScreen message="Custom unsupported message." />);
    expect(container.textContent).toContain('Custom unsupported message.');
  });
});
