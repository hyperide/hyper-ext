import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { RefreshResult } from '../refreshToken';

// --- Mocks ---
// NOTE: Do NOT mock tokenExpiry — mock.module is global in bun and would poison
// tokenExpiry.test.ts. Instead, use real JWT tokens with specific exp values.

const mockRefreshAuth = mock(() => Promise.resolve());

const mockGetState = mock(() => ({
  accessToken: 'valid-token',
  connectionError: false,
  sessionExpired: false,
  refreshAuth: mockRefreshAuth,
  setAccessToken: mock(),
}));

mock.module('../../stores/authStore', () => ({
  useAuthStore: { getState: mockGetState },
}));

const mockRefreshTokenOnce = mock(
  (): Promise<RefreshResult> => Promise.resolve({ ok: true, accessToken: 'new-token' }),
);
mock.module('../refreshToken', () => ({
  refreshTokenOnce: mockRefreshTokenOnce,
}));

// Don't mock networkError — let it use the real one
// Don't mock tokenExpiry — use real JWT tokens to control behavior

const originalFetch = globalThis.fetch;
const mockFetch = mock(
  (_input: string | URL | Request, _init?: RequestInit): Promise<Response> =>
    Promise.resolve(new Response('ok', { status: 200 })),
);
// @ts-expect-error — Bun's fetch has extra properties (preconnect) not present on Mock
globalThis.fetch = mockFetch;
afterAll(() => {
  globalThis.fetch = originalFetch;
});

// Import after mocks are set up
const { authFetch } = await import('../authFetch');

// --- Helpers ---

function buildJwt(secondsFromNow: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256' }));
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow }));
  return `${header}.${payload}.sig`;
}

function setStoreState(overrides: Record<string, unknown> = {}) {
  mockGetState.mockReturnValue({
    accessToken: buildJwt(600), // 10 minutes — fresh by default
    connectionError: false,
    sessionExpired: false,
    refreshAuth: mockRefreshAuth,
    setAccessToken: mock(),
    ...overrides,
  } as ReturnType<typeof mockGetState>);
}

function getLastFetchHeaders(): Record<string, string> {
  const lastCall = mockFetch.mock.lastCall;
  if (!lastCall) throw new Error('fetch was not called');
  return (lastCall[1] as RequestInit).headers as Record<string, string>;
}

// --- Tests ---

describe('authFetch proactive refresh', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockReturnValue(Promise.resolve(new Response('ok', { status: 200 })));
    mockRefreshTokenOnce.mockReset();
    mockRefreshTokenOnce.mockReturnValue(Promise.resolve({ ok: true, accessToken: 'new-token' }));
    mockRefreshAuth.mockReset();
    mockRefreshAuth.mockReturnValue(Promise.resolve());
    setStoreState();
  });

  it('triggers proactive refresh when token is expiring soon', async () => {
    const expiringToken = buildJwt(30); // Expires in 30s — within 60s threshold
    const freshToken = buildJwt(900);

    let callCount = 0;
    mockGetState.mockImplementation(() => {
      callCount++;
      return {
        accessToken: callCount <= 1 ? expiringToken : freshToken,
        connectionError: false,
        sessionExpired: false,
        refreshAuth: mockRefreshAuth,
        setAccessToken: mock(),
      } as ReturnType<typeof mockGetState>;
    });

    await authFetch('/api/projects');

    expect(mockRefreshTokenOnce).toHaveBeenCalledTimes(1);
    expect(getLastFetchHeaders().Authorization).toBe(`Bearer ${freshToken}`);
  });

  it('skips proactive refresh when token is fresh', async () => {
    setStoreState({ accessToken: buildJwt(600) }); // 10 minutes left

    await authFetch('/api/projects');

    expect(mockRefreshTokenOnce).not.toHaveBeenCalled();
  });

  it('skips proactive refresh for auth endpoints', async () => {
    setStoreState({ accessToken: buildJwt(30) }); // Expiring

    await authFetch('/api/auth/refresh');

    expect(mockRefreshTokenOnce).not.toHaveBeenCalled();
  });

  it('skips proactive refresh on retry', async () => {
    setStoreState({ accessToken: buildJwt(30) }); // Expiring

    await authFetch('/api/projects', {}, true);

    expect(mockRefreshTokenOnce).not.toHaveBeenCalled();
  });

  it('proceeds normally when proactive refresh fails', async () => {
    setStoreState({ accessToken: buildJwt(30) }); // Expiring
    mockRefreshTokenOnce.mockReturnValue(Promise.resolve({ ok: false, code: 'NETWORK_ERROR', status: 0 }));

    const response = await authFetch('/api/projects');

    expect(response.status).toBe(200);
    expect(mockRefreshTokenOnce).toHaveBeenCalledTimes(1);
  });

  it('uses refreshed token from store after proactive refresh', async () => {
    const expiringToken = buildJwt(10);
    const freshToken = buildJwt(900);

    let callCount = 0;
    mockGetState.mockImplementation(() => {
      callCount++;
      const token = callCount <= 1 ? expiringToken : freshToken;
      return {
        accessToken: token,
        connectionError: false,
        sessionExpired: false,
        refreshAuth: mockRefreshAuth,
        setAccessToken: mock(),
      } as ReturnType<typeof mockGetState>;
    });

    await authFetch('/api/projects');

    expect(getLastFetchHeaders().Authorization).toBe(`Bearer ${freshToken}`);
  });
});
