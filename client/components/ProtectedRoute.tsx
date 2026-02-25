import { useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 10000];

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const location = useLocation();
  const {
    isAuthenticated,
    isLoading,
    connectionError,
    connectionRetryCount,
    sessionExpired,
    _hasHydrated,
    retryConnection,
    resetConnectionRetries,
    clearSessionExpired,
  } = useAuthStore();
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Store the attempted URL for redirect after login
  useEffect(() => {
    if (_hasHydrated && !isLoading && !isAuthenticated && !connectionError) {
      sessionStorage.setItem('auth_redirect', location.pathname);
    }
  }, [_hasHydrated, isLoading, isAuthenticated, connectionError, location.pathname]);

  // Auto-retry connection with finite attempts + exponential backoff
  useEffect(() => {
    if (!connectionError) {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      return;
    }

    const handleOnline = () => {
      console.log('[Auth] Network online, resetting retries and reconnecting...');
      resetConnectionRetries();
      retryConnection();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[Auth] Page visible, resetting retries and reconnecting...');
        resetConnectionRetries();
        retryConnection();
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Schedule next retry if under limit
    if (connectionRetryCount < MAX_RETRIES) {
      const delay = RETRY_DELAYS[connectionRetryCount] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
      console.log(`[Auth] Scheduling retry ${connectionRetryCount + 1}/${MAX_RETRIES} in ${delay}ms`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      retryTimeoutRef.current = setTimeout(() => {
        if (navigator.onLine) {
          console.log(`[Auth] Retry attempt ${connectionRetryCount + 1}/${MAX_RETRIES}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
          retryConnection();
        }
      }, delay);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, [connectionError, connectionRetryCount, retryConnection, resetConnectionRetries]);

  // Show loading while Zustand is hydrating OR while auth check is in progress
  if (!_hasHydrated || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Connection error state - subtle banner in corner + content (not blocking)
  if (connectionError) {
    const exhausted = connectionRetryCount >= MAX_RETRIES;

    const handleManualRetry = () => {
      resetConnectionRetries();
      retryConnection();
    };

    return (
      <>
        <div className="fixed top-4 right-4 z-50 bg-slate-700 dark:bg-slate-600 text-slate-100 px-3 py-1.5 rounded-md text-xs flex items-center gap-2 shadow-lg">
          {!navigator.onLine ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>Offline</span>
            </>
          ) : exhausted ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
              <span>Server Unavailable</span>
              <button
                type="button"
                onClick={handleManualRetry}
                className="ml-1 px-1.5 py-0.5 bg-white/10 hover:bg-white/20 rounded text-xs transition-colors"
              >
                Retry
              </button>
            </>
          ) : (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>
                Reconnecting... ({connectionRetryCount}/{MAX_RETRIES})
              </span>
            </>
          )}
        </div>
        {children}
      </>
    );
  }

  // Session expired state - show message instead of silent redirect
  if (sessionExpired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
        <div className="text-center max-w-md px-4">
          <div className="text-4xl mb-4">⏰</div>
          <h2 className="text-xl font-semibold text-foreground mb-2">Session Expired</h2>
          <p className="text-muted-foreground mb-4">Your session has expired. Please login again to continue.</p>
          <button
            type="button"
            onClick={() => {
              clearSessionExpired();
              window.location.href = '/product';
            }}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/product" replace />;
  }

  return <>{children}</>;
}
