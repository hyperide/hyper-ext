import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { refreshTokenOnce } from '../utils/refreshToken';

type RefreshError = { ok: false; code: string; status: number };

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  theme: 'light' | 'dark' | 'system' | null;
  emailVerifiedAt: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
}

interface AuthState {
  user: User | null;
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  accessToken: string | null;
  connectionError: boolean;
  connectionRetryCount: number;
  sessionExpired: boolean;
  _hasHydrated: boolean;
  _isRetrying: boolean;

  // Actions
  setUser: (user: User | null) => void;
  setWorkspaces: (workspaces: Workspace[]) => void;
  setCurrentWorkspace: (workspace: Workspace | null) => void;
  setLoading: (loading: boolean) => void;
  setAccessToken: (token: string | null) => void;
  setHasHydrated: (value: boolean) => void;
  clearConnectionError: () => void;
  clearSessionExpired: () => void;
  resetConnectionRetries: () => void;
  retryConnection: () => Promise<void>;
  updateTheme: (theme: 'light' | 'dark' | 'system') => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  checkAuth: (options?: { isRetry?: boolean }) => Promise<boolean>;
}

const CURRENT_WORKSPACE_KEY = 'hypercanvas_current_workspace';
const HAS_LOGGED_IN_KEY = 'hypercanvas_has_logged_in';

