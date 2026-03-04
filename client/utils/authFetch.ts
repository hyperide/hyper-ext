/**
 * Authenticated fetch utility
 * Adds Authorization header from auth store
 * Automatically refreshes token on 401 and retries the request
 */

import { useAuthStore } from '../stores/authStore';
import { NetworkError } from './networkError';
import { refreshTokenOnce } from './refreshToken';
import { isTokenExpiringSoon } from './tokenExpiry';

/**
 * Make an authenticated fetch request
 * Automatically adds Bearer token if available
 * On 401: refreshes token via refreshAuth() and retries once
 *
 * Uses refreshAuth() instead of low-level refreshTokenOnce() to properly
 * set sessionExpired/connectionError flags when refresh fails, allowing
 * ProtectedRoute to show appropriate UI ("Session Expired" instead of empty state)
 *
 * Short-circuits with NetworkError when connectionError is already true,
 * preventing cascade of doomed requests when the server is down.
 */
export async function authFetch(url: string, options: RequestInit = {}, _isRetry = false): Promise<Response> {
  const { accessToken, connectionError } = useAuthStore.getState();

  // Short-circuit: server is known to be down, don't waste a request.
  // connectionError stays true during retries (checkAuth uses its own internal fetch).
  // When checkAuth succeeds, it clears connectionError and this guard lifts.
  if (connectionError) {
    throw new NetworkError('Server connection lost');
  }

  // Proactive refresh: if token expires within 60s, refresh before the request.
  // refreshTokenOnce is a singleton — safe against concurrent calls.
  // On failure we silently proceed; the 401-retry fallback will handle it.
  if (!_isRetry && !url.includes('/api/auth/') && isTokenExpiringSoon(accessToken)) {
    try {
      await refreshTokenOnce();
    } catch {
      // refreshTokenOnce doesn't throw, but just in case
    }
  }

  // Re-read token: refreshTokenOnce updates the store via setAccessToken()
  const currentToken = useAuthStore.getState().accessToken;

  const headers: HeadersInit = {
    ...options.headers,
  };

  if (currentToken) {
    (headers as Record<string, string>).Authorization = `Bearer ${currentToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  // If 401 and not a retry and not an auth endpoint - try refresh
  if (response.status === 401 && !_isRetry && !url.includes('/api/auth/')) {
    await useAuthStore.getState().refreshAuth();

    const { accessToken: newToken, sessionExpired, connectionError } = useAuthStore.getState();

    // If session expired or connection error - don't retry, return original response
    // ProtectedRoute will show appropriate UI
    if (sessionExpired || connectionError) {
      return response;
    }

    // If we got a new token - retry the request
    if (newToken) {
      return authFetch(url, options, true);
    }
  }

  return response;
}

/**
 * Make an authenticated JSON POST request
 */
export async function authJsonPost<T>(url: string, data: unknown): Promise<T> {
  const response = await authFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Request failed: ${response.status}`);
  }

  return response.json();
}
