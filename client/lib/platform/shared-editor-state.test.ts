import { describe, expect, test } from 'bun:test';
import type { SharedEditorState } from '../../../lib/types';
import { mergeInitState } from './shared-editor-state';

const baseState = (overrides: Partial<SharedEditorState> = {}): SharedEditorState => ({
  selectedIds: [],
  hoveredId: null,
  currentComponent: null,
  astStructure: null,
  canvasMode: 'single',
  engineMode: 'design',
  insertTargetId: null,
  ...overrides,
});

describe('mergeInitState', () => {
  test('empty incoming + non-empty local → keeps local selection', () => {
    const local = baseState({
      selectedIds: ['client/components/Foo.tsx:42:10'],
      selectedItemIndices: { 'client/components/Foo.tsx:42:10': 3 },
    });
    const incoming = baseState({
      selectedIds: [],
      currentComponent: { name: 'Foo', path: 'client/components/Foo.tsx' },
    });

    const merged = mergeInitState(incoming, local);

    // Selection preserved from local — this is the race-fix
    expect(merged.selectedIds).toEqual(['client/components/Foo.tsx:42:10']);
    expect(merged.selectedItemIndices).toEqual({
      'client/components/Foo.tsx:42:10': 3,
    });
    // Non-selection fields adopt the incoming snapshot
    expect(merged.currentComponent).toEqual({
      name: 'Foo',
      path: 'client/components/Foo.tsx',
    });
  });

  test('non-empty incoming overrides local selection', () => {
    // Authoritative selection from another panel (e.g. tree click) MUST win
    const local = baseState({
      selectedIds: ['client/components/Foo.tsx:42:10'],
    });
    const incoming = baseState({
      selectedIds: ['client/components/Bar.tsx:7:2'],
    });

    const merged = mergeInitState(incoming, local);

    expect(merged.selectedIds).toEqual(['client/components/Bar.tsx:7:2']);
  });

  test('empty incoming + empty local → stays empty (no fabricated selection)', () => {
    const local = baseState({ selectedIds: [] });
    const incoming = baseState({ selectedIds: [] });

    const merged = mergeInitState(incoming, local);

    expect(merged.selectedIds).toEqual([]);
  });

  test('empty incoming + non-empty local → other fields still come from incoming', () => {
    // Crucial: protecting selection must not roll back canvasMode, engineMode,
    // currentComponent, etc., to whatever the local store happened to hold.
    const local = baseState({
      selectedIds: ['client/components/Foo.tsx:42:10'],
      canvasMode: 'single',
      engineMode: 'design',
      currentComponent: { name: 'Old', path: 'client/components/Old.tsx' },
    });
    const incoming = baseState({
      selectedIds: [],
      canvasMode: 'multi',
      engineMode: 'interact',
      currentComponent: { name: 'New', path: 'client/components/New.tsx' },
    });

    const merged = mergeInitState(incoming, local);

    expect(merged.selectedIds).toEqual(['client/components/Foo.tsx:42:10']);
    expect(merged.canvasMode).toBe('multi');
    expect(merged.engineMode).toBe('interact');
    expect(merged.currentComponent).toEqual({
      name: 'New',
      path: 'client/components/New.tsx',
    });
  });

  test('non-empty incoming → selectedItemIndices come from incoming, not local', () => {
    const local = baseState({
      selectedIds: ['client/components/Foo.tsx:42:10'],
      selectedItemIndices: { 'client/components/Foo.tsx:42:10': 3 },
    });
    const incoming = baseState({
      selectedIds: ['client/components/Bar.tsx:7:2'],
      selectedItemIndices: { 'client/components/Bar.tsx:7:2': 0 },
    });

    const merged = mergeInitState(incoming, local);

    expect(merged.selectedIds).toEqual(['client/components/Bar.tsx:7:2']);
    expect(merged.selectedItemIndices).toEqual({
      'client/components/Bar.tsx:7:2': 0,
    });
  });
});
