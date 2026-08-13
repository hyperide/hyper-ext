/**
 * Unit tests for SupportDimensionsTabs — the per-(sub-)repo support breakdown shown in
 * the preview panel as one tab per BLOCKING dimension (unsupported | needs-setup), each a
 * table of WHY (reason + evidence rows).
 *
 * Renders through the extension's OWN react-dom/client (not @testing-library/react). The
 * extension declares react/react-dom locally while @testing-library/react resolves from
 * the monorepo root — so testing-library renders with a DIFFERENT React instance than this
 * stateful component imports, which trips React's "Invalid hook call / more than one copy
 * of React" guard (the existing webview render tests dodge it only because their components
 * are stateless). Driving the local react-dom keeps a single React instance, so the
 * component's hooks work. Same DOM-walking lookup as UnsupportedFrameworkScreen.test
 * (happy-dom's selector parser leaks across files in the full suite).
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TID } from '@shared/data-testid-map';
import type { SupportDimension } from '../../types';
import { SupportDimensionsTabs } from '../SupportDimensionsTabs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { root: Root; container: HTMLElement } | null = null;

function renderLocal(node: React.ReactElement): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted = { root, container };
  return container;
}

function clickEl(el: Element): void {
  act(() => {
    el.dispatchEvent(new Event('click', { bubbles: true }));
  });
}

afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

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

const frameworkDim: SupportDimension = {
  id: 'framework',
  title: 'Framework',
  status: 'unsupported',
  reason: 'Vue.js projects not supported',
  evidence: [
    { label: 'Detected framework', detail: 'Vue' },
    { label: 'Dependency', detail: 'vue' },
  ],
};

const bundlerDim: SupportDimension = {
  id: 'bundler',
  title: 'Build / Bundler',
  status: 'unsupported',
  reason: 'HyperIDE could not detect a supported framework in this project.',
  evidence: [{ label: 'Detected bundler', detail: 'unknown' }],
};

const rnDim: SupportDimension = {
  id: 'framework',
  title: 'Framework',
  status: 'needs-setup',
  reason: 'React Native projects need react-native-web and a Vite config to render in a browser.',
  fixLabel: 'Fix: Add react-native-web + Vite config',
  evidence: [{ label: 'Missing', detail: 'react-native-web' }],
};

describe('SupportDimensionsTabs', () => {
  it('renders the root and one tab button per dimension', () => {
    const container = renderLocal(<SupportDimensionsTabs dimensions={[frameworkDim, bundlerDim]} />);
    expect(findOptional(container, TID.preview.supportTabsRoot)).not.toBeNull();
    expect(findOptional(container, TID.preview.supportTab('framework'))).not.toBeNull();
    expect(findOptional(container, TID.preview.supportTab('bundler'))).not.toBeNull();
  });

  it('shows the first dimension reason + evidence by default', () => {
    const container = renderLocal(<SupportDimensionsTabs dimensions={[frameworkDim, bundlerDim]} />);
    const panel = find(container, TID.preview.supportTabPanel('framework'));
    expect(panel.textContent).toContain('Vue.js projects not supported');
    expect(panel.textContent).toContain('Detected framework');
    expect(panel.textContent).toContain('Vue');
  });

  it('switches the visible panel when another tab is clicked', () => {
    const container = renderLocal(<SupportDimensionsTabs dimensions={[frameworkDim, bundlerDim]} />);
    clickEl(find(container, TID.preview.supportTab('bundler')));
    expect(findOptional(container, TID.preview.supportTabPanel('bundler'))).not.toBeNull();
    expect(find(container, TID.preview.supportTabPanel('bundler')).textContent).toContain(
      'could not detect a supported framework',
    );
  });

  it('renders a Fix button for a needs-setup dimension and invokes onFix with the dimension id', () => {
    let fixed: string | null = null;
    const container = renderLocal(<SupportDimensionsTabs dimensions={[rnDim]} onFix={(id) => (fixed = id)} />);
    const fixBtn = find(container, TID.preview.supportFixButton);
    expect(fixBtn.textContent).toContain('Fix: Add react-native-web');
    clickEl(fixBtn);
    expect(fixed).toBe('framework');
  });

  it('renders nothing when there are no dimensions', () => {
    const container = renderLocal(<SupportDimensionsTabs dimensions={[]} />);
    expect(findOptional(container, TID.preview.supportTabsRoot)).toBeNull();
  });
});
