import {
  IconAlertCircle,
  IconBrandGithub,
  IconBuilding,
  IconExternalLink,
  IconLock,
  IconRefresh,
  IconTrash,
  IconUser,
} from '@tabler/icons-react';
import { useCallback, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useGitHubAppInstallations } from './hooks/useGitHubAppInstallations';
import type { GitHubAppInstallation } from './types';

interface GitHubAppInstallationsProps {
  className?: string;
}

function InstallationCard({
  installation,
  onRemove,
}: {
  installation: GitHubAppInstallation;
  onRemove: (id: number) => Promise<void>;
}) {
  const [removing, setRemoving] = useState(false);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    try {
      await onRemove(installation.installationId);
    } finally {
      setRemoving(false);
    }
  }, [installation.installationId, onRemove]);

  const AccountIcon = installation.accountType === 'Organization' ? IconBuilding : IconUser;

  return (
    <Card className={installation.suspended ? 'opacity-60' : ''}>
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <AccountIcon className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{installation.accountLogin}</span>
              {installation.suspended && (
                <Badge variant="destructive" className="text-xs">
                  <IconAlertCircle className="mr-1 h-3 w-3" />
                  Suspended
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{installation.accountType}</span>
              <span>·</span>
              {installation.repositorySelection === 'all' ? (
                <span>All repositories</span>
              ) : (
                <span>{installation.repositoryCount ?? 0} selected repositories</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a
              href={`https://github.com/settings/installations/${installation.installationId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <IconExternalLink className="mr-1 h-3 w-3" />
              Manage on GitHub
            </a>
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" disabled={removing}>
                <IconTrash className="h-4 w-4 text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove installation?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove the connection to {installation.accountLogin} from HyperIDE. You can always reconnect
                  later by installing the GitHub App again. To completely uninstall the app, use GitHub's settings.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleRemove} disabled={removing}>
                  {removing ? 'Removing...' : 'Remove'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

export function GitHubAppInstallations({ className }: GitHubAppInstallationsProps) {
  const { installations, loading, error, configured, refetch, removeInstallation, getInstallUrl } =
    useGitHubAppInstallations();
  const [connecting, setConnecting] = useState(false);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const url = await getInstallUrl();
      if (url) {
        window.location.href = url;
      }
    } finally {
      setConnecting(false);
    }
  }, [getInstallUrl]);

  const handleRemove = useCallback(
    async (installationId: number) => {
      await removeInstallation(installationId);
    },
    [removeInstallation],
  );

  if (!configured) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconBrandGithub className="h-5 w-5" />
            GitHub App
          </CardTitle>
          <CardDescription>GitHub App integration is not configured on this server.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <IconBrandGithub className="h-5 w-5" />
              GitHub App Connections
            </CardTitle>
            <CardDescription>Connect the HyperIDE GitHub App to access private repositories</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={loading}>
              <IconRefresh className={`mr-1 h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button onClick={handleConnect} disabled={connecting}>
              <IconLock className="mr-1 h-4 w-4" />
              {connecting ? 'Connecting...' : 'Add Connection'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && installations.length === 0 ? (
          <>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        ) : error ? (
          <div className="text-center py-8 text-muted-foreground">
            <IconAlertCircle className="mx-auto h-8 w-8 mb-2" />
            <p>{error}</p>
          </div>
        ) : installations.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <IconBrandGithub className="mx-auto h-8 w-8 mb-2" />
            <p>No GitHub App connections yet</p>
            <p className="text-sm mt-1">
              Click "Add Connection" to install the GitHub App on your account or organization
            </p>
          </div>
        ) : (
          installations.map((installation) => (
            <InstallationCard key={installation.id} installation={installation} onRemove={handleRemove} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
