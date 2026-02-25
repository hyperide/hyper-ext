import { IconBrandGithub } from '@tabler/icons-react';
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
// import { IconBrandGoogle } from '@tabler/icons-react'; // Hidden temporarily
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuthStore } from '@/stores/authStore';

export default function Login() {
  useDocumentTitle('Login');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, isLoading } = useAuthStore();

  const error = searchParams.get('error');
  const redirectTo = searchParams.get('redirect') || '/projects';

  // Redirect if already authenticated
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate(redirectTo, { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, redirectTo]);

  const handleGitHubLogin = () => {
    const callbackUrl = `${window.location.origin}/auth/callback`;
    window.location.href = `/api/auth/github?redirect_uri=${encodeURIComponent(callbackUrl)}`;
  };

  // Google login hidden temporarily - functionality preserved
  // const handleGoogleLogin = () => {
  // 	const callbackUrl = `${window.location.origin}/auth/callback`;
  // 	window.location.href = `/api/auth/google?redirect_uri=${encodeURIComponent(callbackUrl)}`;
  // };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
        <p className="text-lg text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Welcome to HyperIDE</CardTitle>
          <CardDescription>Sign in to access your projects and workspaces</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              {error === 'access_denied'
                ? 'Access was denied. Please try again.'
                : error === 'invalid_state'
                  ? 'Invalid request. Please try again.'
                  : `Authentication failed: ${error}`}
            </div>
          )}

          <Button onClick={handleGitHubLogin} variant="outline" className="w-full h-12 text-base">
            <IconBrandGithub className="w-5 h-5 mr-3" />
            Continue with GitHub
          </Button>

          {/* Google login hidden temporarily - functionality preserved
					<Button
						onClick={handleGoogleLogin}
						variant="outline"
						className="w-full h-12 text-base"
					>
						<IconBrandGoogle className="w-5 h-5 mr-3" />
						Continue with Google
					</Button>
					*/}

          <p className="text-xs text-center text-muted-foreground mt-6">
            By signing in, you agree to our Terms of Service and Privacy Policy
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
