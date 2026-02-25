import { IconBrandGithub, IconBrandGoogle } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/stores/authStore';
import { authFetch } from '@/utils/authFetch';

export default function InviteAccept() {
  const navigate = useNavigate();
  const { token } = useParams<{ token: string }>();
  const { isAuthenticated, isLoading, accessToken, checkAuth } = useAuthStore();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Store invite token for after login
    if (token) {
      sessionStorage.setItem('pending_invite', token);
    }
  }, [token]);

  useEffect(() => {
    // If authenticated and have pending invite, accept it
    const acceptInvite = async () => {
      const pendingToken = sessionStorage.getItem('pending_invite');
      if (!isAuthenticated || !accessToken || !pendingToken || accepting) return;

      setAccepting(true);
      setError(null);

      try {
        const response = await authFetch(`/api/invites/${pendingToken}/accept`, {
          method: 'POST',
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to accept invite');
        }

        // Clear pending invite
        sessionStorage.removeItem('pending_invite');

        // Refresh auth to get new workspace
        await checkAuth();

        setSuccess(true);

        // Redirect to projects after short delay
        setTimeout(() => {
          navigate('/projects', { replace: true });
        }, 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to accept invite');
        sessionStorage.removeItem('pending_invite');
      } finally {
        setAccepting(false);
      }
    };

    if (isAuthenticated && accessToken) {
      acceptInvite();
    }
  }, [isAuthenticated, accessToken, accepting, navigate, checkAuth]);

  const handleLogin = () => {
    // Store redirect for after login
    sessionStorage.setItem('auth_redirect', `/invite/${token}`);
    const callbackUrl = `${window.location.origin}/auth/callback`;
    window.location.href = `/api/auth/github?redirect_uri=${encodeURIComponent(callbackUrl)}`;
  };

  const handleGoogleLogin = () => {
    sessionStorage.setItem('auth_redirect', `/invite/${token}`);
    const callbackUrl = `${window.location.origin}/auth/callback`;
    window.location.href = `/api/auth/google?redirect_uri=${encodeURIComponent(callbackUrl)}`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Workspace Invitation</CardTitle>
          <CardDescription>You have been invited to join a workspace</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="p-3 mb-4 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {success && (
            <div className="p-3 mb-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <p className="text-sm text-green-600">Successfully joined workspace! Redirecting...</p>
            </div>
          )}

          {accepting && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              <span className="ml-3 text-muted-foreground">Accepting invite...</span>
            </div>
          )}

          {!isAuthenticated && !accepting && !success && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Please sign in to accept this invitation.</p>
              <Button onClick={handleLogin} variant="outline" className="w-full">
                <IconBrandGithub className="w-4 h-4 mr-2" />
                Sign in with GitHub
              </Button>
              <Button onClick={handleGoogleLogin} variant="outline" className="w-full">
                <IconBrandGoogle className="w-4 h-4 mr-2" />
                Sign in with Google
              </Button>
            </div>
          )}

          {isAuthenticated && !accepting && !success && !error && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              <span className="ml-3 text-muted-foreground">Processing...</span>
            </div>
          )}

          {error && (
            <Button variant="outline" onClick={() => navigate('/projects')} className="w-full mt-4">
              Go to Projects
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
