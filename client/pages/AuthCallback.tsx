import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const { checkAuth, setAccessToken } = useAuthStore();

  useEffect(() => {
    const handleCallback = async () => {
      const errorParam = searchParams.get('error');
      if (errorParam) {
        setError(errorParam);
        setTimeout(() => {
          navigate(`/login?error=${encodeURIComponent(errorParam)}`, { replace: true });
        }, 2000);
        return;
      }

      // Read access token from URL hash fragment (e.g., #access_token=xxx&is_new_user=false)
      const hash = window.location.hash.slice(1); // Remove leading #
      const hashParams = new URLSearchParams(hash);
      const accessToken = hashParams.get('access_token');

      if (accessToken) {
        // Store the access token
        setAccessToken(accessToken);
        // Clear the hash from URL for security
        window.history.replaceState(null, '', window.location.pathname);
      }

      // Verify auth state
      try {
        const success = await checkAuth();

        if (success) {
          // Redirect to projects page (or stored redirect)
          const redirectTo = sessionStorage.getItem('auth_redirect') || '/projects';
          sessionStorage.removeItem('auth_redirect');
          navigate(redirectTo, { replace: true });
        } else {
          setError('Authentication failed');
          setTimeout(() => {
            navigate('/login?error=auth_failed', { replace: true });
          }, 2000);
        }
      } catch (err) {
        console.error('[AuthCallback] Error:', err);
        setError('An unexpected error occurred');
        setTimeout(() => {
          navigate('/login?error=unexpected', { replace: true });
        }, 2000);
      }
    };

    handleCallback();
  }, [searchParams, navigate, checkAuth, setAccessToken]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="text-center">
        {error ? (
          <>
            <p className="text-lg text-destructive mb-2">Authentication failed</p>
            <p className="text-sm text-muted-foreground">{error}</p>
            <p className="text-sm text-muted-foreground mt-2">Redirecting to login...</p>
          </>
        ) : (
          <>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
            <p className="text-lg text-muted-foreground">Completing sign in...</p>
          </>
        )}
      </div>
    </div>
  );
}
