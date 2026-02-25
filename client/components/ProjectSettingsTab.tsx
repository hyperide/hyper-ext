import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PathInput } from './PathInput';
import { PathArrayInput } from './PathArrayInput';
import { useAuthStore } from '@/stores/authStore';
import { authFetch } from '@/utils/authFetch';

interface Project {
	id: string;
	name: string;
	path: string;
	publicDir: string | null;
	atomComponentsPaths: string[] | null;
	compositeComponentsPaths: string[] | null;
	pagesPaths: string[] | null;
	textComponentPath: string | null;
	linkComponentPath: string | null;
	buttonComponentPath: string | null;
	imageComponentPath: string | null;
	containerComponentPath: string | null;
	devCommand: string | null;
	installCommand: string | null;
	port: number | null;
	internalPort: number | null;
}

interface FormState {
	publicDir: string | null;
	atomComponentsPaths: string[];
	compositeComponentsPaths: string[];
	pagesPaths: string[];
	textComponentPath: string | null;
	linkComponentPath: string | null;
	buttonComponentPath: string | null;
	imageComponentPath: string | null;
	containerComponentPath: string | null;
	devCommand: string | null;
	installCommand: string | null;
}

function projectToFormState(project: Project): FormState {
	return {
		publicDir: project.publicDir,
		atomComponentsPaths: project.atomComponentsPaths || [],
		compositeComponentsPaths: project.compositeComponentsPaths || [],
		pagesPaths: project.pagesPaths || [],
		textComponentPath: project.textComponentPath,
		linkComponentPath: project.linkComponentPath,
		buttonComponentPath: project.buttonComponentPath,
		imageComponentPath: project.imageComponentPath,
		containerComponentPath: project.containerComponentPath,
		devCommand: project.devCommand,
		installCommand: project.installCommand,
	};
}

function formStateToUpdates(formState: FormState): Partial<Project> {
	return {
		publicDir: formState.publicDir,
		atomComponentsPaths: formState.atomComponentsPaths.length > 0 ? formState.atomComponentsPaths.filter(Boolean) : null,
		compositeComponentsPaths: formState.compositeComponentsPaths.length > 0 ? formState.compositeComponentsPaths.filter(Boolean) : null,
		pagesPaths: formState.pagesPaths.length > 0 ? formState.pagesPaths.filter(Boolean) : null,
		textComponentPath: formState.textComponentPath,
		linkComponentPath: formState.linkComponentPath,
		buttonComponentPath: formState.buttonComponentPath,
		imageComponentPath: formState.imageComponentPath,
		containerComponentPath: formState.containerComponentPath,
		devCommand: formState.devCommand,
		installCommand: formState.installCommand,
	};
}

