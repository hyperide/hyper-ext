/**
 * Tests the exported pure functions that useComponentAutoLoad uses internally.
 * Covers the race-condition fix (HYP-224): server returning success: false
 * must NOT mark components as loaded, allowing retry on next event.
 */
import { describe, expect, it } from 'bun:test';
import {
  type AvailableComponents,
  type ComponentInfo,
  flattenComponentGroups,
  hasNoRenderableComponents,
  isEntryPoint,
  selectComponentToLoad,
} from '../useComponentAutoLoad';

describe('flattenComponentGroups', () => {
  it('returns null when server reports failure', () => {
    const result = flattenComponentGroups({ success: false });
    expect(result).toBeNull();
  });

  it('returns null for "No active project" error', () => {
    const result = flattenComponentGroups({
      success: false,
      atomGroups: [],
      compositeGroups: [],
    });
    expect(result).toBeNull();
  });

  it('flattens grouped components into flat arrays', () => {
    const result = flattenComponentGroups({
      success: true,
      atomGroups: [
        { dirPath: 'src', components: [{ name: 'Button', path: 'src/Button.tsx' }] },
        { dirPath: 'src', components: [{ name: 'Input', path: 'src/Input.tsx' }] },
      ],
      compositeGroups: [{ dirPath: 'src', components: [{ name: 'Form', path: 'src/Form.tsx' }] }],
    });

    expect(result).toEqual({
      atoms: [
        { name: 'Button', path: 'src/Button.tsx' },
        { name: 'Input', path: 'src/Input.tsx' },
      ],
      composites: [{ name: 'Form', path: 'src/Form.tsx' }],
      pages: [],
    });
  });

  // HYP-680: pages are a renderable category — must not be dropped on the floor.
  it('flattens pageGroups so a page-only project exposes its page', () => {
    const result = flattenComponentGroups({
      success: true,
      atomGroups: [],
      compositeGroups: [],
      pageGroups: [{ dirPath: 'src', components: [{ name: 'App.tsx', path: 'src/App.tsx' }] }],
    });

    expect(result).toEqual({
      atoms: [],
      composites: [],
      pages: [{ name: 'App.tsx', path: 'src/App.tsx' }],
    });
  });

  // HYP-680 / Codex P2: monorepos leave flat pageGroups empty and carry pages under
  // subProjects[].pageGroups. A page-only monorepo app must still surface its page.
  it('folds sub-project pageGroups into pages for monorepos', () => {
    const result = flattenComponentGroups({
      success: true,
      isMonorepo: true,
      atomGroups: [],
      compositeGroups: [],
      pageGroups: [],
      subProjects: [
        {
          name: 'web',
          path: 'apps/web',
          supported: true,
          atomGroups: [],
          compositeGroups: [],
          pageGroups: [{ dirPath: 'apps/web/src', components: [{ name: 'App.tsx', path: 'apps/web/src/App.tsx' }] }],
        },
      ],
    });

    expect(result).toEqual({
      atoms: [],
      composites: [],
      pages: [{ name: 'App.tsx', path: 'apps/web/src/App.tsx' }],
    });
  });

  it('handles missing groups gracefully', () => {
    const result = flattenComponentGroups({ success: true });
    expect(result).toEqual({ atoms: [], composites: [], pages: [] });
  });

  it('handles empty groups', () => {
    const result = flattenComponentGroups({
      success: true,
      atomGroups: [],
      compositeGroups: [],
    });
    expect(result).toEqual({ atoms: [], composites: [], pages: [] });
  });
});

// HYP-680: the NoComponentOverlay gate. Pages are renderable, so a page-only
// project must render the page — NOT show the "no components" overlay.
describe('hasNoRenderableComponents', () => {
  const make = (over: Partial<AvailableComponents>): AvailableComponents => ({
    atoms: [],
    composites: [],
    pages: [],
    isLoaded: true,
    ...over,
  });

  it('is true when there are no atoms, composites, or pages', () => {
    expect(hasNoRenderableComponents(make({}))).toBe(true);
  });

  it('is false when only pages exist (page-only project must render)', () => {
    expect(hasNoRenderableComponents(make({ pages: [{ name: 'App.tsx', path: 'src/App.tsx' }] }))).toBe(false);
  });

  it('is false when atoms exist', () => {
    expect(hasNoRenderableComponents(make({ atoms: [{ name: 'Button', path: 'src/Button.tsx' }] }))).toBe(false);
  });

  it('is false when composites exist', () => {
    expect(hasNoRenderableComponents(make({ composites: [{ name: 'Form', path: 'src/Form.tsx' }] }))).toBe(false);
  });
});

