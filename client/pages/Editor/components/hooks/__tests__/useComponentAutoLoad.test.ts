/**
 * Tests the exported pure functions that useComponentAutoLoad uses internally.
 * Covers the race-condition fix (HYP-224): server returning success: false
 * must NOT mark components as loaded, allowing retry on next event.
 */
import { describe, expect, it } from 'bun:test';
import {
  type ComponentInfo,
  flattenComponentGroups,
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
    });
  });

  it('handles missing groups gracefully', () => {
    const result = flattenComponentGroups({ success: true });
    expect(result).toEqual({ atoms: [], composites: [] });
  });

  it('handles empty groups', () => {
    const result = flattenComponentGroups({
      success: true,
      atomGroups: [],
      compositeGroups: [],
    });
    expect(result).toEqual({ atoms: [], composites: [] });
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

  it('restores persisted component when no current component', () => {
    const result = selectComponentToLoad({
      atoms,
      composites,
      currentComponentName: undefined,
      mode: 'design',
      persistedOpenedComponent: 'src/Button.tsx',
    });
    expect(result).toBe('src/Button.tsx');
  });

  it('ignores persisted component when current component exists', () => {
    const result = selectComponentToLoad({
      atoms,
      composites,
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
      currentComponentName: undefined,
      mode: 'design',
      persistedOpenedComponent: undefined,
    });
    expect(result).toBe('src/Button.tsx');
  });

  it('returns null when no components available', () => {
    const result = selectComponentToLoad({
      atoms: [],
      composites: [],
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
      currentComponentName: 'Header',
      mode: 'design',
      persistedOpenedComponent: undefined,
    });
    expect(result).toBeNull();
  });
});
