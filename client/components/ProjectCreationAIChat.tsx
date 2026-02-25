import { IconAlertCircle, IconCheck, IconExternalLink, IconLoader2, IconRefresh, IconX } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { authFetch } from '@/utils/authFetch';
import AIAgentChat from './AIAgentChat';
import GitHubAuthButton from './GitHubAuthButton';
import { useGitHubAppInstallations } from './github/hooks/useGitHubAppInstallations';
import { useGitHubOrganizations } from './github/hooks/useGitHubOrganizations';
import { useGitHubRepositories } from './github/hooks/useGitHubRepositories';
import type { GitHubRepository } from './github/types';

interface ExistingProject {
  id: string;
  path: string;
  framework: string;
  packageManager: string;
  name: string;
}

interface ProjectCreationAIChatProps {
  onClose: () => void;
  onProjectCreated?: (projectId: string) => void;
  existingProject?: ExistingProject;
}

type Framework = 'nextjs' | 'vite' | 'remix' | 'bun';
type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';
type UIKit = 'tamagui' | 'shadcn';
type CreationStep = 'setup' | 'creating' | 'chatting' | 'completed' | 'error';

const STORAGE_KEY = 'projectCreationForm';

interface SavedFormData {
  repoName: string;
  selectedOrg: string;
  selectedRepoId: number | null;
  framework: Framework;
  packageManager: PackageManager;
  uiKit: UIKit;
  isPrivate: boolean;
  description: string;
}

