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
      <div data-uniq-id="ed473358-fe81-4aed-88c1-db1a506251e4" className="container mx-auto p-8">
        <div
          data-uniq-id="dc2d4065-b5bb-4833-8dd1-e0fe17ee8526"
          className="flex items-center justify-center min-h-[400px]"
        >
          <div data-uniq-id="62c84ce8-8bd4-4095-87a2-e72343efadb7" className="text-center">
            <div
              data-uniq-id="d3e9323b-a8e9-4648-9f7a-86953a12dbef"
              className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"
            />
            <p data-uniq-id="2a39aa80-ee2a-4a79-b08a-0dfb8ed2658a" className="text-muted-foreground">
              Loading project...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div data-uniq-id="18bdaae9-fde5-41d6-9e5d-22a3ff6a48e7" className="container mx-auto p-8">
        <div
          data-uniq-id="8b051a13-3374-4cb8-8982-9f0b5e9c7dc2"
          className="flex items-center justify-center min-h-[400px]"
        >
          <div data-uniq-id="4657dec5-a6b6-4d59-9e77-25571a5374cc" className="text-center space-y-4">
            <p data-uniq-id="ba5cd042-4a44-4885-a0b3-3f774792de77" className="text-lg text-destructive">
              {error || 'Project not found'}
            </p>
            <Button data-uniq-id="7f6b5a1c-cd27-4868-910f-d189790330f8" onClick={() => navigate('/projects')}>
              <IconArrowLeft data-uniq-id="693f3eaa-fd36-49ba-a0ef-3b23b6284568" size={16} className="mr-2" />
              Back to Projects
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-uniq-id="56165b69-acae-4d4b-b563-07976721e1a2" className="container mx-auto p-8 space-y-6">
      <div data-uniq-id="af50f324-d55d-40c4-9a47-626fcf512c73" className="flex items-center justify-between">
        <div data-uniq-id="156cf6a2-a407-40b4-bbae-8cc8574d6a9d" className="flex items-center gap-4">
          <Button
            data-uniq-id="f49d8d86-62fc-4575-8026-2b7fa3117ca0"
            variant="ghost"
            size="sm"
            onClick={() => navigate('/projects')}
          >
            <IconArrowLeft data-uniq-id="20d724e5-6b8a-45aa-b9d0-9cc3dcf2bae4" size={16} />
          </Button>
          <div data-uniq-id="6e8c75b4-90dd-452b-b776-d74ab41dfaf2">
            <h1 data-uniq-id="c72ccdb2-4068-4d41-aed5-b4f4d73386da" className="text-3xl font-bold">
              {project.name}
            </h1>
            <p data-uniq-id="20b48a2b-cb16-4e63-8487-85c980894152" className="text-sm text-muted-foreground">
              {project.path.split('/').pop()}
            </p>
          </div>
        </div>
        <div data-uniq-id="d5e84337-40c7-4a96-8732-4787cf42bcb7" className="flex items-center gap-2">
          {project.status === 'running' ? (
            <Button
              data-uniq-id="ae4598d9-8888-4ef4-b027-9da713c11915"
              variant="outline"
              onClick={handleStop}
              disabled={actionLoading}
            >
              <IconPlayerStop data-uniq-id="0092457e-9c0e-4304-9b5f-8a7b2ca1a742" size={16} className="mr-2" />
              Stop
            </Button>
          ) : (
            <Button
              data-uniq-id="83e62709-451f-496a-801b-b7612f6f9a1a"
              variant="outline"
              onClick={handleStart}
              disabled={actionLoading}
            >
              <IconPlayerPlay data-uniq-id="2587e5d2-d922-4636-bd67-57badcf6c046" size={16} className="mr-2" />
              Start
            </Button>
          )}
        </div>
      </div>
      <div data-uniq-id="fb7d67c9-6edd-4469-b226-8a0527a79824" className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card data-uniq-id="46831d78-5dcd-4681-a842-626c88196e61">
          <CardHeader data-uniq-id="2c7d0406-8d60-448f-afaf-c781344e19b4">
            <CardTitle data-uniq-id="c8bc3a34-54d5-430e-8576-bc550c58f39d">Project Info</CardTitle>
            <CardDescription data-uniq-id="d84484e8-1f36-4838-a2bb-30d327b41c8a">
              Basic project information
            </CardDescription>
          </CardHeader>
          <CardContent data-uniq-id="5eee956a-26e3-464b-a4b5-8acbcb6becf2" className="space-y-2">
            <div data-uniq-id="6ead3905-c07c-4dd6-baac-3d0b98ac7b03">
              <span data-uniq-id="cb1e3ffe-aa20-499d-ba8e-1c7e5bee79a8" className="font-semibold">
                Framework:
              </span>{' '}
              {project.framework}
            </div>
            <div data-uniq-id="f0695f12-0c2d-476f-8670-f89b72e249b9">
              <span data-uniq-id="7e45588d-62dd-41f8-b533-9e5c8a02493b" className="font-semibold">
                Status:
              </span>{' '}
              <span
                data-uniq-id="d90cbee4-92cb-4f76-ab35-b152f8f793bb"
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
            <div data-uniq-id="d0994d50-5b35-4a1e-a26a-68740d13ff3d">
              <span data-uniq-id="7747025a-feea-4282-80b9-19e0298d1e22" className="font-semibold">
                Port:
              </span>{' '}
              {project.port} → {project.internalPort}
            </div>
            <div data-uniq-id="865f78a4-7585-4284-a3d2-7c3b532dfdd5">
              <span data-uniq-id="0da2582c-f8bd-476e-bc4a-6edb9a467362" className="font-semibold">
                Created:
              </span>{' '}
              {new Date(project.createdAt).toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card data-uniq-id="7d8520fa-c686-400c-bfbf-a7a926c442a0">
          <CardHeader data-uniq-id="ee586ab9-2553-4fa8-b1eb-7338087c6ce0">
            <CardTitle data-uniq-id="c5d71b6d-7017-478d-8b58-210baec8f65c">Commands</CardTitle>
            <CardDescription data-uniq-id="75bf0a82-9c58-4020-aa17-d61ccd5fc985">
              Docker commands for this project
            </CardDescription>
          </CardHeader>
          <CardContent data-uniq-id="41b93288-bb98-46f2-967e-8f4a229b6179" className="space-y-4">
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
      <Card data-uniq-id="fa4bd2fa-7e38-482b-838c-bf57826ce38e">
        <CardHeader data-uniq-id="68b1c6c7-abb9-45e6-82e9-ea1f72c2a281">
          <CardTitle data-uniq-id="8e02ff81-a0e7-45a1-9060-018d3748a1af">Docker Logs</CardTitle>
          <CardDescription data-uniq-id="35591d92-f8f0-447f-96c7-df909ff195d3">
            Real-time container logs
          </CardDescription>
        </CardHeader>
        <CardContent data-uniq-id="7b3bd749-b9f7-4865-a82d-18ec58b06f5d">
          <DiagnosticLogsViewer
            data-uniq-id="91dd0388-0e9f-4988-8e26-0937bc7c0b74"
            height="500px"
            onAutoFix={handleAutoFix}
            onClear={persistedClear}
          />
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
