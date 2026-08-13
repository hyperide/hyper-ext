import { IconArrowLeft, IconPlayerPlay, IconPlayerStop, IconTrash } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MemoryRouter, useNavigate, useParams } from 'react-router-dom';
import AIAgentChat from '@/components/AIAgentChat';
import { DiagnosticLogsViewer } from '@/components/DiagnosticLogsViewer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDiagnosticSync } from '@/hooks/useDiagnosticSync';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { authFetch } from '@/utils/authFetch';

interface Project {
  id: string;
  name: string;
  path: string;
  devCommand: string;
  installCommand: string;
  port: number;
  internalPort: number;
  framework: string;
  status: 'stopped' | 'building' | 'running' | 'error';
  createdAt: number;
  updatedAt: number;
}

export default function ProjectSettings() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // AI Chat state
  const [isAIAgentOpen, setIsAIAgentOpen] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>();
  const [forceNewChat, setForceNewChat] = useState(false);
  // Commands form state
  const [commandsForm, setCommandsForm] = useState({
    installCommand: '',
    devCommand: '',
  });
  const [commandsSaving, setCommandsSaving] = useState(false);

  useDocumentTitle(project ? `Settings - ${project.name}` : 'Project Settings');

  const { clear: persistedClear } = useDiagnosticSync({ projectId: project?.id, containerStatus: project?.status });

  const handleAutoFix = useCallback((prompt: string) => {
    setIsAIAgentOpen(true);
    setInitialPrompt(prompt);
    setForceNewChat(true);
  }, []);

  // Fetch project data
  const fetchProject = useCallback(async () => {
    if (!id) return;
    try {
      const res = await authFetch(`/api/projects/${id}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setProject(data);
        setCommandsForm({
          installCommand: data.installCommand,
          devCommand: data.devCommand,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [id]);

  // Poll project status without resetting form
  const pollProject = useCallback(async () => {
    if (!id) return;
    try {
      const res = await authFetch(`/api/projects/${id}`);
      const data = await res.json();
      if (!data.error) {
        setProject(data);
        // Don't update commandsForm during polling
      }
    } catch {
      // Silent fail for polling
    }
  }, [id]);

  // Initial load
  useEffect(() => {
    if (!id) return;
    fetchProject().finally(() => setLoading(false));
  }, [id, fetchProject]);

  // Poll for status updates (SSE doesn't work through Cloudflare tunnel)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!id || loading) return;

    // Poll every 3 seconds for status updates
    pollIntervalRef.current = setInterval(() => {
      pollProject();
    }, 3000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [id, loading, pollProject]);

  const handleStart = async () => {
    if (!project) return;
    setActionLoading(true);
    try {
      const res = await authFetch(`/api/docker/start/${project.id}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.error) {
        alert(`Failed to start: ${data.error}`);
      } else {
        // Set to 'building' first - the actual status will be updated via SSE
        setProject((prev) => (prev ? { ...prev, status: 'building' } : prev));
      }
    } catch (err) {
      alert(`Failed to start: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    if (!project) return;
    setActionLoading(true);
    try {
      const res = await authFetch(`/api/docker/stop/${project.id}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.error) {
        alert(`Failed to stop: ${data.error}`);
      } else {
        setProject((prev) => (prev ? { ...prev, status: 'stopped' } : prev));
      }
    } catch (err) {
      alert(`Failed to stop: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!project) return;
    if (!confirm(`Are you sure you want to delete project "${project.name}"?`)) {
      return;
    }

    setActionLoading(true);
    try {
      // Stop container first
      await authFetch(`/api/docker/stop/${project.id}`, {
        method: 'POST',
      });

      // Delete project
      const res = await authFetch(`/api/projects/${project.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.error) {
        alert(`Failed to delete: ${data.error}`);
      } else {
        navigate('/projects');
      }
    } catch (err) {
      alert(`Failed to delete: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setActionLoading(false);
    }
  };

  const isCommandsDirty = () => {
    return (
      project &&
      (commandsForm.installCommand !== project.installCommand || commandsForm.devCommand !== project.devCommand)
    );
  };

  const handleSaveCommands = async () => {
    if (!project) return;
    setCommandsSaving(true);
    try {
      const res = await authFetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installCommand: commandsForm.installCommand,
          devCommand: commandsForm.devCommand,
        }),
      });
      const data = await res.json();
      if (data.error) {
        alert(`Failed to save: ${data.error}`);
      } else {
        setProject(data);
      }
    } catch (err) {
      alert(`Failed to save: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setCommandsSaving(false);
    }
  };

  const handleCancelCommands = () => {
    if (project) {
      setCommandsForm({
        installCommand: project.installCommand,
        devCommand: project.devCommand,
      });
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading project...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="container mx-auto p-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center space-y-4">
            <p className="text-lg text-destructive">{error || 'Project not found'}</p>
            <Button onClick={() => navigate('/projects')}>
              <IconArrowLeft size={16} className="mr-2" />
              Back to Projects
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="ProjectSettingsPage" className="container mx-auto p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/projects')}>
            <IconArrowLeft size={16} />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{project.name}</h1>
            <p className="text-sm text-muted-foreground">{project.path.split('/').pop()}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {project.status === 'running' ? (
            <Button variant="outline" onClick={handleStop} disabled={actionLoading}>
              <IconPlayerStop size={16} className="mr-2" />
              Stop
            </Button>
          ) : (
            <Button variant="outline" onClick={handleStart} disabled={actionLoading}>
              <IconPlayerPlay size={16} className="mr-2" />
              Start
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Project Info</CardTitle>
            <CardDescription>Basic project information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <span className="font-semibold">Framework:</span> {project.framework}
            </div>
            <div>
              <span className="font-semibold">Status:</span>{' '}
              <span
                className={
                  project.status === 'running'
                    ? 'text-green-600 dark:text-green-400'
                    : project.status === 'error'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-muted-foreground'
                }
              >
                {project.status}
              </span>
            </div>
            <div>
              <span className="font-semibold">Port:</span> {project.port} → {project.internalPort}
            </div>
            <div>
              <span className="font-semibold">Created:</span> {new Date(project.createdAt).toLocaleString()}
            </div>
          </CardContent>
        </Card>

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
                value={commandsForm.installCommand}
                onChange={(e) =>
                  setCommandsForm((prev) => ({
                    ...prev,
                    installCommand: e.target.value,
                  }))
                }
                placeholder="npm install"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="devCommand">Dev Command</Label>
              <Input
                id="devCommand"
                value={commandsForm.devCommand}
                onChange={(e) =>
                  setCommandsForm((prev) => ({
                    ...prev,
                    devCommand: e.target.value,
                  }))
                }
                placeholder="npm run dev"
                className="font-mono text-sm"
              />
            </div>
            {isCommandsDirty() && (
              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={handleSaveCommands} disabled={commandsSaving}>
                  {commandsSaving ? 'Saving...' : 'Save'}
                </Button>
                <Button size="sm" variant="outline" onClick={handleCancelCommands} disabled={commandsSaving}>
                  Cancel
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Docker Logs</CardTitle>
          <CardDescription>Real-time container logs</CardDescription>
        </CardHeader>
        <CardContent>
          <DiagnosticLogsViewer height="500px" onAutoFix={handleAutoFix} onClear={persistedClear} />
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>Irreversible actions for this project</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Delete this project</p>
              <p className="text-sm text-muted-foreground">
                Once deleted, the project and all its data cannot be recovered.
              </p>
            </div>
            <Button variant="destructive" onClick={handleDelete} disabled={actionLoading}>
              <IconTrash size={16} className="mr-2" />
              Delete Project
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* AI Agent Chat Modal */}
      {isAIAgentOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="relative w-[800px] h-[600px] rounded-lg border border-border bg-background shadow-xl">
            <button
              type="button"
              onClick={() => setIsAIAgentOpen(false)}
              className="absolute top-2 right-2 z-10 p-1 hover:bg-muted rounded"
            >
              ✕
            </button>
            <AIAgentChat
              projectPath={project.path}
              projectId={project.id}
              initialPrompt={initialPrompt}
              forceNewChat={forceNewChat}
              onPromptSent={() => {
                setInitialPrompt(undefined);
                setForceNewChat(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export const SampleDefault = () => {
  return (
    <MemoryRouter>
      <div style={{ padding: '20px', border: '2px solid #ccc', borderRadius: '8px', maxWidth: '600px' }}>
        <h3>ProjectSettings Component</h3>
        <p>This component provides project management interface including:</p>
        <ul>
          <li>Project configuration settings</li>
          <li>Docker container management</li>
          <li>Real-time logs viewer</li>
          <li>Start/stop controls</li>
          <li>Project deletion</li>
        </ul>
        <div style={{ marginTop: '20px', padding: '10px', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
          <strong>Sample Project:</strong>
          <div style={{ marginTop: '10px' }}>
            <p>My React App</p>
            <p>
              Status: <span style={{ color: 'green' }}>Running</span>
            </p>
            <p>Port: 3000</p>
          </div>
        </div>
      </div>
    </MemoryRouter>
  );
};
