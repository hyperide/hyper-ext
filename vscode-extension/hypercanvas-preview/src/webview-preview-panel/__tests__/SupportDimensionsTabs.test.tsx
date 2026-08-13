/**
 * Unit tests for SupportDimensionsTabs — the per-(sub-)repo support breakdown shown in
 * the preview panel for BLOCKING dimensions (unsupported | needs-setup). A single
 * dimension renders straight to its screen (no tab bar); a tab bar is added ON TOP only
 * when there's more than one. The 'framework'+'unsupported' dimension (Vue/Svelte/
 * Angular/no-React) renders the legacy cross-framework compatibility table
 * (`FrameworkUnsupportedContent`, same as `UnsupportedFrameworkScreen`) — HYP-913, the
 * fix for Alex's repeated "this is some new screen" report.
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
import { FRAMEWORK_SUPPORT } from '@shared/framework-support';
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
  it('a single framework-unsupported dimension renders no tab bar and the legacy compatibility table', () => {
    const container = renderLocal(<SupportDimensionsTabs dimensions={[frameworkDim]} />);
    expect(findOptional(container, TID.preview.supportTabsRoot)).not.toBeNull();
    expect(container.querySelectorAll('[role="tablist"]').length).toBe(0);
    expect(container.textContent).not.toContain('This project needs attention');

    const panel = find(container, TID.preview.supportTabPanel('framework'));
    expect(panel.getAttribute('role')).toBeNull();
    expect(panel.textContent).toContain('Framework not supported');
    expect(panel.textContent).toContain('Vue.js projects not supported');
    // The FULL cross-framework table, not just the detected framework's own evidence rows —
    // same content as the pre-HYP-788 UnsupportedFrameworkScreen (HYP-913).
    for (const { name } of FRAMEWORK_SUPPORT) {
      expect(findOptional(container, TID.preview.unsupportedFrameworkRow(name))).not.toBeNull();
    }
  });

  it('renders the root and one tab button per dimension when there is more than one', () => {
    const container = renderLocal(<SupportDimensionsTabs dimensions={[frameworkDim, bundlerDim]} />);
    expect(findOptional(container, TID.preview.supportTabsRoot)).not.toBeNull();
    expect(findOptional(container, TID.preview.supportTab('framework'))).not.toBeNull();
    expect(findOptional(container, TID.preview.supportTab('bundler'))).not.toBeNull();
  });

  it('shows the legacy compatibility table for the framework dimension by default, as an ADDITION not a replacement', () => {
    const container = renderLocal(<SupportDimensionsTabs dimensions={[frameworkDim, bundlerDim]} />);
    const panel = find(container, TID.preview.supportTabPanel('framework'));
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.textContent).toContain('Vue.js projects not supported');
    expect(panel.textContent).toContain('Framework not supported');
    expect(findOptional(container, TID.preview.unsupportedFrameworkRow('Vue'))).not.toBeNull();
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

  // HYP-905: a single blocking dimension is just the table — no tab bar, and no
  // generic "needs attention" filler heading above it (Alex's original ask was
  // "tabs only when there are several dimensions", not a new always-tabbed screen).
  it('renders no tablist and no generic heading when there is only one dimension', () => {
    const container = renderLocal(<SupportDimensionsTabs dimensions={[frameworkDim]} />);
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(findOptional(container, TID.preview.supportTab('framework'))).toBeNull();
    expect(find(container, TID.preview.supportTabPanel('framework')).textContent).toContain(
      'Vue.js projects not supported',
    );
    expect(container.textContent).not.toContain('needs attention');
  });

  it('renders a tablist when there is more than one dimension', () => {
    const container = renderLocal(<SupportDimensionsTabs dimensions={[frameworkDim, bundlerDim]} />);
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect(container.textContent).not.toContain('needs attention');
  });
});
