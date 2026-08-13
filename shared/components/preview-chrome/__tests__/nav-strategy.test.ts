/**
 * @file Unit tests for the shared in-preview navigation-strategy helpers.
 *
 * These pin the prefix detection/stripping math that the basename strategy and the generated
 * history-bridge driver both depend on, and guard the default strategy + the strategy parser.
 */

import { describe, expect, it } from 'bun:test';
import {
  applyPreviewRoute,
  DEFAULT_NAV_STRATEGY,
  detectPreviewPrefix,
  NAV_STRATEGIES,
  parseNavStrategy,
  type PreviewNavWindow,
  stripPreviewPrefix,
} from '../nav-strategy';

/** A minimal PreviewNavWindow that records pushState calls and tracks location. */
function fakeNavWindow(
  pathname: string,
  search = '',
  prefix?: string,
  hash = '',
): PreviewNavWindow & { pushed: string[] } {
  const loc = { pathname, search, hash };
  const pushed: string[] = [];
  return {
    pushed,
    location: loc,
    history: {
      pushState: (_s: unknown, _t: string, url: string) => {
        pushed.push(url);
        // Reflect the (already prefixed, for basename) URL into location for follow-up comparisons.
        try {
          const u = new URL(url, 'http://localhost');
          loc.pathname = u.pathname;
          loc.search = u.search;
          loc.hash = u.hash;
        } catch {
          /* ignore */
        }
      },
    },
    dispatchEvent: () => true,
    __hyperPreviewProxyPrefix: prefix,
  } as PreviewNavWindow & { pushed: string[] };
}

describe('nav-strategy: defaults + parsing', () => {
  it('defaults to history-bridge (the recommended strategy)', () => {
    expect(DEFAULT_NAV_STRATEGY).toBe('history-bridge');
  });

  it('exposes exactly the three comparison strategies', () => {
    expect([...NAV_STRATEGIES].sort()).toEqual(['basename', 'history-bridge', 'src-swap']);
  });

  it('parseNavStrategy accepts known strategies and rejects everything else', () => {
    expect(parseNavStrategy('basename')).toBe('basename');
    expect(parseNavStrategy('history-bridge')).toBe('history-bridge');
    expect(parseNavStrategy('src-swap')).toBe('src-swap');
    expect(parseNavStrategy('bogus')).toBeNull();
    expect(parseNavStrategy('')).toBeNull();
    expect(parseNavStrategy(null)).toBeNull();
    expect(parseNavStrategy(undefined)).toBeNull();
  });
});

describe('nav-strategy: detectPreviewPrefix', () => {
  it('extracts the /project-preview/<id> prefix from a proxied pathname', () => {
    expect(detectPreviewPrefix('/project-preview/abc123/test-preview')).toBe('/project-preview/abc123');
  });

  it('handles a UUID-style id (hyphens + hex)', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    expect(detectPreviewPrefix(`/project-preview/${id}/settings`)).toBe(`/project-preview/${id}`);
  });

  it('returns empty string for a non-proxied pathname (the VS Code ext case)', () => {
    expect(detectPreviewPrefix('/test-preview')).toBe('');
    expect(detectPreviewPrefix('/')).toBe('');
    expect(detectPreviewPrefix('/settings')).toBe('');
  });
});

describe('nav-strategy: stripPreviewPrefix', () => {
  const PREFIX = '/project-preview/abc123';

  it('strips the prefix so a no-basename router can match', () => {
    expect(stripPreviewPrefix('/project-preview/abc123/settings', PREFIX)).toBe('/settings');
    expect(stripPreviewPrefix('/project-preview/abc123/users/42', PREFIX)).toBe('/users/42');
  });

  it('collapses a bare prefix to the root', () => {
    expect(stripPreviewPrefix('/project-preview/abc123', PREFIX)).toBe('/');
    expect(stripPreviewPrefix('/project-preview/abc123/', PREFIX)).toBe('/');
  });

  it('returns the path unchanged when it does not carry the prefix', () => {
    expect(stripPreviewPrefix('/settings', PREFIX)).toBe('/settings');
    expect(stripPreviewPrefix('/settings', '')).toBe('/settings');
  });

  it('is idempotent (stripping an already-stripped path is a no-op)', () => {
    const once = stripPreviewPrefix('/project-preview/abc123/dash', PREFIX);
    expect(stripPreviewPrefix(once, PREFIX)).toBe('/dash');
  });

  it('never returns an empty string', () => {
    expect(stripPreviewPrefix('', PREFIX)).toBe('/');
    expect(stripPreviewPrefix(PREFIX, PREFIX)).toBe('/');
  });
});

describe('nav-strategy: applyPreviewRoute basename branch honors location.search', () => {
  const PREFIX = '/project-preview/abc123';

  it('navigates when only the query changes (/settings?tab=1 → /settings is NOT a no-op)', () => {
    // location is the PREFIXED `/project-preview/abc123/settings?tab=1` (basename router).
    const win = fakeNavWindow(`${PREFIX}/settings`, '?tab=1', PREFIX);
    const navigated = applyPreviewRoute(win, '/settings', 'basename');
    expect(navigated).toBe(true); // the stale ?tab=1 must be cleared, not treated as already-current
    expect(win.pushed).toEqual(['/settings']);
  });

  it('is a no-op when path AND query already match', () => {
    const win = fakeNavWindow(`${PREFIX}/settings`, '?tab=1', PREFIX);
    const navigated = applyPreviewRoute(win, '/settings?tab=1', 'basename');
    expect(navigated).toBe(false);
    expect(win.pushed).toEqual([]);
  });

  it('navigates on a path change', () => {
    const win = fakeNavWindow(`${PREFIX}/`, '', PREFIX);
    expect(applyPreviewRoute(win, '/settings', 'basename')).toBe(true);
    expect(win.pushed).toEqual(['/settings']);
  });

  it('navigates when only the HASH changes (/settings#billing → /settings clears the hash)', () => {
    const win = fakeNavWindow(`${PREFIX}/settings`, '', PREFIX, '#billing');
    expect(applyPreviewRoute(win, '/settings', 'basename')).toBe(true); // not a no-op — clear #billing
    expect(win.pushed).toEqual(['/settings']);
  });

  it('is a no-op when path, query AND hash all match', () => {
    const win = fakeNavWindow(`${PREFIX}/settings`, '?tab=1', PREFIX, '#billing');
    expect(applyPreviewRoute(win, '/settings?tab=1#billing', 'basename')).toBe(false);
    expect(win.pushed).toEqual([]);
  });
});
