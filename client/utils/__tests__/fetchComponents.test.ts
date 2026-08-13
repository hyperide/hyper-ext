import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ComponentsAPIResponse } from '../fetchComponents';

// --- Mocks ---
// Mirror authFetch.test.ts: mock the auth store + globalThis.fetch so the shared
// fetch utility runs against a controllable transport.

const mockGetState = mock(() => ({
  accessToken: 'valid-token',
  connectionError: false,
  sessionExpired: false,
  refreshAuth: mock(() => Promise.resolve()),
  setAccessToken: mock(),
}));

mock.module('../../stores/authStore', () => ({
  useAuthStore: { getState: mockGetState },
}));

// Don't trigger proactive refresh — keep authFetch a thin passthrough to fetch.
mock.module('../refreshToken', () => ({
  refreshTokenOnce: mock(() => Promise.resolve({ ok: true, accessToken: 'valid-token' })),
}));
mock.module('../tokenExpiry', () => ({
  isTokenExpiringSoon: () => false,
}));

const originalFetch = globalThis.fetch;

/** Build a successful /api/get-components payload tagged with a project marker. */
function payloadFor(projectId: string): ComponentsAPIResponse {
  return {
    success: true,
    atomGroups: [{ dirPath: projectId, components: [{ name: projectId, path: `${projectId}.tsx` }] }],
    compositeGroups: [],
    pageGroups: [],
  };
}

let currentProject = 'A';
const mockFetch = mock(
  (_input: string | URL | Request, _init?: RequestInit): Promise<Response> =>
    Promise.resolve(new Response(JSON.stringify(payloadFor(currentProject)), { status: 200 })),
);
// @ts-expect-error — Bun's fetch has extra properties (preconnect) not present on Mock
globalThis.fetch = mockFetch;
afterAll(() => {
  globalThis.fetch = originalFetch;
});

// Import after mocks are set up
const { fetchComponentsJSON, cancelComponentsFetch } = await import('../fetchComponents');

/** The payload's project marker — stored in the first atom group's dirPath. */
function projectMarker(res: ComponentsAPIResponse): string | undefined {
  return res.atomGroups?.[0]?.dirPath;
}

describe('fetchComponentsJSON project-scoped cache', () => {
  beforeEach(() => {
    cancelComponentsFetch();
    mockFetch.mockClear();
    currentProject = 'A';
  });

  it('re-fetches when the active project changes within the TTL (no cancel)', async () => {
    // Project A active: caches A's payload.
    const a = await fetchComponentsJSON('project-a');
    expect(projectMarker(a)).toBe('A');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Switch to project B WITHOUT cancelComponentsFetch, still within the 2s TTL.
    currentProject = 'B';
    const b = await fetchComponentsJSON('project-b');

    // Must NOT serve project A's cached payload — the key changed.
    expect(projectMarker(b)).toBe('B');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('serves the cache for a same-project call within the TTL (no extra fetch)', async () => {
    const first = await fetchComponentsJSON('project-a');
    expect(projectMarker(first)).toBe('A');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Even if the transport would now return B, a same-project call within TTL
    // must hit the cache and return A without a second network call.
    currentProject = 'B';
    const second = await fetchComponentsJSON('project-a');
    expect(projectMarker(second)).toBe('A');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