export default function ProjectSettingsTab() {
	const { accessToken } = useAuthStore();
	const [project, setProject] = useState<Project | null>(null);
	const [formState, setFormState] = useState<FormState | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [reindexing, setReindexing] = useState(false);
	const [message, setMessage] = useState<{
		type: 'success' | 'error';
		text: string;
	} | null>(null);
	const [isSubscribed, setIsSubscribed] = useState(false);
	const [subscriptionLoading, setSubscriptionLoading] = useState(false);

	const isDirty = useCallback(() => {
		if (!project || !formState) return false;
		const original = projectToFormState(project);
		return JSON.stringify(original) !== JSON.stringify(formState);
	}, [project, formState]);

	useEffect(() => {
		loadProject();
	}, [accessToken]);

	const loadSubscriptionStatus = useCallback(async (projectId: string) => {
		try {
			const response = await authFetch(`/api/projects/${projectId}/subscription`);
			if (response.ok) {
				const data = await response.json();
				setIsSubscribed(data.subscribed);
			}
		} catch (error) {
			console.error('Failed to load subscription status:', error);
		}
	}, []);

	// Load subscription status when project loads
	useEffect(() => {
		if (project?.id) {
			loadSubscriptionStatus(project.id);
		}
	}, [project?.id, loadSubscriptionStatus]);

	const handleSubscriptionToggle = async (checked: boolean) => {
		if (!project) return;

		setSubscriptionLoading(true);
		try {
			const response = await authFetch(`/api/projects/${project.id}/subscribe`, {
				method: checked ? 'POST' : 'DELETE',
			});

			if (response.ok) {
				setIsSubscribed(checked);
			} else {
				const error = await response.json();
				console.error('Failed to update subscription:', error);
			}
		} catch (error) {
			console.error('Failed to update subscription:', error);
		} finally {
			setSubscriptionLoading(false);
		}
	};

	const loadProject = async () => {
		try {
			const response = await authFetch('/api/projects/active');
			if (response.ok) {
				const data = await response.json();
				setProject(data);
				setFormState(projectToFormState(data));
			} else {
				setProject(null);
				setFormState(null);
			}
		} catch (error) {
			console.error('Failed to load active project:', error);
			setProject(null);
			setFormState(null);
		} finally {
			setLoading(false);
		}
	};

	const handleSave = async () => {
		if (!project || !formState) return;

		setSaving(true);
		setMessage(null);

		try {
			const updates = formStateToUpdates(formState);
			const response = await authFetch(`/api/projects/${project.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(updates),
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.error || 'Failed to save settings');
			}

			const updatedProject = await response.json();
			setProject(updatedProject);
			setFormState(projectToFormState(updatedProject));
			setMessage({
				type: 'success',
				text: 'Settings saved successfully!',
			});
		} catch (error) {
			console.error('Save error:', error);
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to save settings',
			});
		} finally {
			setSaving(false);
		}
	};

	const handleCancel = () => {
		if (project) {
			setFormState(projectToFormState(project));
			setMessage(null);
		}
	};

	const handleReindex = async () => {
		if (!project) return;

		setReindexing(true);
		setMessage(null);

		try {
			const response = await authFetch(`/api/projects/${project.id}/reindex`, {
				method: 'POST',
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.error || 'Failed to re-index project');
			}

			const updatedProject = await response.json();
			setProject(updatedProject);
			setFormState(projectToFormState(updatedProject));
			setMessage({
				type: 'success',
				text: 'Project components re-indexed successfully!',
			});
		} catch (error) {
			console.error('Re-index error:', error);
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to re-index project',
			});
		} finally {
			setReindexing(false);
		}
	};

	if (loading) {
		return <div className="text-center py-12">Loading project settings...</div>;
	}

	if (!project || !formState) {
		return (
			<Card>
				<CardContent className="py-12 text-center">
					<p className="text-destructive">No active project found</p>
					<p className="text-sm text-muted-foreground mt-2">
						Please open a project first.
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
	<>
		<div className="space-y-6">
			{/* Row 1: Project Info + Commands */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				{/* Project Info */}
				<Card>
					<CardHeader>
						<CardTitle>Project Info</CardTitle>
						<CardDescription>Basic project information</CardDescription>
					</CardHeader>
					<CardContent className="space-y-2">
						<div>
							<span className="font-semibold">Name:</span>{' '}
							{project.name}
						</div>
						<div>
							<span className="font-semibold">Path:</span>{' '}
							<span className="font-mono text-sm text-muted-foreground">{project.path}</span>
						</div>
						{project.port && project.internalPort && (
							<div>
								<span className="font-semibold">Port:</span>{' '}
								{project.port} → {project.internalPort}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Commands */}
				<Card>
					<CardHeader>
						<CardTitle>Commands</CardTitle>
						<CardDescription>Docker commands for this project</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="installCommand">Install Command</Label>
							<Input
								id="installCommand"
								value={formState.installCommand || ''}
								onChange={(e) => setFormState(prev => prev ? { ...prev, installCommand: e.target.value } : null)}
								placeholder="npm install"
								className="font-mono text-sm"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="devCommand">Dev Command</Label>
							<Input
								id="devCommand"
								value={formState.devCommand || ''}
								onChange={(e) => setFormState(prev => prev ? { ...prev, devCommand: e.target.value } : null)}
								placeholder="npm run dev"
								className="font-mono text-sm"
							/>
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Assets */}
			<Card>
				<CardHeader>
					<CardTitle>Assets</CardTitle>
					<CardDescription>Directory for static assets (images, fonts, etc.)</CardDescription>
				</CardHeader>
				<CardContent>
					<PathInput
						label="Public Directory"
						value={formState.publicDir}
						onChange={(path) => setFormState(prev => prev ? { ...prev, publicDir: path } : null)}
						placeholder="e.g., public"
					/>
				</CardContent>
			</Card>

			{/* Component Directories */}
			<Card>
				<CardHeader>
					<CardTitle>Component Directories</CardTitle>
					<CardDescription>Configure where your components are located</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<PathArrayInput
						label="Atom Components"
						description="Directories containing small, reusable UI components"
						value={formState.atomComponentsPaths}
						onChange={(paths) => setFormState(prev => prev ? { ...prev, atomComponentsPaths: paths } : null)}
						placeholder="e.g., src/components/atoms"
					/>
					<PathArrayInput
						label="Composite Components"
						description="Directories containing composed/complex components"
						value={formState.compositeComponentsPaths}
						onChange={(paths) => setFormState(prev => prev ? { ...prev, compositeComponentsPaths: paths } : null)}
						placeholder="e.g., src/components/composite"
					/>
					<PathArrayInput
						label="Pages"
						description="Directories containing page components"
						value={formState.pagesPaths}
						onChange={(paths) => setFormState(prev => prev ? { ...prev, pagesPaths: paths } : null)}
						placeholder="e.g., src/pages"
					/>
				</CardContent>
			</Card>

			{/* Toolbar UI Components */}
			<Card>
				<CardHeader>
					<CardTitle>Toolbar UI Components</CardTitle>
					<CardDescription>Paths to components used in the toolbar for quick insertion</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid grid-cols-2 gap-4">
						<PathInput
							label="Container"
							value={formState.containerComponentPath}
							onChange={(path) => setFormState(prev => prev ? { ...prev, containerComponentPath: path } : null)}
							placeholder="e.g., src/ui/Box.tsx"
						/>
						<PathInput
							label="Text"
							value={formState.textComponentPath}
							onChange={(path) => setFormState(prev => prev ? { ...prev, textComponentPath: path } : null)}
							placeholder="e.g., src/ui/Text.tsx"
						/>
						<PathInput
							label="Link"
							value={formState.linkComponentPath}
							onChange={(path) => setFormState(prev => prev ? { ...prev, linkComponentPath: path } : null)}
							placeholder="e.g., src/ui/Link.tsx"
						/>
						<PathInput
							label="Button"
							value={formState.buttonComponentPath}
							onChange={(path) => setFormState(prev => prev ? { ...prev, buttonComponentPath: path } : null)}
							placeholder="e.g., src/ui/Button.tsx"
						/>
						<PathInput
							label="Image"
							value={formState.imageComponentPath}
							onChange={(path) => setFormState(prev => prev ? { ...prev, imageComponentPath: path } : null)}
							placeholder="e.g., src/ui/Image.tsx"
						/>
					</div>
				</CardContent>
			</Card>

			{/* Notifications */}
			<Card>
				<CardHeader>
					<CardTitle>Notifications</CardTitle>
					<CardDescription>Configure notification preferences</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex items-center justify-between">
						<div className="space-y-0.5">
							<Label htmlFor="notifications-toggle">Comment notifications</Label>
							<p className="text-xs text-muted-foreground">
								Receive notifications when someone comments on this project
							</p>
						</div>
						<Switch
							id="notifications-toggle"
							checked={isSubscribed}
							onCheckedChange={handleSubscriptionToggle}
							disabled={subscriptionLoading}
						/>
					</div>
				</CardContent>
			</Card>

			{/* Message */}
			{message && (
				<div
					className={`p-3 rounded-md text-sm ${
						message.type === 'success'
							? 'bg-green-500/10 text-green-600 dark:text-green-400'
							: 'bg-destructive/10 text-destructive'
					}`}
				>
					{message.text}
				</div>
			)}
		</div>

		{/* Actions — sticky footer */}
		<div className="sticky bottom-0 bg-background border-t pt-4 pb-2 mt-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Button onClick={handleSave} disabled={saving || !isDirty()}>
						{saving ? 'Saving...' : 'Save Changes'}
					</Button>
					<Button variant="outline" onClick={handleCancel} disabled={!isDirty()}>
						Cancel
					</Button>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="secondary" onClick={handleReindex} disabled={reindexing}>
						{reindexing ? 'Re-indexing...' : 'Re-index with AI'}
					</Button>
				</div>
			</div>
		</div>
	</>
	);
}
