import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { ConnectionStatus } from './ConnectionStatus';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const location = useLocation();
  const { isAuthenticated, isLoading, connectionError, sessionExpired, _hasHydrated, clearSessionExpired } =
    useAuthStore();
  // Store the attempted URL for redirect after login
  useEffect(() => {
    if (_hasHydrated && !isLoading && !isAuthenticated && !connectionError) {
      sessionStorage.setItem('auth_redirect', location.pathname);
    }
  }, [_hasHydrated, isLoading, isAuthenticated, connectionError, location.pathname]);

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

  // connectionError = server unreachable for a previously-logged-in user — keep rendering
  if (!isAuthenticated && !connectionError) {
    return <Navigate to="/product" replace />;
  }

  return (
    <>
      <div className="fixed top-4 z-50" style={{ right: 'calc(var(--right-sidebar-width, 0px) + 1rem)' }}>
        <ConnectionStatus />
      </div>
      {children}
    </>
  );
}
