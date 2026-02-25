import { useState, useCallback, useEffect } from 'react';
import {
	IconBrandGithub,
	IconSearch,
	IconSettings,
	IconPlus,
	IconLock,
	IconWorld,
	IconArrowRight,
	IconAlertTriangle,
	IconExternalLink,
	IconCopy,
} from '@tabler/icons-react';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import { useAuthStore } from '@/stores/authStore';
import { authFetch } from '@/utils/authFetch';
import { useGitHubOrganizations } from './hooks/useGitHubOrganizations';
import { useGitHubRepositories } from './hooks/useGitHubRepositories';
import { useGitHubAppInstallations } from './hooks/useGitHubAppInstallations';
import { GitHubAppConnect } from './GitHubAppConnect';
import type { GitHubRepository, CreateRepoData, GitHubAppInstallation } from './types';

interface GitHubRepoModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSelect: (repo: GitHubRepository) => void;
	onCreate: (repo: GitHubRepository) => void;
}

export function GitHubRepoModal({
	open,
	onOpenChange,
	onSelect,
	onCreate,
}: GitHubRepoModalProps) {
	const [activeTab, setActiveTab] = useState<'select' | 'create'>('select');
	const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState('');
	const [debouncedSearch, setDebouncedSearch] = useState('');
	const { accessToken } = useAuthStore();

	// Debounce search query
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(searchQuery);
		}, 300);
		return () => clearTimeout(timer);
	}, [searchQuery]);

	const {
		organizations,
		user,
		loading: orgsLoading,
		refetch: refetchOrgs,
	} = useGitHubOrganizations();

	const {
		repositories,
		existingProjectIds,
		loading: reposLoading,
		hasMore,
		loadMore,
	} = useGitHubRepositories({
		org: selectedOrg,
		search: debouncedSearch,
		enabled: open,
	});

	const {
		installations,
		getInstallUrl,
		refetch: refetchInstallations,
	} = useGitHubAppInstallations();

	// Reset state when modal opens
	useEffect(() => {
		if (open) {
			setSearchQuery('');
			setDebouncedSearch('');
			refetchOrgs();
		}
	}, [open, refetchOrgs]);

	const handleReconnect = useCallback(() => {
		// Save current location for redirect after OAuth
		sessionStorage.setItem(
			'auth_redirect',
			window.location.pathname + window.location.search,
		);
		// Redirect to GitHub OAuth (will link account if same email)
		window.location.href = '/api/auth/github';
	}, []);

	const handleConnectGitHubApp = useCallback(async () => {
		const url = await getInstallUrl();
		if (url) {
			window.open(url, '_blank');
		}
	}, [getInstallUrl]);

	// Refetch installations when window regains focus (user may have completed installation)
	useEffect(() => {
		const handleFocus = () => {
			refetchInstallations();
		};
		window.addEventListener('focus', handleFocus);
		return () => window.removeEventListener('focus', handleFocus);
	}, [refetchInstallations]);

	const handleSelectRepo = useCallback(
		(repo: GitHubRepository) => {
			onSelect(repo);
			onOpenChange(false);
		},
		[onSelect, onOpenChange],
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
				<DialogHeader className="flex-shrink-0">
					<div className="flex items-center justify-between">
						<DialogTitle className="flex items-center gap-2">
							<IconBrandGithub className="w-5 h-5" />
							GitHub Repositories
						</DialogTitle>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="icon" className="mr-6">
									<IconSettings className="w-4 h-4" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem onClick={handleConnectGitHubApp}>
									Connect GitHub App for private repos
								</DropdownMenuItem>
								<DropdownMenuItem onClick={handleReconnect}>
									Re-authorize GitHub
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</DialogHeader>

				<GitHubAppConnect className="mb-4" />

				<Tabs
					value={activeTab}
					onValueChange={(v) => setActiveTab(v as 'select' | 'create')}
					className="flex-1 flex flex-col min-h-0"
				>
					<div className="flex items-center gap-3 mb-4 flex-shrink-0">
						<TabsList>
							<TabsTrigger value="select">Repositories</TabsTrigger>
							<TabsTrigger value="create">
								<IconPlus className="w-4 h-4 mr-1" />
								Create New
							</TabsTrigger>
						</TabsList>

						{activeTab === 'select' && (
							<>
								<div className="relative flex-1">
									<IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
									<Input
										placeholder="Search repositories..."
										value={searchQuery}
										onChange={(e) => setSearchQuery(e.target.value)}
										className="pl-9"
									/>
								</div>

								<Select
									value={selectedOrg ?? 'all'}
									onValueChange={(v) => setSelectedOrg(v === 'all' ? null : v)}
								>
									<SelectTrigger className="w-[180px]">
										<SelectValue placeholder="All Organizations" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">All Organizations</SelectItem>
										{user && (
											<SelectItem value="personal">
												<div className="flex items-center gap-2">
													<Avatar className="w-4 h-4">
														<AvatarImage src={user.avatar_url} />
														<AvatarFallback>{user.login[0]}</AvatarFallback>
													</Avatar>
													{user.login}
												</div>
											</SelectItem>
										)}
										{organizations.map((org) => (
											<SelectItem key={org.id} value={org.login}>
												<div className="flex items-center gap-2">
													<Avatar className="w-4 h-4">
														<AvatarImage src={org.avatar_url} />
														<AvatarFallback>{org.login[0]}</AvatarFallback>
													</Avatar>
													{org.login}
												</div>
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</>
						)}
					</div>

					<TabsContent value="select" className="flex-1 min-h-0 mt-0">
						<RepoList
							repositories={repositories}
							existingProjectIds={existingProjectIds}
							loading={reposLoading || orgsLoading}
							hasMore={hasMore}
							onSelect={handleSelectRepo}
							onLoadMore={loadMore}
						/>
					</TabsContent>

					<TabsContent value="create" className="flex-1 min-h-0 mt-0">
						<CreateRepoForm
							organizations={organizations}
							user={user}
							onCreate={(repo) => {
								onCreate(repo);
								onOpenChange(false);
							}}
							accessToken={accessToken}
							installations={installations}
							getInstallUrl={getInstallUrl}
							onInstallationAdded={refetchInstallations}
						/>
					</TabsContent>
				</Tabs>
			</DialogContent>
		</Dialog>
	);
}

// RepoList component
interface RepoListProps {
	repositories: GitHubRepository[];
	existingProjectIds: Record<string, string>;
	loading: boolean;
	hasMore: boolean;
	onSelect: (repo: GitHubRepository) => void;
	onLoadMore: () => void;
}

function RepoList({
	repositories,
	existingProjectIds,
	loading,
	hasMore,
	onSelect,
	onLoadMore,
}: RepoListProps) {
	if (loading && repositories.length === 0) {
		return (
			<div className="space-y-2">
				{[...Array(5)].map((_, i) => (
					<div
						key={i}
						className="flex items-center gap-3 p-3 rounded-md border"
					>
						<Skeleton className="w-8 h-8 rounded-full" />
						<div className="flex-1 space-y-2">
							<Skeleton className="h-4 w-48" />
							<Skeleton className="h-3 w-72" />
						</div>
					</div>
				))}
			</div>
		);
	}

	if (repositories.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
				<IconBrandGithub className="w-12 h-12 mb-2 opacity-50" />
				<p>No repositories found</p>
			</div>
		);
	}

	return (
		<ScrollArea className="h-[400px]">
			<div className="space-y-2 pr-4">
				{repositories.map((repo) => {
					const projectId = existingProjectIds?.[repo.full_name];
					const isImported = Boolean(projectId);

					return (
						<div
							key={repo.id}
							className="flex items-center gap-3 p-3 rounded-md border hover:bg-accent/50 transition-colors"
						>
							<Avatar className="w-8 h-8">
								<AvatarImage src={repo.owner.avatar_url} />
								<AvatarFallback>{repo.owner.login[0]}</AvatarFallback>
							</Avatar>

							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2">
									<span className="font-medium truncate">{repo.full_name}</span>
									{isImported && (
										<Badge variant="secondary" className="text-xs">
											<IconArrowRight className="w-3 h-3 mr-1" />
											Project Exists
										</Badge>
									)}
								</div>
								<p className="text-sm text-muted-foreground truncate">
									{repo.description || '—'}
								</p>
							</div>

							<Badge variant={repo.private ? 'outline' : 'secondary'}>
								{repo.private ? (
									<>
										<IconLock className="w-3 h-3 mr-1" />
										Private
									</>
								) : (
									<>
										<IconWorld className="w-3 h-3 mr-1" />
										Public
									</>
								)}
							</Badge>

							<Button
								variant={isImported ? 'outline' : 'default'}
								size="sm"
								onClick={() => onSelect(repo)}
							>
								{isImported ? 'Open' : 'Select'}
							</Button>
						</div>
					);
				})}

				{hasMore && (
					<Button
						variant="ghost"
						className="w-full"
						onClick={onLoadMore}
						disabled={loading}
					>
						{loading ? 'Loading...' : 'Load more'}
					</Button>
				)}
			</div>
		</ScrollArea>
	);
}

// CreateRepoForm component
interface CreateRepoFormProps {
	organizations: Array<{ id: number; login: string; avatar_url: string }>;
	user: { login: string; avatar_url: string } | null;
	onCreate: (repo: GitHubRepository) => void;
	accessToken: string | null;
	installations: GitHubAppInstallation[];
	getInstallUrl: () => Promise<string | null>;
	onInstallationAdded: () => Promise<void>;
}

function CreateRepoForm({
	organizations,
	user,
	onCreate,
	accessToken,
	installations,
	getInstallUrl,
	onInstallationAdded,
}: CreateRepoFormProps) {
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [isPrivate, setIsPrivate] = useState(true);
	const [selectedOrg, setSelectedOrg] = useState<string>('personal');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [installUrl, setInstallUrl] = useState<string | null>(null);
	const [showInstallPrompt, setShowInstallPrompt] = useState(false);

	// Determine if the selected owner has GitHub App installed
	const selectedOwner = selectedOrg === 'personal' ? user?.login : selectedOrg;
	const hasInstallation = selectedOwner
		? installations.some(
				(inst) =>
					inst.accountLogin.toLowerCase() === selectedOwner.toLowerCase() &&
					!inst.suspendedAt,
			)
		: false;

	// Fetch install URL when needed
	const handleInstallApp = useCallback(async () => {
		const url = await getInstallUrl();
		if (url) {
			window.open(url, '_blank');
		}
	}, [getInstallUrl]);

	// Listen for installation completion (user returns from GitHub)
	useEffect(() => {
		const handleFocus = () => {
			// Refetch installations when window regains focus (user may have completed installation)
			onInstallationAdded();
		};
		window.addEventListener('focus', handleFocus);
		return () => window.removeEventListener('focus', handleFocus);
	}, [onInstallationAdded]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!name.trim()) {
			setError('Repository name is required');
			return;
		}

		setLoading(true);
		setError(null);
		setShowInstallPrompt(false);

		try {
			const body: CreateRepoData = {
				name: name.trim(),
				description: description.trim() || undefined,
				isPrivate,
				org: selectedOrg === 'personal' ? undefined : selectedOrg,
			};

			const response = await authFetch('/api/github/create-repo', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});

			if (!response.ok) {
				// Try to parse error response as JSON, fallback to generic error
				let errorData: { code?: string; error?: string; installUrl?: string } | undefined;
				try {
					errorData = await response.json();
				} catch {
					if (response.status === 401) {
						setError('Session expired. Please refresh the page.');
						return;
					}
					throw new Error('Failed to create repository');
				}

				// Handle GitHub App not installed error
				if (errorData?.code === 'GITHUB_APP_NOT_INSTALLED') {
					setShowInstallPrompt(true);
					setInstallUrl(errorData.installUrl);
					setError(null);
					return;
				}
				throw new Error(errorData?.error || 'Failed to create repository');
			}

			const data = await response.json();
			onCreate(data.repository);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Unknown error');
		} finally {
			setLoading(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<div className="space-y-2">
				<Label htmlFor="repo-owner">Owner</Label>
				<Select value={selectedOrg} onValueChange={setSelectedOrg}>
					<SelectTrigger id="repo-owner">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{user && (
							<SelectItem value="personal">
								<div className="flex items-center gap-2">
									<Avatar className="w-4 h-4">
										<AvatarImage src={user.avatar_url} />
										<AvatarFallback>{user.login[0]}</AvatarFallback>
									</Avatar>
									{user.login}
								</div>
							</SelectItem>
						)}
						{organizations.map((org) => (
							<SelectItem key={org.id} value={org.login}>
								<div className="flex items-center gap-2">
									<Avatar className="w-4 h-4">
										<AvatarImage src={org.avatar_url} />
										<AvatarFallback>{org.login[0]}</AvatarFallback>
									</Avatar>
									{org.login}
								</div>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="space-y-2">
				<Label htmlFor="repo-name">Repository name</Label>
				<Input
					id="repo-name"
					placeholder="my-awesome-project"
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
			</div>

			<div className="space-y-2">
				<Label htmlFor="repo-description">Description (optional)</Label>
				<Input
					id="repo-description"
					placeholder="A short description of your project"
					value={description}
					onChange={(e) => setDescription(e.target.value)}
				/>
			</div>

			<div className="flex items-center justify-between">
				<div className="space-y-0.5">
					<Label htmlFor="repo-private">Private repository</Label>
					<p className="text-sm text-muted-foreground">
						Only you and collaborators can see this repository
					</p>
				</div>
				<Switch
					id="repo-private"
					checked={isPrivate}
					onCheckedChange={setIsPrivate}
				/>
			</div>

			{/* Show install prompt when GitHub App is not installed */}
			{(showInstallPrompt || !hasInstallation) && selectedOwner && (
				<Alert className="border-amber-500/50 bg-amber-500/10">
					<IconAlertTriangle className="h-4 w-4 text-amber-500" />
					<AlertDescription className="space-y-3">
						<p>
							GitHub App not installed for <strong>{selectedOwner}</strong>
						</p>
						<p className="text-sm text-muted-foreground">
							To create repositories, please install the HyperIDE GitHub App.
						</p>
						<div className="flex gap-2">
							<Button
								type="button"
								size="sm"
								onClick={handleInstallApp}
							>
								<IconExternalLink className="mr-1 h-3 w-3" />
								Install GitHub App
							</Button>
							{installUrl && (
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => {
										navigator.clipboard.writeText(installUrl);
									}}
								>
									<IconCopy className="mr-1 h-3 w-3" />
									Copy link for admin
								</Button>
							)}
						</div>
					</AlertDescription>
				</Alert>
			)}

			{error && <p className="text-sm text-destructive">{error}</p>}

			<Button
				type="submit"
				className="w-full"
				disabled={loading || !name.trim() || !hasInstallation}
			>
				{loading ? 'Creating...' : 'Create repository'}
			</Button>
		</form>
	);
}

export default GitHubRepoModal;
