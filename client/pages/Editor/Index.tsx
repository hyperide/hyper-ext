import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import ProjectSettings from '@/components/ProjectSettings';
import { CanvasEditor } from './CanvasEditor';
import { useAiConfigChecker } from './components/hooks/useAiConfigChecker';
import { useAuthStore } from '@/stores/authStore';
import { authFetch } from '@/utils/authFetch';

export default function Index() {
	const { currentWorkspace } = useAuthStore();
	const [projects, setProjects] = useState<any[]>([]);
	const [loading, setLoading] = useState(true);
	const [showSettings, setShowSettings] = useState(false);
	const [, setAiConfig] = useState<any>(null);
	const [aiConfigChecked, setAiConfigChecked] = useState(false);

	// Check AI config on mount (redirects to workspace settings if missing)
	useAiConfigChecker(setAiConfig, setAiConfigChecked);

	// Check if projects exist (first-run experience)
	useEffect(() => {
		if (!currentWorkspace) return;

		console.log('[Index] Loading projects...');
		authFetch(`/api/projects?workspaceId=${currentWorkspace.id}`)
			.then((res) => {
				if (!res.ok) {
					throw new Error(`HTTP ${res.status}`);
				}
				return res.json();
			})
			.then((data) => {
				console.log('[Index] Loaded projects:', data.length);
				setProjects(data);
				setLoading(false);
			})
			.catch((err) => {
				console.error('Failed to load projects:', err);
				setLoading(false);
			});
	}, [currentWorkspace]);

	const handleOpenSettings = () => {
		setShowSettings(true);
	};

	const handleCloseSettings = () => {
		setShowSettings(false);
		// Reload projects after settings change
		if (!currentWorkspace) return;

		authFetch(`/api/projects?workspaceId=${currentWorkspace.id}`)
			.then((res) => {
				if (!res.ok) return [];
				return res.json();
			})
			.then((data) => setProjects(data))
			.catch((err) => console.error('Failed to reload projects:', err));

		// Reload AI config to check if it was updated
		authFetch(`/api/ai-config?workspaceId=${currentWorkspace.id}`)
			.then((res) => {
				if (!res.ok) return null;
				return res.json();
			})
			.then((data) => {
				if (data?.apiKey && data.apiKey !== '' && data.apiKey !== '...') {
					setAiConfig(data);
				} else {
					setAiConfig(null);
				}
			})
			.catch((err) => {
				console.error('Failed to reload AI config:', err);
			});
	};

	// Show loading state (wait for both projects and AI config check)
	if (loading || !aiConfigChecked) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
			</div>
		);
	}

	// Show settings page if requested
	if (showSettings) {
		return <ProjectSettings onClose={handleCloseSettings} />;
	}

	// Redirect to projects page if no projects
	if (projects.length === 0) {
		return <Navigate to="/projects?expand=clone" replace />;
	}

	// Show canvas editor
	return <CanvasEditor onOpenSettings={handleOpenSettings} />;
}