describe('isEntryPoint', () => {
  it.each(['main.tsx', 'index.ts', '_app.jsx', 'Main.TSX', 'INDEX.js'])('returns true for %s', (name) => {
    expect(isEntryPoint(name)).toBe(true);
  });

  it.each(['Button.tsx', 'Header.ts', 'App.tsx', 'main-layout.tsx'])('returns false for %s', (name) => {
    expect(isEntryPoint(name)).toBe(false);
  });
});

describe('selectComponentToLoad', () => {
  const atoms: ComponentInfo[] = [{ name: 'Button', path: 'src/Button.tsx' }];
  const composites: ComponentInfo[] = [{ name: 'Form', path: 'src/Form.tsx' }];
  const pages: ComponentInfo[] = [{ name: 'App.tsx', path: 'src/App.tsx' }];

  it('restores persisted component when no current component', () => {
    const result = selectComponentToLoad({
      atoms,
      composites,
      pages,
      currentComponentName: undefined,
      mode: 'design',
      persistedOpenedComponent: 'src/Button.tsx',
    });
    expect(result).toBe('src/Button.tsx');
  });

  it('restores a persisted page when no current component (HYP-680)', () => {
    const result = selectComponentToLoad({
      atoms: [],
      composites: [],
      pages,
      currentComponentName: undefined,
      mode: 'design',
      persistedOpenedComponent: 'src/App.tsx',
    });
    expect(result).toBe('src/App.tsx');
  });

  it('ignores persisted component when current component exists', () => {
    const result = selectComponentToLoad({
      atoms,
      composites,
      pages,
      currentComponentName: 'Header',
      mode: 'design',
      persistedOpenedComponent: 'src/Button.tsx',
    });
    // Current component is not an entry point, so no auto-select
    expect(result).toBeNull();
  });

  it('prefers composites over atoms for auto-select', () => {
    const result = selectComponentToLoad({
      atoms,
      composites,
      pages,
      currentComponentName: undefined,
      mode: 'design',
      persistedOpenedComponent: undefined,
    });
    expect(result).toBe('src/Form.tsx');
  });

  it('falls back to first atom when no composites', () => {
    const result = selectComponentToLoad({
      atoms,
      composites: [],
      pages: [],
      currentComponentName: undefined,
      mode: 'design',
      persistedOpenedComponent: undefined,
    });
    expect(result).toBe('src/Button.tsx');
  });

  // HYP-680: a page-only project (no atoms, no composites) must auto-render its page.
  it('auto-selects a page when there are no atoms or composites', () => {
    const result = selectComponentToLoad({
      atoms: [],
      composites: [],
      pages,
      currentComponentName: undefined,
      mode: 'design',
      persistedOpenedComponent: undefined,
    });
    expect(result).toBe('src/App.tsx');
  });

  it('returns null when no components available', () => {
    const result = selectComponentToLoad({
      atoms: [],
      composites: [],
      pages: [],
      currentComponentName: undefined,
      mode: 'design',
      persistedOpenedComponent: undefined,
    });
    expect(result).toBeNull();
  });

  it('skips auto-select in code mode', () => {
    const result = selectComponentToLoad({
      atoms,
      composites,
      pages,
      currentComponentName: undefined,
      mode: 'code',
      persistedOpenedComponent: undefined,
    });
    expect(result).toBeNull();
  });

  it('auto-selects when current component is an entry point', () => {
    const result = selectComponentToLoad({
      atoms,
      composites,
      pages,
      currentComponentName: 'index.tsx',
      mode: 'design',
      persistedOpenedComponent: undefined,
    });
    expect(result).toBe('src/Form.tsx');
  });

  it('does not auto-select when current component is a regular component', () => {
    const result = selectComponentToLoad({
      atoms,
      composites,
      pages,
      currentComponentName: 'Header',
      mode: 'design',
      persistedOpenedComponent: undefined,
    });
    expect(result).toBeNull();
  });
});
