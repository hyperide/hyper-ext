/**
 * Unit tests for pure helpers exported from usePreviewBridge.
 */

import { describe, expect, it } from 'bun:test';
import type { AppModeState, ComponentError } from '../usePreviewBridge';
import {
  applyAppRouteChanged,
  applyComponentRenderSucceeded,
  routeNavigationTelemetryProps,
} from '../usePreviewBridge';

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

describe('routeNavigationTelemetryProps', () => {
  it('reports path-segment depth, never the route string', () => {
    expect(routeNavigationTelemetryProps('/settings/profile')).toEqual({ routeDepth: 2, isHashRoute: false });
    expect(routeNavigationTelemetryProps('/')).toEqual({ routeDepth: 0, isHashRoute: false });
    expect(routeNavigationTelemetryProps('/dashboard')).toEqual({ routeDepth: 1, isHashRoute: false });
  });

  it('strips the query and reports the HASH fragment depth for hash routes', () => {
    // Hash router: the meaningful path lives inside the hash, so depth is counted
    // there. /#/users/5?token=secret → depth 2, hash flagged, query stripped.
    const props = routeNavigationTelemetryProps('/#/users/5?token=secret');
    expect(props.routeDepth).toBe(2);
    expect(props.isHashRoute).toBe(true);
  });

  it('flags a trailing-hash route and counts the leading path when the hash is empty', () => {
    const props = routeNavigationTelemetryProps('/orders/123#');
    expect(props.routeDepth).toBe(0); // nothing after '#'
    expect(props.isHashRoute).toBe(true);
  });

  it('does not leak any route content (PII-safe)', () => {
    const route = '/users/secret-id-9f3a?email=alex@example.com';
    const serialized = JSON.stringify(routeNavigationTelemetryProps(route));
    expect(serialized).not.toContain('secret-id');
    expect(serialized).not.toContain('alex@example.com');
    expect(serialized).not.toContain('users');
  });
});
