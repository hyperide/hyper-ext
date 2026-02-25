/**
 * Shared singleton for token refresh
 *
 * This module provides a single point of refresh to prevent race conditions
 * when multiple callers (authFetch, authStore) try to refresh simultaneously.
 *
 * Parallel refresh calls can race at the cookie layer (multiple Set-Cookie writes),
 * especially when old and new cookie variants coexist.
 * This singleton deduplicates concurrent calls so only one refresh request is in flight.
 */

import { useAuthStore } from '../stores/authStore';

export type RefreshResult = { ok: true; accessToken: string } | { ok: false; code: string; status: number };

// Singleton promise to deduplicate concurrent refresh calls
let refreshPromise: Promise<RefreshResult> | null = null;

/**
 * Refresh the access token using the refresh token cookie.
 * Uses singleton pattern to prevent multiple parallel refresh calls.
 *
 * IMPORTANT: No retry logic here. Retry + token rotation = anti-pattern.
 * If refresh fails due to network, caller should handle it appropriately.
 */
export async function refreshTokenOnce(): Promise<RefreshResult> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async (): Promise<RefreshResult> => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'ngrok-skip-browser-warning': 'true' },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const code = errorData.code || 'UNKNOWN';
        return { ok: false, code, status: response.status };
      }

      const data = await response.json();
      const accessToken = data.accessToken as string;

      // Centralized token update - all callers benefit
      useAuthStore.getState().setAccessToken(accessToken);

      return { ok: true, accessToken };
    } catch (error) {
      // Network error (fetch failed to connect)
      console.error('[refreshTokenOnce] Network error:', error);
      return { ok: false, code: 'NETWORK_ERROR', status: 0 };
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}
