import {
  IconBrandGit,
  IconBrandGithub,
  IconDots,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSelector,
  IconSettings,
  IconSparkles,
} from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { GitHubAppConnect } from '@/components/github';
import { NetworkStatusIndicator } from '@/components/NetworkStatusIndicator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuthStore } from '@/stores/authStore';
import { useIsOnline, useOnReconnect } from '@/stores/networkStore';
import { authFetch } from '@/utils/authFetch';
import { isNetworkError } from '@/utils/networkError';
import {
  GitHubRepoModal,
  type GitHubRepository,
  useGitHubAppInstallations,
  useGitHubRepositories,
} from '../components/github';
import ProjectCreationAIChat from '../components/ProjectCreationAIChat';

interface Project {
  id: string;
  name: string;
  path: string;
  devCommand: string;
  installCommand: string;
  port: number;
  internalPort: number;
  framework: string;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun';
  status: 'stopped' | 'building' | 'running' | 'error';
  createdAt: number;
  updatedAt: number;
  githubRepoUrl: string | null;
  creationStatus: 'idle' | 'initializing' | 'generating' | 'committing' | 'completed' | 'failed' | 'cancelled';
  creationError: string | null;
}

type Framework = 'vite' | 'next' | 'remix' | 'cra' | 'bun';
type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

const FRAMEWORK_DEFAULTS: Record<Framework, { devScript: string; internalPort: number }> = {
  vite: { devScript: 'dev', internalPort: 5173 },
  next: { devScript: 'dev', internalPort: 3000 },
  remix: { devScript: 'dev', internalPort: 5173 },
  cra: { devScript: 'start', internalPort: 3000 },
  bun: { devScript: 'dev', internalPort: 8080 },
};

/**
 * Get default commands for a given framework and package manager
 */
const getDefaultCommands = (framework: Framework, pm: PackageManager) => {
  const { devScript } = FRAMEWORK_DEFAULTS[framework];
  const devCommand = `${pm} ${devScript === 'start' ? devScript : `run ${devScript}`}`;
  const installCommand = `${pm} install`;
  return { devCommand, installCommand };
};

/**
 * Check if current commands match default commands for any package manager
 */
const areCommandsDefault = (
  currentDevCommand: string,
  currentInstallCommand: string,
  framework: Framework,
): boolean => {
  const packageManagers: PackageManager[] = ['npm', 'yarn', 'pnpm', 'bun'];
  return packageManagers.some((pm) => {
    const defaults = getDefaultCommands(framework, pm);
    return defaults.devCommand === currentDevCommand && defaults.installCommand === currentInstallCommand;
  });
};