// Retry helper with exponential backoff for network resilience
// Used ONLY for idempotent GET requests (/me, /workspaces), NOT for token refresh
const fetchWithRetry = async (url: string, options: RequestInit, retries = 3): Promise<Response> => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (error) {
      console.log(`[Auth] Fetch attempt ${i + 1}/${retries} failed:`, error); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      if (i === retries - 1) throw error;
      // Exponential backoff: 500ms, 1000ms, 2000ms
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  // TypeScript: this line is unreachable but needed for type safety
  throw new Error('Fetch failed after retries');
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      workspaces: [],
      currentWorkspace: null,
      isLoading: true,
      isAuthenticated: false,
      accessToken: null,
      connectionError: false,
      connectionRetryCount: 0,
      sessionExpired: false,
      _hasHydrated: false,
      _isRetrying: false,

      setUser: (user) => {
        set({ user, isAuthenticated: !!user });
      },

      setAccessToken: (token) => {
        set({ accessToken: token });
      },

      setHasHydrated: (value) => {
        set({ _hasHydrated: value });
      },

      setWorkspaces: (workspaces) => {
        set({ workspaces });

        // Auto-select workspace if none selected
        const current = get().currentWorkspace;
        if (!current && workspaces.length > 0) {
          // Try to restore from localStorage
          const savedSlug = localStorage.getItem(CURRENT_WORKSPACE_KEY);
          const savedWorkspace = savedSlug ? workspaces.find((w) => w.slug === savedSlug) : null;

          set({ currentWorkspace: savedWorkspace || workspaces[0] });
        }
      },

      setCurrentWorkspace: (workspace) => {
        set({ currentWorkspace: workspace });
        if (workspace) {
          localStorage.setItem(CURRENT_WORKSPACE_KEY, workspace.slug);
        } else {
          localStorage.removeItem(CURRENT_WORKSPACE_KEY);
        }
      },

      setLoading: (loading) => {
        set({ isLoading: loading });
      },

      clearConnectionError: () => {
        set({ connectionError: false });
      },

      clearSessionExpired: () => {
        set({ sessionExpired: false });
      },

      resetConnectionRetries: () => {
        set({ connectionRetryCount: 0 });
      },

      retryConnection: async () => {
        if (get()._isRetrying) return;
        set((s) => ({
          _isRetrying: true,
          connectionRetryCount: s.connectionRetryCount + 1,
        }));
        try {
          await get().checkAuth({ isRetry: true });
        } finally {
          set({ _isRetrying: false });
        }
      },

      updateTheme: async (theme) => {
        const token = get().accessToken;

        // Update local state immediately
        set((state) => ({
          user: state.user ? { ...state.user, theme } : null,
        }));

        // Persist to database
        try {
          await fetch('/api/user/profile', {
            method: 'PATCH',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'ngrok-skip-browser-warning': 'true',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ theme }),
          });
        } catch (error) {
          console.error('[Auth] Failed to update theme:', error);
        }
      },

      logout: async () => {
        try {
          await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include',
            headers: { 'ngrok-skip-browser-warning': 'true' },
          });
        } catch (error) {
          console.error('[Auth] Logout failed:', error);
        }

        set({
          user: null,
          workspaces: [],
          currentWorkspace: null,
          isAuthenticated: false,
          accessToken: null,
          connectionError: false,
          sessionExpired: false,
        });
        localStorage.removeItem(CURRENT_WORKSPACE_KEY);
        localStorage.removeItem(HAS_LOGGED_IN_KEY);
      },

      refreshAuth: async () => {
        const wasLoggedIn = localStorage.getItem(HAS_LOGGED_IN_KEY);

        const refreshResult = await refreshTokenOnce();

        if (refreshResult.ok) {
          // Token already set by refreshTokenOnce via setAccessToken
          return;
        }

        const result = refreshResult as RefreshError;
        console.log('[Auth refreshAuth] Refresh failed with status:', result.status, 'code:', result.code);

        // Network error or server error (502, 503, etc.) — server is down, not an auth issue
        const isNetworkOrServerError = result.code === 'NETWORK_ERROR' || result.status >= 500;

        if (isNetworkOrServerError && wasLoggedIn) {
          console.log('[Auth refreshAuth] Soft error (network/server down), setting connectionError');
          set({ connectionError: true });
          return;
        }

        // Hard errors - session is truly invalid
        // TOKEN_INVALID, TOKEN_NOT_FOUND, TOKEN_REVOKED, TOKEN_EXPIRED, USER_NOT_FOUND
        // Show sessionExpired if we had a refresh token cookie (even if wasLoggedIn is false)
        // NO_REFRESH_TOKEN means no cookie at all — user never logged in
        const isHardAuthError = result.code !== 'NO_REFRESH_TOKEN';

        if (isHardAuthError) {
          console.log('[Auth refreshAuth] Hard auth error, session expired');
          set({
            user: null,
            workspaces: [],
            currentWorkspace: null,
            isAuthenticated: false,
            accessToken: null,
            sessionExpired: true,
          });
          localStorage.removeItem(HAS_LOGGED_IN_KEY);
          return;
        }

        // NO_REFRESH_TOKEN - user never logged in, just clear state silently
        set({
          user: null,
          workspaces: [],
          currentWorkspace: null,
          isAuthenticated: false,
          accessToken: null,
        });
      },

      checkAuth: async (options?: { isRetry?: boolean }) => {
        if (!options?.isRetry) {
          set({ isLoading: true, connectionError: false });
        }

        try {
          let token = get().accessToken;
          const wasLoggedIn = localStorage.getItem(HAS_LOGGED_IN_KEY);
          console.log('[Auth checkAuth] Starting, token exists:', !!token, ', wasLoggedIn:', !!wasLoggedIn);

          // If was logged in before but no token in memory - try refresh first
          if (wasLoggedIn && !token) {
            console.log('[Auth checkAuth] Was logged in but no token, trying refresh first...');

            const preRefreshResult = await refreshTokenOnce();

            if (preRefreshResult.ok) {
              console.log('[Auth checkAuth] Pre-refresh success, got token');
              token = preRefreshResult.accessToken;
              // Token already set by refreshTokenOnce
            } else {
              const failedRefresh = preRefreshResult as RefreshError;
              console.log('[Auth checkAuth] Pre-refresh failed with code:', failedRefresh.code);

              // Network error or server errors (502, 503) — server is down, fall through to /me call
              const isNetworkOrServerError = failedRefresh.code === 'NETWORK_ERROR' || failedRefresh.status >= 500;

              if (!isNetworkOrServerError) {
                // Hard error: NO_REFRESH_TOKEN, TOKEN_INVALID, TOKEN_REVOKED, TOKEN_EXPIRED, USER_NOT_FOUND
                set({
                  user: null,
                  workspaces: [],
                  currentWorkspace: null,
                  isAuthenticated: false,
                  accessToken: null,
                  isLoading: false,
                  connectionError: false,
                  sessionExpired: true,
                });
                localStorage.removeItem(HAS_LOGGED_IN_KEY);
                return false;
              }

              console.log('[Auth checkAuth] Soft error (network/server down), falling through to /me');
            }
          }

          // Helper to make authenticated requests with retry (for idempotent GET requests)
          const authFetch = async (url: string, options: RequestInit = {}) => {
            const headers: HeadersInit = {
              'ngrok-skip-browser-warning': 'true',
              ...options.headers,
            };
            if (token) {
              (headers as Record<string, string>).Authorization = `Bearer ${token}`;
            }
            console.log('[Auth checkAuth] authFetch', url, 'with token:', !!token);
            return fetchWithRetry(url, { ...options, headers, credentials: 'include' });
          };

          // Get current user
          let userResponse = await authFetch('/api/auth/me');
          console.log('[Auth checkAuth] /me response:', userResponse.status);

          if (!userResponse.ok && userResponse.status === 401) {
            console.log('[Auth checkAuth] Got 401, trying refresh...');

            // Use shared singleton for refresh (no retry - retry + rotation = anti-pattern)
            const retryRefreshResult = await refreshTokenOnce();
            console.log(
              '[Auth checkAuth] /refresh result:',
              retryRefreshResult.ok ? 'ok' : (retryRefreshResult as RefreshError).code,
            );

            if (retryRefreshResult.ok) {
              console.log('[Auth checkAuth] Refresh success, got token');
              token = retryRefreshResult.accessToken;
              // Token already set by refreshTokenOnce

              // Retry getting user with new token
              console.log('[Auth checkAuth] Retrying /me with new token...');
              userResponse = await authFetch('/api/auth/me');
              console.log('[Auth checkAuth] /me retry response:', userResponse.status);
            } else {
              const failedRetry = retryRefreshResult as RefreshError;
              console.log(
                '[Auth checkAuth] Refresh failed with code:',
                failedRetry.code,
                ', wasLoggedIn:',
                !!wasLoggedIn,
              );

              const isNetworkOrServerError = failedRetry.code === 'NETWORK_ERROR' || failedRetry.status >= 500;

              if (wasLoggedIn && isNetworkOrServerError) {
                // Network/server error — transient issue, show reconnecting UI
                console.log(
                  '[Auth checkAuth] Soft error on 401-refresh (network/server down), setting connectionError',
                );
                set({ isLoading: false, connectionError: true });
                return false;
              }

              // Hard error: TOKEN_INVALID, TOKEN_REVOKED, TOKEN_EXPIRED, USER_NOT_FOUND
              // Show sessionExpired if we actually tried to refresh (had a cookie)
              // NO_REFRESH_TOKEN means user never logged in — don't show sessionExpired
              const isHardAuthError = !isNetworkOrServerError && failedRetry.code !== 'NO_REFRESH_TOKEN';

              if (isHardAuthError) {
                console.log('[Auth checkAuth] Hard auth error, setting sessionExpired');
                set({
                  user: null,
                  workspaces: [],
                  currentWorkspace: null,
                  isAuthenticated: false,
                  accessToken: null,
                  isLoading: false,
                  connectionError: false,
                  sessionExpired: true,
                });
                localStorage.removeItem(HAS_LOGGED_IN_KEY);
                return false;
              }
            }
          }

          if (!userResponse.ok) {
            throw new Error('Auth check failed');
          }

          const userData = await userResponse.json();
          set({ user: userData.user, isAuthenticated: true, connectionError: false, connectionRetryCount: 0 });
          localStorage.setItem(HAS_LOGGED_IN_KEY, 'true');

          // Get workspaces
          const workspacesResponse = await authFetch('/api/workspaces');

          if (workspacesResponse.ok) {
            const workspacesData = await workspacesResponse.json();
            get().setWorkspaces(workspacesData.workspaces || []);
          }

          set({ isLoading: false });
          return true;
        } catch (error) {
          console.error('[Auth] Check failed:', error);

          const wasLoggedIn = localStorage.getItem(HAS_LOGGED_IN_KEY);

          if (wasLoggedIn) {
            // Auth failures arrive as HTTP responses (handled above), not thrown errors.
            // If something threw after retries — it's a connectivity issue.
            console.log('[Auth] Error thrown for logged-in user, treating as connectivity issue');
            set({
              isLoading: false,
              connectionError: true,
            });
            return false;
          }

          // Never logged in — clear state silently
          set({
            user: null,
            workspaces: [],
            currentWorkspace: null,
            isAuthenticated: false,
            accessToken: null,
            isLoading: false,
            connectionError: false,
          });
          return false;
        }
      },
    }),
    {
      name: 'hypercanvas-auth',
      storage: createJSONStorage(() => sessionStorage),
      // Only persist accessToken - other state is loaded from server
      partialize: (state) => ({ accessToken: state.accessToken }),
      onRehydrateStorage: () => (state) => {
        // Called after hydration completes - accessToken is now available from sessionStorage
        state?.setHasHydrated(true);
      },
    },
  ),
);
