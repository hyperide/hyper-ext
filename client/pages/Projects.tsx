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
import { loadPersistedState, resetStateForProject, savePersistedState } from '@/lib/storage';
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
  // null = not loaded yet, [] = loaded with zero projects
  const [projects, setProjects] = useState<Project[] | null>(null);
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
  const [restoredCreationProject, setRestoredCreationProject] = useState<{
    id: string;
    path: string;
    framework: string;
    packageManager: string;
    name: string;
  } | null>(null);
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

  // Restore in-progress AI project creation after page reload
  useEffect(() => {
    const stored = localStorage.getItem('projectCreationInProgress');
    if (stored) {
      try {
        const p = JSON.parse(stored);
        if (p?.id && p?.path) {
          setRestoredCreationProject(p);
          setShowCreateSidebar(true);
        }
      } catch {}
    }
  }, []);

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
      // Don't set projects to [] — leave as null so we don't show "No projects yet"
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: projects intentionally omitted — only used to check initial load, not as a trigger
  useEffect(() => {
    if (currentWorkspace) {
      // Only show loading spinner on initial load, not on soft-refresh
      if (projects === null) {
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshAuth is stable zustand action, adding it would needlessly recreate EventSource
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
          setProjects(
            (prev) =>
              prev?.map((project) => ({
                ...project,
                status: data.statuses[project.id] || project.status,
              })) ?? prev,
          );
        } else if (data.projectId && data.status) {
          // Single status update
          setProjects(
            (prev) =>
              prev?.map((project) => (project.id === data.projectId ? { ...project, status: data.status } : project)) ??
              prev,
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
      setProjects([project, ...(projects ?? [])]);

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
    setProjects((prev) => prev?.map((p) => (p.id === projectId ? { ...p, status: 'building' as const } : p)) ?? prev);
    try {
      await authFetch(`/api/docker/start/${projectId}`, {
        method: 'POST',
      });
      // Status will be confirmed via SSE or polling
    } catch (err) {
      console.error('Failed to start project:', err);
      // Revert on error
      setProjects((prev) => prev?.map((p) => (p.id === projectId ? { ...p, status: 'stopped' as const } : p)) ?? prev);
    }
  };

  const _handleStopProject = async (projectId: string) => {
    // Optimistically update status to 'stopped'
    setProjects((prev) => prev?.map((p) => (p.id === projectId ? { ...p, status: 'stopped' as const } : p)) ?? prev);
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
    setProjects((prev) => prev?.map((p) => (p.id === projectId ? { ...p, status: 'building' as const } : p)) ?? prev);
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
      // Persist new projectId BEFORE reload so SSE picks up the correct project
      if (loadPersistedState().projectId !== projectId) {
        resetStateForProject(projectId);
      } else {
        savePersistedState({ projectId });
      }
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
        <p className="text-lg text-muted-foreground">Loading projects...</p>
      </div>
    );
  }

  return (
    <div
      data-testid="ProjectsPage"
      className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-8"
    >
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-2 flex-nowrap">
              <h1 className="text-4xl font-bold shrink-0">Projects</h1>
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
            <p className="text-muted-foreground">Manage your React projects</p>
          </div>
          {/* Desktop buttons - hidden below 1024px */}
          <div className="hidden lg:flex gap-2">
            <Button onClick={() => setShowCreateSidebar(true)} variant="default">
              <IconSparkles className="w-4 h-4 mr-2" />
              Create New Project with AI
            </Button>
            <Button onClick={() => setShowGitClone(!showGitClone)} variant="outline">
              <IconBrandGit className="w-4 h-4 mr-2" />
              Clone from Git
            </Button>
            <Button onClick={() => setShowGitHubModal(true)} variant="outline" size="icon" title="GitHub Settings">
              <IconBrandGithub className="w-4 h-4" />
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
          <Card>
            <CardHeader>
              <CardTitle>Clone Git Repository</CardTitle>
              <CardDescription>
                Clone a repository via SSH or HTTPS URL. The project will be automatically detected and configured.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCloneRepo} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="gitUrl">Git URL</Label>
                  <div className="flex gap-2">
                    <Input
                      ref={gitUrlInputRef}
                      id="gitUrl"
                      placeholder="git@github.com:user/repo.git or https://github.com/user/repo.git"
                      value={gitUrl}
                      onChange={(e) => setGitUrl(e.target.value)}
                      onFocus={() => githubRepos.length > 0 && setGitUrlPopoverOpen(true)}
                      required
                      className="flex-1"
                    />
                    {githubRepos.length > 0 && (
                      <Popover open={gitUrlPopoverOpen} onOpenChange={setGitUrlPopoverOpen} modal={false}>
                        <PopoverTrigger asChild>
                          <Button type="button" variant="outline" size="icon" title="Select from GitHub">
                            <IconBrandGithub className="w-4 h-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-[400px] p-0"
                          align="end"
                          onOpenAutoFocus={(e) => e.preventDefault()}
                          onInteractOutside={(e) => e.preventDefault()}
                        >
                          <Command>
                            <CommandList>
                              <CommandEmpty>No repositories found</CommandEmpty>
                              <CommandGroup heading="GitHub Repositories">
                                {githubRepos.map((repo) => (
                                  <CommandItem
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
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Supports both SSH and HTTPS URLs</p>
                    <div className="p-3 rounded-md bg-blue-50 border border-blue-200">
                      <p className="text-sm text-blue-900">
                        <strong>Recommendation:</strong> Use SSH URLs (git@github.com:...) for full read/write access.
                        HTTPS URLs provide read-only access unless you configure authentication tokens.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="projectName">Project Name (optional)</Label>
                  <Input
                    id="projectName"
                    placeholder="Auto-detected from package.json"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Leave empty to use the name from package.json</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="framework">Framework</Label>
                  <select
                    id="framework"
                    value={framework}
                    onChange={(e) => handleFrameworkChange(e.target.value as Framework)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="vite">Vite (React)</option>
                    <option value="next">Next.js</option>
                    <option value="remix">Remix</option>
                    <option value="cra">Create React App</option>
                    <option value="bun">Bun</option>
                  </select>
                  <p className="text-xs text-muted-foreground">Select your project's framework</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="packageManager">Package Manager</Label>
                  <select
                    id="packageManager"
                    value={packageManager}
                    onChange={(e) => handlePackageManagerChange(e.target.value as PackageManager)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="npm">npm</option>
                    <option value="yarn">yarn</option>
                    <option value="pnpm">pnpm</option>
                    <option value="bun">bun</option>
                  </select>
                  <p className="text-xs text-muted-foreground">Select package manager to use for dependencies</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="installCommand">Install Command</Label>
                  <Input
                    id="installCommand"
                    placeholder="npm install"
                    value={installCommand}
                    onChange={(e) => setInstallCommand(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Command to install dependencies (e.g., npm install --legacy-peer-deps)
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="devCommand">Dev Command</Label>
                  <Input
                    id="devCommand"
                    placeholder="npm run dev"
                    value={devCommand}
                    onChange={(e) => setDevCommand(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Command to start the dev server (auto-filled based on framework)
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="internalPort">Internal Port</Label>
                  <Input
                    id="internalPort"
                    type="number"
                    placeholder="5173"
                    value={internalPort}
                    onChange={(e) => setInternalPort(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Port inside Docker container (auto-filled based on framework)
                  </p>
                </div>

                {error && (
                  <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                    {error}
                    {errorCode === 'GITHUB_AUTH_REQUIRED' && (
                      <div className="mt-2">
                        <GitHubAppConnect variant="compact" />
                      </div>
                    )}
                  </div>
                )}

                {cloning && (
                  <div className="p-3 rounded-md bg-amber-50 border border-amber-200">
                    <p className="text-sm text-amber-900">Cloning repository... This usually takes 10-30 seconds.</p>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button type="submit" disabled={cloning}>
                    {cloning ? 'Cloning...' : 'Clone Repository'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowGitClone(false)} disabled={cloning}>
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4">
          {projects !== null && projects.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <p className="text-lg text-muted-foreground mb-4">No projects yet</p>
                <Button onClick={() => setShowGitClone(true)}>
                  <IconBrandGit className="w-4 h-4 mr-2" />
                  Clone your first project
                </Button>
              </CardContent>
            </Card>
          ) : (
            projects?.map((project) => (
              <Card key={project.id} className="hover:shadow-lg transition-shadow">
                <CardContent className="p-6">
                  {/* Header: name + status + buttons */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <h3 className="text-xl font-semibold truncate">{project.name}</h3>
                      <span
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
                    <div className="flex gap-2 shrink-0">
                      {project.status === 'running' || project.status === 'building' ? (
                        <Button variant="outline" size="sm" onClick={() => handleRestartProject(project.id)}>
                          <IconRefresh className="w-4 h-4 sm:mr-1" />
                          <span className="hidden sm:inline">Restart</span>
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => handleStartProject(project.id)}>
                          <IconPlayerPlay className="w-4 h-4 sm:mr-1" />
                          <span className="hidden sm:inline">Start</span>
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${project.id}/settings`)}>
                        <IconSettings className="w-4 h-4" />
                      </Button>
                      {project.creationStatus === 'generating' ? (
                        <Button size="sm" onClick={() => setContinueProject(project)}>
                          Continue
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => handleOpenProject(project.id)}>
                          Open
                        </Button>
                      )}
                    </div>
                  </div>
                  {/* Details: path, github, metadata */}
                  <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-muted-foreground">{project.path.split('/').pop()}</p>
                      {project.githubRepoUrl && (
                        <a
                          href={project.githubRepoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"
                        >
                          <IconBrandGit className="w-4 h-4" />
                          View on GitHub
                        </a>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground shrink-0">
                      <span>Framework: {project.framework}</span>
                      <span>Port: {project.internalPort}</span>
                      <span>Dev: {project.devCommand}</span>
                      <span>Install: {project.installCommand}</span>
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
        <div className="fixed top-0 right-0 h-screen w-full sm:w-[450px] z-50 shadow-2xl">
          <ProjectCreationAIChat
            onClose={() => {
              setShowCreateSidebar(false);
              setContinueProject(null);
              setRestoredCreationProject(null);
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
                : (restoredCreationProject ?? undefined)
            }
          />
        </div>
      )}
      {/* GitHub Repository Selection Modal */}
      <GitHubRepoModal
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