export default function Projects() {
  useDocumentTitle('Projects');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentWorkspace, workspaces, setCurrentWorkspace, accessToken, refreshAuth, connectionError } =
    useAuthStore();
  const [workspaceSelectorOpen, setWorkspaceSelectorOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGitClone, setShowGitClone] = useState(false);
  const [gitUrl, setGitUrl] = useState('');
  const [projectName, setProjectName] = useState('');
  const [framework, setFramework] = useState<Framework>('vite');
  const [packageManager, setPackageManager] = useState<PackageManager>('npm');
  const [devCommand, setDevCommand] = useState('npm run dev');
  const [installCommand, setInstallCommand] = useState('npm install');
  const [internalPort, setInternalPort] = useState('5173');
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [showCreateSidebar, setShowCreateSidebar] = useState(false);
  const [showGitHubModal, setShowGitHubModal] = useState(false);
  const [continueProject, setContinueProject] = useState<Project | null>(null);
  const [gitUrlPopoverOpen, setGitUrlPopoverOpen] = useState(false);
  const gitUrlInputRef = useRef<HTMLInputElement>(null);

  // Fetch GitHub repositories for the clone dropdown
  const { repositories: githubRepos } = useGitHubRepositories({
    enabled: showGitClone,
  });

  // Auto-open dropdown when repos load and input is focused but empty
  useEffect(() => {
    if (githubRepos.length > 0 && gitUrl === '' && document.activeElement === gitUrlInputRef.current) {
      setGitUrlPopoverOpen(true);
    }
  }, [githubRepos.length, gitUrl]);

  // Open sidebar when continuing a project
  useEffect(() => {
    if (continueProject) {
      setShowCreateSidebar(true);
    }
  }, [continueProject]);

  // GitHub App installation URL
  const { getInstallUrl } = useGitHubAppInstallations();
  const handleConnectGitHubApp = useCallback(async () => {
    const url = await getInstallUrl();
    if (url) {
      window.open(url, '_blank');
    }
  }, [getInstallUrl]);

  /**
   * Update dev command, install command and internal port when framework changes
   */
  const handleFrameworkChange = (newFramework: Framework) => {
    setFramework(newFramework);
    const { devCommand: newDevCommand, installCommand: newInstallCommand } = getDefaultCommands(
      newFramework,
      packageManager,
    );
    const { internalPort: newInternalPort } = FRAMEWORK_DEFAULTS[newFramework];
    setDevCommand(newDevCommand);
    setInstallCommand(newInstallCommand);
    setInternalPort(newInternalPort.toString());
  };

  /**
   * Update install and dev commands when package manager changes,
   * but only if current commands are default (not customized by user)
   */
  const handlePackageManagerChange = (newPackageManager: PackageManager) => {
    setPackageManager(newPackageManager);

    // Only update commands if they match defaults for any package manager
    if (areCommandsDefault(devCommand, installCommand, framework)) {
      const { devCommand: newDevCommand, installCommand: newInstallCommand } = getDefaultCommands(
        framework,
        newPackageManager,
      );
      setDevCommand(newDevCommand);
      setInstallCommand(newInstallCommand);
    }
  };

  const loadProjects = useCallback(async () => {
    if (!currentWorkspace) return;
    try {
      const response = await authFetch(`/api/projects?workspaceId=${currentWorkspace.id}`);
      if (!response.ok) {
        console.warn('[Projects] Failed to load projects, status:', response.status);
        return;
      }
      const data = await response.json();
      setProjects(data);
    } catch (err) {
      console.error('[Projects] Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace]);

  useEffect(() => {
    if (currentWorkspace) {
      // Only show loading spinner on initial load, not on soft-refresh
      // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally not tracking projects
      if (projects.length === 0) {
        setLoading(true);
      }
      loadProjects();
    }
  }, [currentWorkspace, loadProjects]);

  // Reload projects when returning via browser back button (bfcache)
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted && currentWorkspace) {
        // Soft refresh — don't show loading if projects already cached
        loadProjects();
      }
    };

    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, [currentWorkspace, loadProjects]);

  // Reload projects when connection is restored after an outage
  const prevConnectionError = useRef(connectionError);
  useEffect(() => {
    if (prevConnectionError.current && !connectionError) {
      console.log('[Projects] Connection restored, reloading projects');
      loadProjects();
    }
    prevConnectionError.current = connectionError;
  }, [connectionError, loadProjects]);

  // Track if using polling fallback
  const [usePolling, setUsePolling] = useState(false);
  const sseReceivedDataRef = useRef(false);
  const sseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasTriedRefreshRef = useRef(false);

  // Network status tracking
  const [pollingNetworkError, setPollingNetworkError] = useState(false);
  const isOnline = useIsOnline();

  // Fetch statuses via polling - preserves data on error
  const pollStatuses = useCallback(async () => {
    if (!currentWorkspace) return;
    try {
      const response = await authFetch(`/api/projects?workspaceId=${currentWorkspace.id}`);
      if (response.ok) {
        const data = await response.json();
        setProjects(data);
        setPollingNetworkError(false); // Clear error on success
      }
    } catch (err) {
      if (isNetworkError(err)) {
        console.log('[Polling] Network error (data preserved):', err);
        setPollingNetworkError(true);
        // CRITICAL: Do NOT clear projects - keep showing stale data
      } else {
        console.error('[Polling] Server error:', err);
        setPollingNetworkError(false);
      }
    }
  }, [currentWorkspace]);

  // Auto-retry on network reconnect
  useOnReconnect(
    useCallback(() => {
      if (pollingNetworkError) {
        console.log('[Projects] Network reconnected, retrying...');
        pollStatuses();
      }
    }, [pollingNetworkError, pollStatuses]),
  );

  // Subscribe to SSE for real-time status updates with polling fallback
  useEffect(() => {
    if (!currentWorkspace || !accessToken || loading) return;

    // If already switched to polling, don't try SSE again
    if (usePolling) return;

    sseReceivedDataRef.current = false;
    hasTriedRefreshRef.current = false;

    const eventSource = new EventSource(
      `/api/projects/status-stream?workspaceId=${currentWorkspace.id}&token=${accessToken}`,
    );

    eventSource.onmessage = (event) => {
      sseReceivedDataRef.current = true;

      // Clear timeout since we received data
      if (sseTimeoutRef.current) {
        clearTimeout(sseTimeoutRef.current);
        sseTimeoutRef.current = null;
      }

      try {
        const data = JSON.parse(event.data);

        if (data.type === 'initial') {
          // Initial statuses from server - apply to loaded projects
          setProjects((prev) =>
            prev.map((project) => ({
              ...project,
              status: data.statuses[project.id] || project.status,
            })),
          );
        } else if (data.projectId && data.status) {
          // Single status update
          setProjects((prev) =>
            prev.map((project) => (project.id === data.projectId ? { ...project, status: data.status } : project)),
          );
        }
      } catch (err) {
        console.error('[SSE] Failed to parse status update:', err);
      }
    };

    eventSource.onerror = async () => {
      // Don't try to refresh if we're offline
      if (!navigator.onLine) {
        console.log('[SSE] Error while offline, skipping refresh');
        eventSource.close();
        return;
      }

      // If we haven't received any data and haven't tried refresh yet, try refreshing token
      if (!sseReceivedDataRef.current && !hasTriedRefreshRef.current) {
        hasTriedRefreshRef.current = true;
        console.log('[SSE] Error before receiving data, trying token refresh...');
        eventSource.close();
        try {
          await refreshAuth();
          // useEffect will recreate EventSource with new token (accessToken dependency)
        } catch {
          console.error('[SSE] Token refresh failed');
        }
        return;
      }

      // Connection lost after receiving data
      if (sseReceivedDataRef.current) {
        console.error('[SSE] Connection lost');
      }
    };

    // Set timeout to fallback to polling if no data received within 5 seconds
    sseTimeoutRef.current = setTimeout(() => {
      if (!sseReceivedDataRef.current) {
        console.log('[Projects] SSE timeout - switching to polling (Cloudflare tunnel detected)');
        eventSource.close();
        setUsePolling(true);
      }
    }, 5000);

    return () => {
      eventSource.close();
      if (sseTimeoutRef.current) {
        clearTimeout(sseTimeoutRef.current);
        sseTimeoutRef.current = null;
      }
    };
  }, [currentWorkspace, accessToken, loading, usePolling]);

  // Polling fallback (every 3 seconds)
  useEffect(() => {
    if (!currentWorkspace || loading || !usePolling) return;

    console.log('[Projects] Using polling mode for status updates');

    // Immediately poll once when switching to polling mode
    pollStatuses();

    const pollInterval = setInterval(() => {
      pollStatuses();
    }, 3000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [currentWorkspace, loading, usePolling, pollStatuses]);

  // Auto-expand clone form if query param is present
  useEffect(() => {
    if (searchParams.get('expand') === 'clone') {
      setShowGitClone(true);
      // Clean up the query param
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  const handleCloneRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    setCloning(true);
    setError(null);
    setErrorCode(null);

    if (!currentWorkspace) {
      setError('No workspace selected');
      setCloning(false);
      return;
    }

    try {
      console.log('[Clone] Starting clone:', gitUrl);
      const requestBody: Record<string, string> = {
        gitUrl,
        workspaceId: currentWorkspace.id,
      };

      // Add optional overrides if provided
      if (projectName.trim()) requestBody.name = projectName.trim();
      if (framework) requestBody.framework = framework;
      if (packageManager) requestBody.packageManager = packageManager;
      if (devCommand.trim()) requestBody.devCommand = devCommand.trim();
      if (installCommand.trim()) requestBody.installCommand = installCommand.trim();
      if (internalPort.trim()) requestBody.internalPort = internalPort.trim();

      const response = await authFetch('/api/projects/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      console.log('[Clone] Response status:', response.status);

      if (!response.ok) {
        const data = await response.json();
        console.error('[Clone] Error response:', data);
        if (data.code === 'GITHUB_AUTH_REQUIRED') {
          setError(data.error);
          setErrorCode(data.code);
          return;
        }
        throw new Error(data.error || 'Failed to clone repository');
      }

      const project = await response.json();
      console.log('[Clone] Success! Project:', project);
      setProjects([project, ...projects]);

      // Reset form
      setGitUrl('');
      setProjectName('');
      setFramework('vite');
      setPackageManager('npm');
      setDevCommand('npm run dev');
      setInstallCommand('npm install');
      setInternalPort('5173');
      setShowGitClone(false);
    } catch (err) {
      console.error('[Clone] Exception:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCloning(false);
    }
  };

  const handleStartProject = async (projectId: string) => {
    // Optimistically update status to 'building'
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, status: 'building' as const } : p)));
    try {
      await authFetch(`/api/docker/start/${projectId}`, {
        method: 'POST',
      });
      // Status will be confirmed via SSE or polling
    } catch (err) {
      console.error('Failed to start project:', err);
      // Revert on error
      setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, status: 'stopped' as const } : p)));
    }
  };

  const _handleStopProject = async (projectId: string) => {
    // Optimistically update status to 'stopped'
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, status: 'stopped' as const } : p)));
    try {
      await authFetch(`/api/docker/stop/${projectId}`, {
        method: 'POST',
      });
      // Status will be confirmed via SSE or polling
    } catch (err) {
      console.error('Failed to stop project:', err);
      // Revert on error - refetch to get actual status
      pollStatuses();
    }
  };

  const handleRestartProject = async (projectId: string) => {
    // Optimistically update status to 'building'
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, status: 'building' as const } : p)));
    try {
      await authFetch(`/api/docker/restart/${projectId}`, {
        method: 'POST',
      });
      // Status will be confirmed via SSE or polling
    } catch (err) {
      console.error('Failed to restart project:', err);
      // Revert on error - refetch to get actual status
      pollStatuses();
    }
  };

  const handleOpenProject = async (projectId: string) => {
    try {
      await authFetch(`/api/projects/${projectId}/activate`, {
        method: 'POST',
      });
      // Full page reload to reinitialize CanvasEngine with new project
      window.location.href = '/';
    } catch (err) {
      console.error('Failed to activate project:', err);
    }
  };

  const handleProjectCreated = () => {
    setShowCreateSidebar(false);
    loadProjects();
  };

  const handleGitHubRepoSelect = useCallback((repo: GitHubRepository) => {
    // Fill the clone form with selected repo's SSH URL
    setGitUrl(repo.ssh_url);
    setProjectName(repo.name);
    setShowGitClone(true);
    setShowGitHubModal(false);
  }, []);

  const handleGitHubRepoCreate = useCallback((repo: GitHubRepository) => {
    // Fill the clone form with created repo's SSH URL
    setGitUrl(repo.ssh_url);
    setProjectName(repo.name);
    setShowGitClone(true);
    setShowGitHubModal(false);
  }, []);

  if (loading) {
    return (
      <div
        data-uniq-id="8f224d0c-0e68-4dea-b45e-0ae269332b36"
        className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900"
      >
        <p data-uniq-id="68676c4b-77f5-421a-80b2-8815c7d9cda6" className="text-lg text-muted-foreground">
          Loading projects...
        </p>
      </div>
    );
  }

  return (
    <div
      data-uniq-id="34183626-b607-43c2-b519-077308a2648a"
      className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-8"
    >
      <div data-uniq-id="14dfd4ef-e4a6-403a-bbbf-a6a3e494a693" className="max-w-6xl mx-auto space-y-6">
        <div data-uniq-id="0a04fa75-200e-4cdd-8570-79e0977f5dd4" className="flex items-center justify-between gap-4">
          <div data-uniq-id="e528f01a-a8ad-441f-8ba3-b94926a4b43b" className="min-w-0">
            <div className="flex items-center gap-3 mb-2 flex-nowrap">
              <h1 data-uniq-id="c942a51a-4970-4e45-8271-da6482352117" className="text-4xl font-bold shrink-0">
                Projects
              </h1>
              {(pollingNetworkError || !isOnline) && <NetworkStatusIndicator variant="badge" isOffline={!isOnline} />}
              <span className="text-2xl text-muted-foreground shrink-0">/</span>
              <Popover open={workspaceSelectorOpen} onOpenChange={setWorkspaceSelectorOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" className="text-2xl font-semibold h-auto py-1 px-2 max-w-[300px]">
                    <span className="truncate">{currentWorkspace?.name || 'Select workspace'}</span>
                    <IconSelector className="w-5 h-5 ml-1 shrink-0 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[250px] p-0" align="start">
                  <Command>
                    <CommandList>
                      <CommandEmpty>No workspaces found</CommandEmpty>
                      <CommandGroup heading="Workspaces">
                        {workspaces.map((ws) => (
                          <CommandItem
                            key={ws.id}
                            value={ws.name}
                            onSelect={() => {
                              setCurrentWorkspace(ws);
                              setWorkspaceSelectorOpen(false);
                            }}
                            className={ws.id === currentWorkspace?.id ? 'bg-accent' : ''}
                          >
                            {ws.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                      <CommandGroup>
                        <CommandItem
                          onSelect={() => {
                            navigate('/workspaces/new');
                            setWorkspaceSelectorOpen(false);
                          }}
                          className="text-primary"
                        >
                          <IconPlus className="w-4 h-4 mr-2" />
                          Create new workspace
                        </CommandItem>
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <p data-uniq-id="69cc37b4-30e7-42ba-9420-b7b03f458255" className="text-muted-foreground">
              Manage your React projects
            </p>
          </div>
          {/* Desktop buttons - hidden below 1024px */}
          <div data-uniq-id="5efeb085-7b75-4622-8010-3af39523decf" className="hidden lg:flex gap-2">
            <Button
              data-uniq-id="3c091922-bfbb-485b-a159-98e15b15a2ff"
              onClick={() => setShowCreateSidebar(true)}
              variant="default"
            >
              <IconSparkles data-uniq-id="214285dd-c66c-49fd-b030-f119b4be51e3" className="w-4 h-4 mr-2" />
              Create New Project with AI
            </Button>
            <Button
              data-uniq-id="6708687e-1797-4d8f-a979-054f5d9961ff"
              onClick={() => setShowGitClone(!showGitClone)}
              variant="outline"
            >
              <IconBrandGit data-uniq-id="e1bd25bf-fa97-4ff4-bf7f-47f5981b3b88" className="w-4 h-4 mr-2" />
              Clone from Git
            </Button>
            <Button
              data-uniq-id="798b46ab-64c7-4710-a985-6f374e2fe1c4"
              onClick={() => setShowGitHubModal(true)}
              variant="outline"
              size="icon"
              title="GitHub Settings"
            >
              <IconBrandGithub data-uniq-id="5b042016-7f65-445d-9e54-f83b4114ce68" className="w-4 h-4" />
            </Button>
          </div>

          {/* Mobile dropdown menu - shown below 1024px */}
          <div className="lg:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <IconDots className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setShowCreateSidebar(true)}>
                  <IconSparkles className="w-4 h-4 mr-2" />
                  Create with AI
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowGitClone(!showGitClone)}>
                  <IconBrandGit className="w-4 h-4 mr-2" />
                  Clone from Git
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowGitHubModal(true)}>
                  <IconBrandGithub className="w-4 h-4 mr-2" />
                  GitHub
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {showGitClone && (
          <Card data-uniq-id="50f0b38f-929a-46a7-93f4-0c840d2e116f">
            <CardHeader data-uniq-id="47f95375-29fe-4c75-9d28-a955b5131ee2">
              <CardTitle data-uniq-id="30b01508-af6c-48ef-a8f8-5edf2acb1373">Clone Git Repository</CardTitle>
              <CardDescription data-uniq-id="d86b3845-6938-449b-93f8-81799f59b060">
                Clone a repository via SSH or HTTPS URL. The project will be automatically detected and configured.
              </CardDescription>
            </CardHeader>
            <CardContent data-uniq-id="bca5fb85-ea9b-4afb-8bc4-749666bb9054">
              <form
                data-uniq-id="fb40535b-97e8-4ae8-848d-a2d2664118e8"
                onSubmit={handleCloneRepo}
                className="space-y-4"
              >
                <div data-uniq-id="b3e0a7cd-b787-4343-8042-2141ff0edacc" className="space-y-2">
                  <Label data-uniq-id="8a758382-a189-4f7d-ab15-ded707578fe3" htmlFor="gitUrl">
                    Git URL
                  </Label>
                  <div data-uniq-id="31d6d7eb-2d80-4577-9b9d-5c8404bfbb89" className="flex gap-2">
                    <Input
                      ref={gitUrlInputRef}
                      data-uniq-id="a8050444-16ae-41d4-b7b7-137af87eafa0"
                      id="gitUrl"
                      placeholder="git@github.com:user/repo.git or https://github.com/user/repo.git"
                      value={gitUrl}
                      onChange={(e) => setGitUrl(e.target.value)}
                      onFocus={() => githubRepos.length > 0 && setGitUrlPopoverOpen(true)}
                      required
                      className="flex-1"
                    />
                    {githubRepos.length > 0 && (
                      <Popover
                        data-uniq-id="ee2a509d-5380-4d7d-b7ac-3d57ead3e140"
                        open={gitUrlPopoverOpen}
                        onOpenChange={setGitUrlPopoverOpen}
                        modal={false}
                      >
                        <PopoverTrigger data-uniq-id="4699134f-1727-403a-b405-974a08eef847" asChild>
                          <Button
                            data-uniq-id="b49585ea-5b7f-4573-8843-47b19571f65a"
                            type="button"
                            variant="outline"
                            size="icon"
                            title="Select from GitHub"
                          >
                            <IconBrandGithub data-uniq-id="47cb0ae5-8ee9-47b2-ad0b-98ce5416fb6f" className="w-4 h-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          data-uniq-id="0c0be607-d935-4b04-a81d-f6f6dcd0aec0"
                          className="w-[400px] p-0"
                          align="end"
                          onOpenAutoFocus={(e) => e.preventDefault()}
                          onInteractOutside={(e) => e.preventDefault()}
                        >
                          <Command data-uniq-id="7d97e6de-951a-4071-bd42-49acb296f2fd">
                            <CommandList data-uniq-id="9d1d672d-c290-4be7-9829-c1de1566cc52">
                              <CommandEmpty data-uniq-id="5e502ee7-a8b4-4aad-ac65-7227f51366fc">
                                No repositories found
                              </CommandEmpty>
                              <CommandGroup
                                data-uniq-id="c58b1e48-b8eb-4e27-b10c-f6e44a2bed04"
                                heading="GitHub Repositories"
                              >
                                {githubRepos.map((repo) => (
                                  <CommandItem
                                    data-uniq-id="726a57f8-aec7-4033-99fa-cdd78d6879a2"
                                    key={repo.id}
                                    value={repo.full_name}
                                    onSelect={() => {
                                      setGitUrl(repo.ssh_url);
                                      setProjectName(repo.name);
                                      setGitUrlPopoverOpen(false);
                                    }}
                                  >
                                    {repo.full_name}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                              <CommandGroup>
                                <CommandItem onSelect={handleConnectGitHubApp} className="text-blue-600">
                                  <IconBrandGithub className="w-4 h-4 mr-2" />
                                  Connect GitHub App to clone private repos
                                </CommandItem>
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                  <div data-uniq-id="3312984f-abc5-42e9-b0c4-e31333360abc" className="space-y-2">
                    <p data-uniq-id="a1d607bf-1550-482c-90c2-345a0c2e4a28" className="text-sm text-muted-foreground">
                      Supports both SSH and HTTPS URLs
                    </p>
                    <div
                      data-uniq-id="f752efa4-d125-4cee-a14b-2ce3cbeeb40e"
                      className="p-3 rounded-md bg-blue-50 border border-blue-200"
                    >
                      <p data-uniq-id="34dfa8b4-4eb6-4421-b0de-8537f683cbff" className="text-sm text-blue-900">
                        <strong data-uniq-id="921f5f62-17a7-4a2f-82ec-13e83f9348b4">Recommendation:</strong> Use SSH
                        URLs (git@github.com:...) for full read/write access. HTTPS URLs provide read-only access unless
                        you configure authentication tokens.
                      </p>
                    </div>
                  </div>
                </div>

                <div data-uniq-id="fd81cf9d-b715-4fae-b137-a6518b7cfd24" className="space-y-2">
                  <Label data-uniq-id="32a06509-0566-4841-8bf2-219bfe0ce2f1" htmlFor="projectName">
                    Project Name (optional)
                  </Label>
                  <Input
                    data-uniq-id="f4a39f77-72f0-48a2-986b-3477ca41630c"
                    id="projectName"
                    placeholder="Auto-detected from package.json"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                  />
                  <p data-uniq-id="e44e1f15-24dc-4e24-b22d-f4de93d9decc" className="text-xs text-muted-foreground">
                    Leave empty to use the name from package.json
                  </p>
                </div>

                <div data-uniq-id="64dd3cb4-d10e-403a-a4a6-a2379d17e7b6" className="space-y-2">
                  <Label data-uniq-id="e713efcf-1c4c-48cb-b7b3-56431c09b7ba" htmlFor="framework">
                    Framework
                  </Label>
                  <select
                    data-uniq-id="5bb3fb77-fd3c-4878-8507-8ad7291da255"
                    id="framework"
                    value={framework}
                    onChange={(e) => handleFrameworkChange(e.target.value as Framework)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option data-uniq-id="d9f184e9-d495-4002-a4bf-93245feec5aa" value="vite">
                      Vite (React)
                    </option>
                    <option data-uniq-id="834bc08a-17a4-4ff5-bec9-e97778bbb435" value="next">
                      Next.js
                    </option>
                    <option data-uniq-id="d5e30515-fe98-4ad9-9b56-560d7150b12d" value="remix">
                      Remix
                    </option>
                    <option data-uniq-id="3f20125a-b7eb-4813-9846-b14188adbe2e" value="cra">
                      Create React App
                    </option>
                    <option value="bun">Bun</option>
                  </select>
                  <p data-uniq-id="1244e471-5623-47bb-9577-945109e9706d" className="text-xs text-muted-foreground">
                    Select your project's framework
                  </p>
                </div>

                <div data-uniq-id="0130fd0c-b936-48e2-9b31-d7b37d96cb24" className="space-y-2">
                  <Label data-uniq-id="66143c3d-11a1-48bb-8d54-fbcd0e9248a6" htmlFor="packageManager">
                    Package Manager
                  </Label>
                  <select
                    data-uniq-id="42eed9ac-87a8-489c-99d3-d6ed7a2a65f7"
                    id="packageManager"
                    value={packageManager}
                    onChange={(e) => handlePackageManagerChange(e.target.value as PackageManager)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option data-uniq-id="ac0103c4-fb5d-4616-ac63-aea9a310aaea" value="npm">
                      npm
                    </option>
                    <option data-uniq-id="d6114f3e-3959-4b79-8d71-866385be0c5f" value="yarn">
                      yarn
                    </option>
                    <option data-uniq-id="4e92fecd-671f-4c30-a958-6cfb835f03ee" value="pnpm">
                      pnpm
                    </option>
                    <option value="bun">bun</option>
                  </select>
                  <p data-uniq-id="4ddf472d-2cfb-4847-8bbb-84e16fa05dd6" className="text-xs text-muted-foreground">
                    Select package manager to use for dependencies
                  </p>
                </div>

                <div data-uniq-id="f68e5119-3ae6-42e9-a530-c59eac75cd56" className="space-y-2">
                  <Label data-uniq-id="6fe7fd62-e2a4-4ffb-adec-39d6116ccbe8" htmlFor="installCommand">
                    Install Command
                  </Label>
                  <Input
                    data-uniq-id="4c1260b5-68da-4e28-9273-42b56fe64110"
                    id="installCommand"
                    placeholder="npm install"
                    value={installCommand}
                    onChange={(e) => setInstallCommand(e.target.value)}
                  />
                  <p data-uniq-id="31c22312-f7cc-4651-ae04-bdf32fbdf8ed" className="text-xs text-muted-foreground">
                    Command to install dependencies (e.g., npm install --legacy-peer-deps)
                  </p>
                </div>

                <div data-uniq-id="ac6bdeec-f27b-42bc-8bd4-556abd55fe8c" className="space-y-2">
                  <Label data-uniq-id="b21fdc4b-8083-48e8-abab-223e62e3f55a" htmlFor="devCommand">
                    Dev Command
                  </Label>
                  <Input
                    data-uniq-id="1346bf25-efaf-411f-91ba-09d69f71b295"
                    id="devCommand"
                    placeholder="npm run dev"
                    value={devCommand}
                    onChange={(e) => setDevCommand(e.target.value)}
                  />
                  <p data-uniq-id="6077055f-f5e4-4346-945c-2566c1a8c8ed" className="text-xs text-muted-foreground">
                    Command to start the dev server (auto-filled based on framework)
                  </p>
                </div>

                <div data-uniq-id="e1ac4b34-f57b-4c40-9edf-c15182c6ca9f" className="space-y-2">
                  <Label data-uniq-id="b3fa7ee6-c8d0-4e8e-a0a0-840a49fb62e6" htmlFor="internalPort">
                    Internal Port
                  </Label>
                  <Input
                    data-uniq-id="03b6b72f-bf70-43f8-9b8d-fedf0bb12361"
                    id="internalPort"
                    type="number"
                    placeholder="5173"
                    value={internalPort}
                    onChange={(e) => setInternalPort(e.target.value)}
                  />
                  <p data-uniq-id="be61f8c0-9c60-4e18-88f7-6d053179f791" className="text-xs text-muted-foreground">
                    Port inside Docker container (auto-filled based on framework)
                  </p>
                </div>

                {error && (
                  <div
                    data-uniq-id="6c7e0bde-d75e-42d0-928c-ba096e592f7e"
                    className="p-3 rounded-md bg-destructive/10 text-destructive text-sm"
                  >
                    {error}
                    {errorCode === 'GITHUB_AUTH_REQUIRED' && (
                      <div className="mt-2">
                        <GitHubAppConnect variant="compact" />
                      </div>
                    )}
                  </div>
                )}

                {cloning && (
                  <div
                    data-uniq-id="95a26345-36f0-438a-a128-a86163f467d0"
                    className="p-3 rounded-md bg-amber-50 border border-amber-200"
                  >
                    <p data-uniq-id="4b7fc228-b09c-4fef-b897-73688845f507" className="text-sm text-amber-900">
                      Cloning repository... This usually takes 10-30 seconds.
                    </p>
                  </div>
                )}

                <div data-uniq-id="9b2d3a6e-a0ab-49bd-adf2-697daee8a836" className="flex gap-2">
                  <Button data-uniq-id="1a6b8437-a34f-4599-a11a-2086035645e0" type="submit" disabled={cloning}>
                    {cloning ? 'Cloning...' : 'Clone Repository'}
                  </Button>
                  <Button
                    data-uniq-id="1f70e942-589a-46af-bb8c-1c32aece9aab"
                    type="button"
                    variant="outline"
                    onClick={() => setShowGitClone(false)}
                    disabled={cloning}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <div data-uniq-id="15921f9e-72fc-491b-9243-6c10f55ca65a" className="grid gap-4">
          {projects.length === 0 ? (
            <Card data-uniq-id="f40f1f12-0709-4b4b-bcc2-ab6d8ceda337">
              <CardContent
                data-uniq-id="4bcd9370-7641-427c-9d37-5e1356f4fd6a"
                className="flex flex-col items-center justify-center py-16"
              >
                <p data-uniq-id="7328d71b-757d-4805-ab9a-7452a2fa06e3" className="text-lg text-muted-foreground mb-4">
                  No projects yet
                </p>
                <Button data-uniq-id="c0b69bc3-d6c2-4b42-82a1-b2428b6283dd" onClick={() => setShowGitClone(true)}>
                  <IconBrandGit data-uniq-id="47abcc67-9970-41b7-ac31-e0cbd43c6a7b" className="w-4 h-4 mr-2" />
                  Clone your first project
                </Button>
              </CardContent>
            </Card>
          ) : (
            projects.map((project) => (
              <Card
                data-uniq-id="32a94575-5a3c-4910-97ff-f2531571a778"
                key={project.id}
                className="hover:shadow-lg transition-shadow"
              >
                <CardContent data-uniq-id="cda6f025-d83b-4ad6-9ae3-9a78c8eddab1" className="p-6">
                  {/* Header: name + status + buttons */}
                  <div
                    data-uniq-id="97d93c63-175a-464a-9420-3330193c1d42"
                    className="flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <h3
                        data-uniq-id="0189129f-04aa-4036-9137-71ef8b3f9938"
                        className="text-xl font-semibold truncate"
                      >
                        {project.name}
                      </h3>
                      <span
                        data-uniq-id="52b4683c-a66b-4183-bbb2-a51298a62bff"
                        className={`text-xs px-2 py-1 rounded-full shrink-0 ${
                          project.status === 'running'
                            ? 'bg-green-100 text-green-700'
                            : project.status === 'building'
                              ? 'bg-blue-100 text-blue-700'
                              : project.status === 'error'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {project.status}
                      </span>
                      {project.creationStatus &&
                        project.creationStatus !== 'idle' &&
                        project.creationStatus !== 'completed' && (
                          <span
                            data-uniq-id="7361a9ab-1a1e-4e55-bad5-ff29104155ff"
                            className={`text-xs px-2 py-1 rounded-full shrink-0 ${
                              project.creationStatus === 'failed'
                                ? 'bg-red-100 text-red-700'
                                : project.creationStatus === 'cancelled'
                                  ? 'bg-gray-100 text-gray-700'
                                  : 'bg-blue-100 text-blue-700'
                            }`}
                          >
                            {project.creationStatus}
                          </span>
                        )}
                    </div>
                    <div data-uniq-id="b64e2da5-74d6-481b-9b0f-80415d10ce1a" className="flex gap-2 shrink-0">
                      {project.status === 'running' || project.status === 'building' ? (
                        <Button
                          data-uniq-id="34cb810f-e970-4045-a77b-c1e1edf8678e"
                          variant="outline"
                          size="sm"
                          onClick={() => handleRestartProject(project.id)}
                        >
                          <IconRefresh
                            data-uniq-id="ebb19187-5b25-4318-a4fc-3986e4ac7288"
                            className="w-4 h-4 sm:mr-1"
                          />
                          <span className="hidden sm:inline">Restart</span>
                        </Button>
                      ) : (
                        <Button
                          data-uniq-id="2735d31e-85d0-42e3-842b-c418a1a3f15c"
                          variant="outline"
                          size="sm"
                          onClick={() => handleStartProject(project.id)}
                        >
                          <IconPlayerPlay
                            data-uniq-id="9296eb29-c2ca-4b56-baf2-e423ae03dbd4"
                            className="w-4 h-4 sm:mr-1"
                          />
                          <span className="hidden sm:inline">Start</span>
                        </Button>
                      )}
                      <Button
                        data-uniq-id="2e199c82-7d6f-416d-8667-62c76a9f8972"
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/projects/${project.id}/settings`)}
                      >
                        <IconSettings data-uniq-id="e9f70738-c2f6-4a4c-93fa-967ce75a9860" className="w-4 h-4" />
                      </Button>
                      {project.creationStatus === 'generating' ? (
                        <Button
                          data-uniq-id="b82b64f7-34cf-445b-8557-864029e1844e"
                          size="sm"
                          onClick={() => setContinueProject(project)}
                        >
                          Continue
                        </Button>
                      ) : (
                        <Button
                          data-uniq-id="b82b64f7-34cf-445b-8557-864029e1844e"
                          size="sm"
                          onClick={() => handleOpenProject(project.id)}
                        >
                          Open
                        </Button>
                      )}
                    </div>
                  </div>
                  {/* Details: path, github, metadata */}
                  <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div data-uniq-id="6da539d1-c798-48e1-885c-47479122c23f" className="min-w-0">
                      <p data-uniq-id="de8dc493-1c82-4e99-9581-2d9110c1812e" className="text-sm text-muted-foreground">
                        {project.path.split('/').pop()}
                      </p>
                      {project.githubRepoUrl && (
                        <a
                          data-uniq-id="c7f59c91-ccf4-421c-a8c1-d24809779d4c"
                          href={project.githubRepoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"
                        >
                          <IconBrandGit data-uniq-id="f172c074-41a4-4e78-a73c-ce3f48fd84c7" className="w-4 h-4" />
                          View on GitHub
                        </a>
                      )}
                    </div>
                    <div
                      data-uniq-id="d75e7bc5-c85c-4539-83a1-5fe60e5d4a0e"
                      className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground shrink-0"
                    >
                      <span data-uniq-id="b6b7a2c8-ed40-4df2-81cb-d90317eb7c78">Framework: {project.framework}</span>
                      <span data-uniq-id="9cceff7e-1ed3-443d-862e-a3c1e8d3d993">Port: {project.internalPort}</span>
                      <span data-uniq-id="cfd52ee6-518a-4116-924d-1a2f70da13c4">Dev: {project.devCommand}</span>
                      <span data-uniq-id="f7f193b7-b1a7-4351-9b7e-d553cc3ad9c4">Install: {project.installCommand}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
      {/* AI Project Creation Sidebar */}
      {showCreateSidebar && (
        <div
          data-uniq-id="7139c80e-a8d9-4a1f-a25c-77590de04489"
          className="fixed top-0 right-0 h-screen w-[450px] z-50 shadow-2xl"
        >
          <ProjectCreationAIChat
            data-uniq-id="43a62e87-ec18-4482-b91b-47e14705b96c"
            onClose={() => {
              setShowCreateSidebar(false);
              setContinueProject(null);
            }}
            onProjectCreated={handleProjectCreated}
            existingProject={
              continueProject
                ? {
                    id: continueProject.id,
                    path: continueProject.path,
                    framework: continueProject.framework,
                    packageManager: continueProject.packageManager,
                    name: continueProject.name,
                  }
                : undefined
            }
          />
        </div>
      )}
      {/* GitHub Repository Selection Modal */}
      <GitHubRepoModal
        data-uniq-id="13a95d19-f843-4235-a372-4c08984f41b6"
        open={showGitHubModal}
        onOpenChange={setShowGitHubModal}
        onSelect={handleGitHubRepoSelect}
        onCreate={handleGitHubRepoCreate}
      />
    </div>
  );
}

export const SampleDefault = () => {
  return (
    <MemoryRouter>
      <Projects />
    </MemoryRouter>
  );
};

import { MemoryRouter } from 'react-router-dom';
