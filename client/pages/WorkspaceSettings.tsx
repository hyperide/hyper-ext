import {
  IconArrowLeft,
  IconCheck,
  IconCopy,
  IconCrown,
  IconMail,
  IconTrash,
  IconUserPlus,
  IconX,
} from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AISettings from '@/components/AISettings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthStore } from '@/stores/authStore';
import { authFetch } from '@/utils/authFetch';

interface Member {
  id: string;
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  user: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
  };
}

interface Invite {
  id: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
  createdAt: string;
  expiresAt: string;
}

export default function WorkspaceSettings() {
  const navigate = useNavigate();
  const { currentWorkspace, checkAuth, accessToken, user } = useAuthStore();

  // General settings state
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Members state
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (currentWorkspace) {
      setName(currentWorkspace.name);
    }
  }, [currentWorkspace]);

  // Load members
  const loadMembers = useCallback(async () => {
    if (!currentWorkspace || !accessToken) return;

    try {
      const response = await authFetch(`/api/workspaces/${currentWorkspace.id}/members`);
      if (!response.ok) throw new Error('Failed to load members');

      const data = await response.json();
      setMembers(data.members || []);
    } catch (err) {
      console.error('Failed to load members:', err);
    } finally {
      setMembersLoading(false);
    }
  }, [currentWorkspace, accessToken]);

  // Load invites
  const loadInvites = useCallback(async () => {
    if (!currentWorkspace || !accessToken) return;

    try {
      const response = await authFetch(`/api/workspaces/${currentWorkspace.id}/invites`);
      if (!response.ok) return; // Admin only, may fail for non-admins

      const data = await response.json();
      setInvites(data.invites || []);
    } catch (err) {
      console.error('Failed to load invites:', err);
    }
  }, [currentWorkspace, accessToken]);

  useEffect(() => {
    if (currentWorkspace && accessToken) {
      loadMembers();
      loadInvites();
    }
  }, [currentWorkspace, accessToken, loadMembers, loadInvites]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !currentWorkspace) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await authFetch(`/api/workspaces/${currentWorkspace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update workspace');
      }

      // Refresh auth state to get updated workspace
      await checkAuth();

      setSuccess('Workspace updated successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update workspace');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!currentWorkspace) return;

    const confirmed = confirm(
      `Are you sure you want to delete "${currentWorkspace.name}"? This action cannot be undone and all projects will be deleted.`,
    );

    if (!confirmed) return;

    setDeleting(true);
    setError(null);

    try {
      const response = await authFetch(`/api/workspaces/${currentWorkspace.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete workspace');
      }

      // Refresh auth state
      await checkAuth();

      // Navigate to projects (will show other workspace or create new)
      navigate('/projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete workspace');
      setDeleting(false);
    }
  };

  // Members handlers
  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentWorkspace) return;

    setInviting(true);
    setInviteError(null);
    setInviteLink(null);

    try {
      const email = inviteEmail.trim() || null;
      const response = await authFetch(`/api/workspaces/${currentWorkspace.id}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: inviteRole }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to invite member');
      }

      const data = await response.json();
      setInviteEmail('');
      setInviteLink(data.inviteLink);
      loadInvites();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to invite member');
    } finally {
      setInviting(false);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    if (!currentWorkspace) return;

    try {
      const response = await authFetch(`/api/workspaces/${currentWorkspace.id}/invites/${inviteId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to cancel invite');

      loadInvites();
    } catch (err) {
      console.error('Failed to cancel invite:', err);
    }
  };

  const handleRemove = async (memberId: string) => {
    if (!currentWorkspace) return;
    if (!confirm('Are you sure you want to remove this member?')) return;

    try {
      const response = await authFetch(`/api/workspaces/${currentWorkspace.id}/members/${memberId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to remove member');

      loadMembers();
    } catch (err) {
      console.error('Failed to remove member:', err);
    }
  };

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const currentUserRole = members.find((m) => m.userId === user?.id)?.role;
  const isOwnerOrAdmin = currentUserRole === 'owner' || currentUserRole === 'admin';

  if (!currentWorkspace) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-8">
      <div className="max-w-2xl mx-auto">
        <Button variant="ghost" className="mb-6" onClick={() => navigate('/projects')}>
          <IconArrowLeft className="w-4 h-4 mr-2" />
          Back to Projects
        </Button>

        {/* General Settings */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Workspace Settings</CardTitle>
            <CardDescription>Manage your workspace settings</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Workspace Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Workspace"
                  required
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              {success && <p className="text-sm text-green-600 dark:text-green-400">{success}</p>}

              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Members */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>Manage who has access to {currentWorkspace?.name || 'this workspace'}</CardDescription>
          </CardHeader>
          <CardContent>
            {isOwnerOrAdmin && (
              <>
                <form onSubmit={handleInvite} className="flex gap-2 mb-4">
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="Email (optional)"
                    className="flex-1"
                  />
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as 'admin' | 'member' | 'viewer')}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="submit" disabled={inviting}>
                    <IconUserPlus className="w-4 h-4 mr-2" />
                    {inviting ? 'Creating...' : 'Create invite'}
                  </Button>
                </form>

                {inviteLink && (
                  <div className="flex items-center gap-2 p-3 mb-4 rounded-lg border bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
                    <IconCheck className="w-4 h-4 text-green-600 dark:text-green-400" />
                    <span className="text-sm flex-1 truncate">{inviteLink}</span>
                    <Button variant="ghost" size="sm" onClick={copyInviteLink} className="shrink-0">
                      {copiedLink ? <IconCheck className="w-4 h-4" /> : <IconCopy className="w-4 h-4" />}
                    </Button>
                  </div>
                )}
              </>
            )}

            {inviteError && <p className="text-sm text-destructive mb-4">{inviteError}</p>}

            {membersLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : members.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No members found</div>
            ) : (
              <div className="space-y-3">
                {members.map((member) => (
                  <div key={member.id} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                    <div className="flex items-center gap-3">
                      {member.user.avatarUrl ? (
                        <img
                          src={member.user.avatarUrl}
                          alt={member.user.name || member.user.email}
                          className="w-10 h-10 rounded-full"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                          {(member.user.name || member.user.email)[0].toUpperCase()}
                        </div>
                      )}
                      <div>
                        <p className="font-medium">
                          {member.user.name || member.user.email}
                          {member.userId === user?.id && <span className="text-muted-foreground ml-2">(you)</span>}
                        </p>
                        <p className="text-sm text-muted-foreground">{member.user.email}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {member.role === 'owner' && (
                        <span className="flex items-center gap-1 text-sm text-amber-600">
                          <IconCrown className="w-4 h-4" />
                          Owner
                        </span>
                      )}
                      {member.role === 'admin' && <span className="text-sm text-muted-foreground">Admin</span>}
                      {member.role === 'member' && <span className="text-sm text-muted-foreground">Member</span>}
                      {member.role === 'viewer' && <span className="text-sm text-muted-foreground">Viewer</span>}

                      {isOwnerOrAdmin && member.role !== 'owner' && member.userId !== user?.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemove(member.userId)}
                          className="text-destructive hover:text-destructive"
                        >
                          <IconTrash className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pending Invites */}
            {isOwnerOrAdmin && invites.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <IconMail className="w-4 h-4" />
                  Pending Invites
                </h3>
                <div className="space-y-2">
                  {invites.map((invite) => (
                    <div
                      key={invite.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-muted/50"
                    >
                      <div>
                        <p className="text-sm font-medium">{invite.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {invite.role} · expires {new Date(invite.expiresAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCancelInvite(invite.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <IconX className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI Configuration */}
        <div className="mb-6">
          <AISettings />
        </div>

        {/* Danger Zone */}
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
            <CardDescription>Irreversible and destructive actions</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete Workspace'}
            </Button>
            <p className="text-sm text-muted-foreground mt-2">
              This will permanently delete the workspace and all its projects.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
