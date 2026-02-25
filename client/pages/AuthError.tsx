import { IconAlertCircle, IconArrowLeft } from '@tabler/icons-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Access was denied. You may have cancelled the authorization.',
  invalid_state: 'Invalid request. The authorization session expired or was tampered with.',
  auth_failed: 'Authentication failed. Please try again.',
  unexpected: 'An unexpected error occurred. Please try again later.',
  'Could not get email from GitHub':
    'Could not retrieve your email from GitHub. Please ensure your GitHub account has a verified email address.',
  'No authorization code received': 'GitHub did not provide an authorization code. Please try again.',
  'Invalid state parameter': 'The authorization session expired. Please try again.',
};

function getErrorMessage(error: string | null): string {
  if (!error) return 'An unknown error occurred.';
  return ERROR_MESSAGES[error] || error;
}

export default function AuthError() {
  useDocumentTitle('Authentication Error');
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');
  const errorMessage = getErrorMessage(error);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <IconAlertCircle className="w-6 h-6 text-destructive" />
          </div>
          <CardTitle className="text-2xl font-bold text-destructive">Authentication Failed</CardTitle>
          <CardDescription>We couldn't complete the sign-in process</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="p-4 rounded-md bg-destructive/10 text-destructive text-sm">{errorMessage}</div>

          {error === 'Could not get email from GitHub' && (
            <div className="p-4 rounded-md bg-muted text-sm text-muted-foreground">
              <p className="font-medium mb-2">How to fix this:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>
                  Go to{' '}
                  <a
                    href="https://github.com/settings/emails"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    GitHub Email Settings
                  </a>
                </li>
                <li>Add and verify an email address</li>
                <li>Try signing in again</li>
              </ol>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <Button asChild className="w-full">
              <Link to="/login">
                <IconArrowLeft className="w-4 h-4 mr-2" />
                Back to Login
              </Link>
            </Button>
          </div>

          {error && <p className="text-xs text-center text-muted-foreground">Error code: {error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
