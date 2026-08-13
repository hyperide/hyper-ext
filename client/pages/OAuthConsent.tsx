import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/stores/authStore';
import { authFetch } from '@/utils/authFetch';

interface ConsentContext {
  clientId: string;
  clientName: string | null;
  isRegistered: boolean;
  scope: string;
  scopeDescription: string;
  projectName: string;
  workspaceName: string | null;
  redirectUriHost: string;
}

/** Read a non-httpOnly cookie by name (the double-submit CSRF token). */
function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

/**
 * OAuth consent screen (HYP-262 Phase 5). The /authorize endpoint stashes a single-use,
 * session-bound ticket and 302s here with ?ticket=…. We fetch the display context, then
 * Approve (mints a code) or Deny — the server returns the client redirect URL; we navigate.
 *
 * Public route: a user may land here unauthenticated (their session expired mid-flow). We
 * stash a return path and send them through the normal login, which resumes the flow.
 */
export default function OAuthConsent() {
  const [searchParams] = useSearchParams();
  const ticket = searchParams.get('ticket');
  const { isAuthenticated, isLoading } = useAuthStore();

  const [context, setContext] = useState<ConsentContext | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (!ticket) {
      setError('Missing consent ticket.');
      setLoadingInfo(false);
      return;
    }
    if (!isAuthenticated) {
      // Resume here after login. /authorize already stashed the validated request in an
      // httpOnly cookie, so the post-login resume rebuilds the flow regardless of this path.
      sessionStorage.setItem('auth_redirect', `/oauth/consent?ticket=${encodeURIComponent(ticket)}`);
      const callbackUrl = `${window.location.origin}/auth/callback`;
      window.location.href = `/api/auth/github?redirect_uri=${encodeURIComponent(callbackUrl)}`;
      return;
    }

    let cancelled = false;
    const loadContext = async () => {
      try {
        const res = await authFetch(`/api/oauth/consent/${encodeURIComponent(ticket)}`);
        if (cancelled) return;
        if (!res.ok) {
          setError('This authorization request is no longer valid. It may have expired or already been used.');
          return;
        }
        setContext((await res.json()) as ConsentContext);
      } catch {
        if (!cancelled) setError('Failed to load the authorization request.');
      } finally {
        if (!cancelled) setLoadingInfo(false);
      }
    };
    loadContext();
    return () => {
      cancelled = true;
    };
  }, [ticket, isAuthenticated, isLoading]);

  const decide = useCallback(
    async (action: 'approve' | 'deny') => {
      if (!ticket || submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const csrf = readCookie('oauth_consent_csrf');
        const res = await authFetch(`/api/oauth/consent/${encodeURIComponent(ticket)}/${action}`, {
          method: 'POST',
          headers: csrf ? { 'X-Consent-CSRF': csrf } : {},
        });
        if (!res.ok) {
          setError('This authorization request is no longer valid.');
          setSubmitting(false);
          return;
        }
        const data = (await res.json()) as { redirect?: string };
        if (data.redirect) {
          window.location.href = data.redirect;
          return;
        }
        setError('Unexpected response from the server.');
        setSubmitting(false);
      } catch {
        setError('Failed to submit your decision.');
        setSubmitting(false);
      }
    },
    [ticket, submitting],
  );

  if (isLoading || loadingInfo || (!isAuthenticated && !error)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const clientLabel = context?.clientName || context?.clientId || 'An application';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Authorize {clientLabel}</CardTitle>
          <CardDescription>{clientLabel} wants access to your project.</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="p-3 mb-4 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {context && !error && (
            <div className="space-y-4">
              <div className="text-sm">
                Project: <strong>{context.projectName}</strong>
                {context.workspaceName && (
                  <>
                    {' '}
                    in workspace <strong>{context.workspaceName}</strong>
                  </>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Requested access</p>
                <div className="flex items-start gap-2">
                  <Badge variant="secondary">{context.scope}</Badge>
                  <span className="text-sm text-muted-foreground">{context.scopeDescription}</span>
                </div>
              </div>

              {context.redirectUriHost && (
                <p className="text-xs text-muted-foreground">
                  After approval you will be redirected to <code>{context.redirectUriHost}</code>.
                </p>
              )}

              {!context.isRegistered && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    This application is not registered. Only approve if you started this request yourself.
                  </p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button variant="default" className="flex-1" disabled={submitting} onClick={() => decide('approve')}>
                  Approve
                </Button>
                <Button variant="outline" className="flex-1" disabled={submitting} onClick={() => decide('deny')}>
                  Deny
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