export default function ProjectCreationAIChat({
  onClose,
  onProjectCreated,
  existingProject,
}: ProjectCreationAIChatProps) {
  const { currentWorkspace } = useAuthStore();
  const [isGitHubAuthenticated, setIsGitHubAuthenticated] = useState(false);
  const [currentStep, setCurrentStep] = useState<CreationStep>(existingProject ? 'chatting' : 'setup');

  // GitHub organizations
  const { organizations, user, refetch: refetchOrgs } = useGitHubOrganizations();

  // GitHub App installations
  const {
    installations,
    loading: installationsLoading,
    configured,
    getInstallUrl,
    refetch: refetchInstallations,
  } = useGitHubAppInstallations();
  const [installUrl, setInstallUrl] = useState<string | null>(null);

  // Form state
  const [repoName, setRepoName] = useState('');
  const [selectedOrg, setSelectedOrg] = useState<string>('personal');
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepository | null>(null);

  // For personal accounts, fetch existing repositories (sorted by creation date, newest first)
  const isPersonalAccount = selectedOrg === 'personal';
  const {
    repositories: personalRepos,
    loading: reposLoading,
    refetch: refetchRepos,
  } = useGitHubRepositories({
    org: 'personal',
    sort: 'created',
    enabled: isGitHubAuthenticated && isPersonalAccount,
    perPage: 50,
  });
  const [framework, setFramework] = useState<Framework>((existingProject?.framework as Framework) || 'vite');
  const [packageManager, setPackageManager] = useState<PackageManager>(
    (existingProject?.packageManager as PackageManager) || 'npm',
  );
  const [uiKit, setUIKit] = useState<UIKit>('shadcn');
  const [isPrivate, setIsPrivate] = useState(true);
  const [description, setDescription] = useState('');

  // Creation state
  const [projectId, setProjectId] = useState<string | null>(existingProject?.id || null);
  const [projectPath, setProjectPath] = useState<string | null>(existingProject?.path || null);
  const [error, setError] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);

  // Load existing chat for continuing project
  useEffect(() => {
    if (!existingProject?.id) return;

    const loadExistingChat = async () => {
      try {
        const chatsResponse = await authFetch(`/api/ai-agent/chats?projectId=${existingProject.id}`);
        if (!chatsResponse.ok) return;

        const chats = await chatsResponse.json();
        if (chats.length === 0) return;

        // Use the most recent chat - AIAgentChat will load messages
        setChatId(chats[chats.length - 1].id);
      } catch (error) {
        console.error('[ProjectCreationAIChat] Failed to load existing chat:', error);
      }
    };

    loadExistingChat();
  }, [existingProject?.id]);

  // Refetch organizations when auth status changes
  useEffect(() => {
    if (isGitHubAuthenticated) {
      refetchOrgs();
    }
  }, [isGitHubAuthenticated, refetchOrgs]);

  // Compute if GitHub App is installed for selected owner
  const isAppInstalledForOwner = useMemo(() => {
    if (!configured) return true; // If GitHub App not configured on server, skip check
    const ownerLogin = selectedOrg === 'personal' ? user?.login : selectedOrg;
    if (!ownerLogin) return false;
    return installations.some((inst) => inst.accountLogin.toLowerCase() === ownerLogin.toLowerCase());
  }, [configured, selectedOrg, user, installations]);

  // Fetch install URL when GitHub App not installed for owner
  useEffect(() => {
    if (configured && !isAppInstalledForOwner && isGitHubAuthenticated) {
      getInstallUrl().then(setInstallUrl);
    }
  }, [configured, isAppInstalledForOwner, isGitHubAuthenticated, getInstallUrl]);

  // Refetch installations when window regains focus (user may have completed installation)
  useEffect(() => {
    const handleFocus = () => {
      refetchInstallations();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refetchInstallations]);

  // Load saved form data from localStorage on mount
  useEffect(() => {
    if (existingProject) return; // Skip for continuing projects

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;

      const data: SavedFormData = JSON.parse(saved);
      if (data.repoName) setRepoName(data.repoName);
      if (data.selectedOrg) setSelectedOrg(data.selectedOrg);
      if (data.framework) setFramework(data.framework);
      if (data.packageManager) setPackageManager(data.packageManager);
      if (data.uiKit) setUIKit(data.uiKit);
      if (typeof data.isPrivate === 'boolean') setIsPrivate(data.isPrivate);
      if (data.description) setDescription(data.description);
    } catch {
      // Ignore parse errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  // Restore selectedRepo after repositories load
  useEffect(() => {
    if (existingProject || !personalRepos.length || selectedRepo) return;

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;

      const data: SavedFormData = JSON.parse(saved);
      if (data.selectedRepoId) {
        const repo = personalRepos.find((r) => r.id === data.selectedRepoId);
        if (repo) setSelectedRepo(repo);
      }
    } catch {
      // Ignore parse errors
    }
  }, [existingProject, personalRepos, selectedRepo]);

  // Save form data to localStorage when fields change
  useEffect(() => {
    if (existingProject || currentStep !== 'setup') return;

    const data: SavedFormData = {
      repoName,
      selectedOrg,
      selectedRepoId: selectedRepo?.id ?? null,
      framework,
      packageManager,
      uiKit,
      isPrivate,
      description,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [
    existingProject,
    currentStep,
    repoName,
    selectedOrg,
    selectedRepo,
    framework,
    packageManager,
    uiKit,
    isPrivate,
    description,
  ]);

  // For personal accounts: need selected repo; for orgs: need repo name and app installed
  const canStart =
    isGitHubAuthenticated &&
    currentStep === 'setup' &&
    !!currentWorkspace &&
    (isPersonalAccount
      ? selectedRepo !== null && isAppInstalledForOwner
      : repoName.trim() !== '' && isAppInstalledForOwner);

  const handleStartProject = async () => {
    if (!canStart || !currentWorkspace) return;

    setCurrentStep('creating');
    setError(null);

    try {
      // Step 1: Initialize project
      // For personal accounts, use existing repo; for orgs, create new repo
      const requestBody =
        isPersonalAccount && selectedRepo
          ? {
              // Use existing repository
              existingRepo: {
                name: selectedRepo.name,
                full_name: selectedRepo.full_name,
                clone_url: selectedRepo.clone_url,
                html_url: selectedRepo.html_url,
                default_branch: selectedRepo.default_branch,
                private: selectedRepo.private,
              },
              framework,
              packageManager,
              uiKit,
              description,
              workspaceId: currentWorkspace.id,
            }
          : {
              // Create new repository (for organizations)
              repoName,
              org: selectedOrg,
              framework,
              packageManager,
              uiKit,
              isPrivate,
              description,
              workspaceId: currentWorkspace.id,
            };

      const response = await authFetch('/api/project-creation/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to initialize project');
      }

      const data = await response.json();
      setProjectId(data.projectId);
      setProjectPath(data.projectPath);

      // Step 2: Create chat for this project
      const chatResponse = await authFetch('/api/ai-agent/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: data.projectId,
          title: 'New Chat',
        }),
      });

      let newChatId: string | null = null;
      if (chatResponse.ok) {
        const chatData = await chatResponse.json();
        newChatId = chatData.id;
        setChatId(newChatId);
      }

      // AIAgentChat will handle initial prompt via initialPrompt prop
      localStorage.removeItem(STORAGE_KEY);
      setCurrentStep('chatting');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setCurrentStep('error');
    }
  };

  const handleFinalize = async () => {
    if (!projectId) return;

    try {
      const response = await authFetch(`/api/project-creation/finalize/${projectId}`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to finalize project');
      }

      setCurrentStep('completed');
      onProjectCreated?.(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  return (
    <div className="h-full flex flex-col bg-background border-l">
      {/* Header */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-border flex-shrink-0">
        <h2 className="text-sm font-semibold">Create New Project with AI</h2>
        <button type="button" onClick={onClose} className="p-1 hover:bg-muted rounded">
          <IconX className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Step 1: Setup */}
        {currentStep === 'setup' && (
          <div className="space-y-4">
            {/* GitHub Auth */}
            <div>
              <span className="block text-xs font-medium text-foreground mb-2">GitHub Connection</span>
              <GitHubAuthButton onAuthChange={setIsGitHubAuthenticated} />
            </div>

            {isGitHubAuthenticated && (
              <>
                {/* Owner */}
                <div>
                  <label htmlFor="owner-select" className="block text-xs font-medium text-foreground mb-2">
                    Owner *
                  </label>
                  <select
                    id="owner-select"
                    value={selectedOrg}
                    onChange={(e) => setSelectedOrg(e.target.value)}
                    className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background"
                  >
                    {user && <option value="personal">{user.login} (personal)</option>}
                    {organizations.map((org) => (
                      <option key={org.id} value={org.login}>
                        {org.login}
                      </option>
                    ))}
                  </select>
                </div>

                {/* GitHub App Warning */}
                {configured && !installationsLoading && !isAppInstalledForOwner && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-md">
                    <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">
                      GitHub App not installed for {selectedOrg === 'personal' ? 'your account' : selectedOrg}. Install
                      it to {isPersonalAccount ? 'access your repositories' : 'create repositories'}.
                    </p>
                    {installUrl && (
                      <button
                        type="button"
                        onClick={() => window.open(installUrl, '_blank')}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-amber-500 text-white rounded-md hover:bg-amber-600"
                      >
                        <IconExternalLink className="w-3 h-3" />
                        Install GitHub App
                      </button>
                    )}
                  </div>
                )}

                {/* Repository selection - different UI for personal vs organization */}
                {isPersonalAccount ? (
                  <div>
                    {/* API limitation notice */}
                    <div className="p-3 mb-3 bg-blue-500/10 border border-blue-500/30 rounded-md">
                      <p className="text-xs text-blue-600 dark:text-blue-400">
                        Due to GitHub API limitations, repositories in personal accounts cannot be created
                        automatically. Please create a repository on GitHub first, then select it below.
                      </p>
                      <a
                        href="https://github.com/new"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        <IconExternalLink className="w-3 h-3" />
                        Create repository on GitHub
                      </a>
                    </div>

                    <div className="flex items-center justify-between mb-2">
                      <span className="block text-xs font-medium text-foreground">Select Repository *</span>
                      <button
                        type="button"
                        onClick={() => refetchRepos()}
                        disabled={reposLoading}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                        title="Refresh repository list"
                      >
                        <IconRefresh className={`w-3 h-3 ${reposLoading ? 'animate-spin' : ''}`} />
                        Refresh
                      </button>
                    </div>
                    <select
                      value={selectedRepo?.id.toString() || ''}
                      onChange={(e) => {
                        const repo = personalRepos.find((r) => r.id.toString() === e.target.value);
                        setSelectedRepo(repo || null);
                      }}
                      onFocus={() => refetchRepos()}
                      className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background"
                      disabled={!isAppInstalledForOwner}
                    >
                      <option value="">{reposLoading ? 'Loading repositories...' : 'Select a repository'}</option>
                      {personalRepos.map((repo) => (
                        <option key={repo.id} value={repo.id.toString()}>
                          {repo.name} {repo.private ? '🔒' : '🌐'}
                        </option>
                      ))}
                    </select>
                    {selectedRepo && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selectedRepo.description || 'No description'}
                      </p>
                    )}
                  </div>
                ) : (
                  <div>
                    <label htmlFor="repo-name-input" className="block text-xs font-medium text-foreground mb-2">
                      Repository Name *
                    </label>
                    <input
                      id="repo-name-input"
                      type="text"
                      value={repoName}
                      onChange={(e) => setRepoName(e.target.value)}
                      placeholder="my-awesome-project"
                      className="w-full px-3 py-2 border border-input rounded-md text-sm"
                    />
                  </div>
                )}

                {/* Framework */}
                <div>
                  <span className="block text-xs font-medium text-foreground mb-2">Framework *</span>
                  <div className="grid grid-cols-4 gap-2">
                    {(['nextjs', 'vite', 'remix', 'bun'] as Framework[]).map((fw) => (
                      <button
                        key={fw}
                        type="button"
                        onClick={() => {
                          setFramework(fw);
                          // Reset uiKit to shadcn if not nextjs and tamagui is selected
                          if (fw !== 'nextjs' && uiKit === 'tamagui') {
                            setUIKit('shadcn');
                          }
                        }}
                        className={`px-3 py-2 text-xs font-medium rounded-md border ${
                          framework === fw
                            ? 'bg-primary/10 border-primary text-primary'
                            : 'bg-background border-input text-foreground hover:bg-muted'
                        }`}
                      >
                        {fw === 'nextjs' ? 'Next.js' : fw === 'bun' ? 'Bun' : fw.charAt(0).toUpperCase() + fw.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Package Manager */}
                <div>
                  <span className="block text-xs font-medium text-foreground mb-2">
                    Package Manager *
                    {uiKit === 'tamagui' && (
                      <span className="ml-1 text-muted-foreground font-normal">(Tamagui requires Yarn)</span>
                    )}
                  </span>
                  <div className="grid grid-cols-4 gap-2">
                    {(['npm', 'yarn', 'pnpm', 'bun'] as PackageManager[]).map((pm) => {
                      const isDisabledByTamagui = uiKit === 'tamagui' && pm !== 'yarn';
                      return (
                        <button
                          key={pm}
                          type="button"
                          onClick={() => setPackageManager(pm)}
                          disabled={isDisabledByTamagui}
                          className={`px-3 py-2 text-xs font-medium rounded-md border ${
                            packageManager === pm
                              ? 'bg-primary/10 border-primary text-primary'
                              : 'bg-background border-input text-foreground hover:bg-muted'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          {pm}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* UI Kit */}
                <div>
                  <span className="block text-xs font-medium text-foreground mb-2">UI Kit *</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setUIKit('tamagui');
                        setPackageManager('yarn'); // Tamagui requires yarn
                      }}
                      disabled={framework !== 'nextjs'}
                      className={`px-3 py-2 text-xs font-medium rounded-md border ${
                        uiKit === 'tamagui'
                          ? 'bg-primary/10 border-primary text-primary'
                          : 'bg-background border-input text-foreground hover:bg-muted'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      Tamagui {framework !== 'nextjs' && '(Next.js only)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setUIKit('shadcn')}
                      className={`px-3 py-2 text-xs font-medium rounded-md border ${
                        uiKit === 'shadcn'
                          ? 'bg-primary/10 border-primary text-primary'
                          : 'bg-background border-input text-foreground hover:bg-muted'
                      }`}
                    >
                      ShadCN + Tailwind
                    </button>
                  </div>
                </div>

                {/* Privacy - only for organizations (creating new repos) */}
                {!isPersonalAccount && (
                  <div>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isPrivate}
                        onChange={(e) => setIsPrivate(e.target.checked)}
                        className="rounded border-input"
                      />
                      <span className="text-xs text-foreground">Make repository private</span>
                    </label>
                  </div>
                )}

                {/* Description */}
                <div>
                  <label htmlFor="project-description" className="block text-xs font-medium text-foreground mb-2">
                    Description (optional)
                  </label>
                  <textarea
                    id="project-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="A brief description of your project..."
                    rows={3}
                    className="w-full px-3 py-2 border border-input rounded-md text-sm resize-none"
                  />
                </div>

                {/* Start Button */}
                <button
                  type="button"
                  onClick={handleStartProject}
                  disabled={!canStart}
                  className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                >
                  Start Project Creation
                </button>
              </>
            )}
          </div>
        )}

        {/* Step 2: Creating */}
        {currentStep === 'creating' && (
          <div className="flex flex-col items-center justify-center py-12">
            <IconLoader2 className="w-8 h-8 text-primary animate-spin mb-4" />
            <p className="text-sm text-muted-foreground">Setting up your project...</p>
            <p className="text-xs text-muted-foreground mt-2">This may take a minute</p>
          </div>
        )}

        {/* Step 3: Chatting */}
        {currentStep === 'chatting' && projectPath && (
          <div className="flex flex-col h-full">
            {/* Project Stack Info */}
            <div className="mb-4 p-3 bg-muted/50 rounded-lg border border-border">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-1 bg-background rounded border border-border">
                  <span className="text-muted-foreground">Framework:</span>{' '}
                  <span className="font-medium">{framework}</span>
                </span>
                <span className="px-2 py-1 bg-background rounded border border-border">
                  <span className="text-muted-foreground">UI:</span> <span className="font-medium">{uiKit}</span>
                </span>
                <span className="px-2 py-1 bg-background rounded border border-border">
                  <span className="text-muted-foreground">Package Manager:</span>{' '}
                  <span className="font-medium">{packageManager}</span>
                </span>
              </div>
            </div>

            {/* Reuse AIAgentChat component */}
            {/* Wait for chatId to load when continuing existing project */}
            <div className="flex-1 min-h-0">
              {existingProject && !chatId ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-muted-foreground text-sm">Loading chat history...</div>
                </div>
              ) : (
                <AIAgentChat
                  projectPath={projectPath}
                  projectId={projectId || undefined}
                  initialChatId={chatId}
                  hideSidebar={true}
                  apiEndpoint="/api/ai-agent/project-creation-chat"
                  extraParams={{
                    framework,
                    uiKit,
                    packageManager,
                    description: description.trim() || undefined,
                  }}
                  // Only send initial prompt for new projects, not when continuing
                  initialPrompt={
                    existingProject
                      ? undefined
                      : description.trim()
                        ? `Create a project with ${framework} and ${uiKit}. Description: ${description.trim()}`
                        : `Create a project scaffold with ${framework} and ${uiKit}. Set up the basic structure and essential components.`
                  }
                />
              )}
            </div>

            {/* Finalize Button */}
            <button
              type="button"
              onClick={handleFinalize}
              className="mt-4 w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-sm font-medium"
            >
              Finalize & Commit Project
            </button>
          </div>
        )}

        {/* Step 4: Completed */}
        {currentStep === 'completed' && (
          <div className="flex flex-col items-center justify-center py-12">
            <IconCheck className="w-12 h-12 text-green-600 dark:text-green-400 mb-4" />
            <p className="text-sm font-medium text-foreground mb-2">Project Created Successfully!</p>
            <p className="text-xs text-muted-foreground text-center mb-4">
              Your project has been created and committed to GitHub.
              <br />
              You can now start the Docker container to see it running.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium"
            >
              Go to Projects
            </button>
          </div>
        )}

        {/* Step 5: Error */}
        {currentStep === 'error' && error && (
          <div className="flex flex-col items-center justify-center py-12">
            <IconAlertCircle className="w-12 h-12 text-destructive mb-4" />
            <p className="text-sm font-medium text-foreground mb-2">Creation Failed</p>
            <p className="text-xs text-muted-foreground text-center mb-4">{error}</p>
            <button
              type="button"
              onClick={() => {
                setCurrentStep('setup');
                setError(null);
              }}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
