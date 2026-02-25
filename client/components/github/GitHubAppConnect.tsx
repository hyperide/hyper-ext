import { IconBrandGithub, IconCheck, IconExternalLink, IconLock } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useGitHubAppInstallations } from './hooks/useGitHubAppInstallations';

interface GitHubAppConnectProps {
  className?: string;
  variant?: 'banner' | 'compact';
}

/**
 * Component to prompt users to install the GitHub App for private repo access
 */
export function GitHubAppConnect({ className, variant = 'banner' }: GitHubAppConnectProps) {
  const { installations, loading, configured, getInstallUrl, refetch } = useGitHubAppInstallations();
  const [connecting, setConnecting] = useState(false);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const url = await getInstallUrl();
      if (url) {
        // Open GitHub App installation page in new tab
        window.open(url, '_blank');
      }
    } finally {
      setConnecting(false);
    }
  }, [getInstallUrl]);

  // Refetch installations when window regains focus (user may have completed installation)
  useEffect(() => {
    const handleFocus = () => {
      refetch();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refetch]);

  // Don't show if GitHub App is not configured on server
  if (!configured || loading) {
    return null;
  }

  // User already has installations - show compact status
  if (installations.length > 0) {
    if (variant === 'compact') {
      return (
        <div className={className}>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <IconCheck className="h-3 w-3 text-green-500" />
            GitHub App connected ({installations.length} account{installations.length > 1 ? 's' : ''})
          </span>
        </div>
      );
    }

    return (
      <Alert className={className}>
        <IconCheck className="h-4 w-4 text-green-500" />
        <AlertDescription className="flex items-center justify-between">
          <span>
            GitHub App connected to {installations.length} account{installations.length > 1 ? 's' : ''}. You can clone
            private repositories.
          </span>
          <Button variant="outline" size="sm" onClick={handleConnect}>
            <IconExternalLink className="mr-1 h-3 w-3" />
            Manage
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  // Prompt to connect
  if (variant === 'compact') {
    return (
      <Button variant="outline" size="sm" onClick={handleConnect} disabled={connecting} className={className}>
        <IconLock className="mr-1 h-3 w-3" />
        Connect for private repos
      </Button>
    );
  }

  return (
    <Alert className={className}>
      <IconBrandGithub className="h-4 w-4" />
      <AlertDescription className="flex items-center justify-between">
        <span>Connect the HyperIDE GitHub App to clone private repositories</span>
        <Button onClick={handleConnect} disabled={connecting} size="sm">
          <IconLock className="mr-1 h-3 w-3" />
          {connecting ? 'Connecting...' : 'Connect GitHub App'}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
