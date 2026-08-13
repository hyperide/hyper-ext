/**
 * Unit tests for pure helpers exported from usePreviewBridge.
 */

import { describe, expect, it } from 'bun:test';
import type { AppModeState, ComponentError } from '../usePreviewBridge';
import { applyAppRouteChanged, applyComponentRenderSucceeded } from '../usePreviewBridge';

const makeAppMode = (currentRoute: string): AppModeState => ({
  entryPath: 'src/App.tsx',
  routeSuggestions: [],
  currentRoute,
});

const makeError = (componentPath: string, errorSeq = 1): ComponentError => ({
  componentPath,
  error: 'Test error',
  errorSeq,
});

describe('applyComponentRenderSucceeded', () => {
  it('clears error when componentPath matches', () => {
    const err = makeError('src/components/Menubar.tsx');
    expect(applyComponentRenderSucceeded(err, 'src/components/Menubar.tsx')).toBeNull();
  });

  it('keeps error when componentPath does not match', () => {
    const err = makeError('src/components/Menubar.tsx');
    const result = applyComponentRenderSucceeded(err, 'src/components/Button.tsx');
    expect(result).toBe(err);
  });

  it('returns null when prev is already null', () => {
    expect(applyComponentRenderSucceeded(null, 'src/components/Menubar.tsx')).toBeNull();
  });
});

describe('applyAppRouteChanged', () => {
  it('reflects an in-app navigation route into the address-bar state', () => {
    const prev = makeAppMode('/');
    const next = applyAppRouteChanged(prev, '/settings');
    expect(next).not.toBe(prev);
    expect(next?.currentRoute).toBe('/settings');
    // Other fields are preserved.
    expect(next?.entryPath).toBe('src/App.tsx');
  });

  it('is a no-op (same reference) when the route already matches — no needless re-render', () => {
    const prev = makeAppMode('/settings');
    expect(applyAppRouteChanged(prev, '/settings')).toBe(prev);
  });

  it('stays null when app-mode is off — never resurrects a closed session', () => {
    expect(applyAppRouteChanged(null, '/settings')).toBeNull();
  });

  it('rejects a non-route payload (iframe project code cannot poison the address bar)', () => {
    const prev = makeAppMode('/');
    // Not slash-rooted → ignored (the previewed app could post anything).
    expect(applyAppRouteChanged(prev, 'javascript:alert(1)')).toBe(prev);
    expect(applyAppRouteChanged(prev, 'settings')).toBe(prev);
    expect(applyAppRouteChanged(prev, '')).toBe(prev);
  });
});
