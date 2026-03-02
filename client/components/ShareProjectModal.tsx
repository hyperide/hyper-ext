import type { ProjectRole } from '@shared/types/statuses';
import { IconCheck, IconCopy, IconLink, IconMail, IconTrash, IconUserPlus, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import { NetworkStatusIndicator } from '@/components/NetworkStatusIndicator';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNetworkAwareFetch } from '@/hooks/useNetworkAwareFetch';
import { useAuthStore } from '@/stores/authStore';
import { authFetch } from '@/utils/authFetch';

interface ShareProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
}

export function ShareProjectModal({ isOpen, onClose, projectId, projectName }: ShareProjectModalProps) {
  const { user } = useAuthStore();

  // State
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Network-aware members loading
  const {
    data: membersData,
    isLoading: membersLoading,
    isNetworkError: membersNetworkError,
    isOffline,
    refetch: refetchMembers,
  } = useNetworkAwareFetch(
    async () => {
      const response = await authFetch(`/api/projects/${projectId}/members`);
      if (!response.ok) return { members: [] };
      const data = await response.json();
      return data;
    },
    {
      deps: [projectId],
      skip: !isOpen || !projectId,
      autoRetryOnReconnect: true,
    },
  );

  // Network-aware invites loading
  const {
    data: invitesData,
    isLoading: invitesLoading,
    isNetworkError: invitesNetworkError,
    refetch: refetchInvites,
  } = useNetworkAwareFetch(
    async () => {
      const response = await authFetch(`/api/projects/${projectId}/invites`);
      if (!response.ok) return { invites: [] };
      const data = await response.json();
      return data;
    },
    {
      deps: [projectId],
      skip: !isOpen || !projectId,
      autoRetryOnReconnect: true,
    },
  );

  const members: { userId: string; role: ProjectRole; user: { name: string | null; email: string } }[] =
    membersData?.members || [];
  const invites: { id: string; email: string | null; role: ProjectRole; expiresAt: string }[] =
    invitesData?.invites || [];
  const loading = membersLoading || invitesLoading;
  const hasNetworkError = membersNetworkError || invitesNetworkError;

  // Handle invite creation
  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) return;

    setInviting(true);
    setInviteError(null);
    setInviteLink(null);

    try {
      const email = inviteEmail.trim() || null;
      const response = await authFetch(`/api/projects/${projectId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: inviteRole }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(data.error || 'Failed to create invite');
      }

      const data = await response.json();
      setInviteEmail('');
      setInviteLink(data.inviteLink);
      refetchInvites();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to create invite');
    } finally {
      setInviting(false);
    }
  };

  // Handle invite cancellation
  const handleCancelInvite = async (inviteId: string) => {
    if (!projectId) return;

    try {
      const response = await authFetch(`/api/projects/${projectId}/invites/${inviteId}`, { method: 'DELETE' });

      if (!response.ok) throw new Error('Failed to cancel invite');

      refetchInvites();
    } catch (err) {
      console.error('Failed to cancel invite:', err);
    }
  };

  // Handle member removal
  const handleRemoveMember = async (userId: string) => {
    if (!projectId) return;
    if (!confirm('Are you sure you want to remove this member?')) return;

    try {
      const response = await authFetch(`/api/projects/${projectId}/members/${userId}`, { method: 'DELETE' });

      if (!response.ok) throw new Error('Failed to remove member');

      refetchMembers();
    } catch (err) {
      console.error('Failed to remove member:', err);
    }
  };

  // Handle role update
  const handleRoleUpdate = async (userId: string, newRole: 'editor' | 'viewer') => {
    if (!projectId) return;

    try {
      const response = await authFetch(`/api/projects/${projectId}/members/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      if (!response.ok) throw new Error('Failed to update role');

      refetchMembers();
    } catch (err) {
      console.error('Failed to update role:', err);
    }
  };

  // Copy invite link
  const copyInviteLink = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Create link without email
  const handleCreateLink = async () => {
    setInviting(true);
    setInviteError(null);
    setInviteLink(null);

    try {
      const response = await authFetch(`/api/projects/${projectId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: null, role: inviteRole }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(data.error || 'Failed to create invite link');
      }

      const data = await response.json();
      setInviteLink(data.inviteLink);
      refetchInvites();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to create invite link');
    } finally {
      setInviting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share Project</DialogTitle>
          <DialogDescription>Invite people to collaborate on &quot;{projectName}&quot;</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 w-full">
          {/* Invite form */}
          <form onSubmit={handleInvite} className="space-y-3">
            <div className="flex gap-2">
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Email address (optional)"
                className="flex-1"
              />
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as 'editor' | 'viewer')}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={inviting || !inviteEmail.trim()} className="flex-1">
                <IconMail className="w-4 h-4 mr-2" />
                {inviting ? 'Sending...' : 'Send invite'}
              </Button>
              <Button type="button" variant="outline" onClick={handleCreateLink} disabled={inviting}>
                <IconLink className="w-4 h-4 mr-2" />
                Create link
              </Button>
            </div>
          </form>

          {/* Invite link result */}
          {inviteLink && (
            <div className="flex items-center gap-2 p-3 rounded-lg border bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 overflow-hidden">
              <IconCheck className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
              <code className="text-sm w-0 flex-1 truncate block">{inviteLink}</code>
              <Button variant="ghost" size="sm" onClick={copyInviteLink} className="shrink-0">
                {copiedLink ? <IconCheck className="w-4 h-4" /> : <IconCopy className="w-4 h-4" />}
              </Button>
            </div>
          )}

          {/* Error */}
          {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}

          {/* Network error banner */}
          {hasNetworkError && (
            <NetworkStatusIndicator
              variant="banner"
              isOffline={isOffline}
              onRetry={() => {
                refetchMembers();
                refetchInvites();
              }}
            />
          )}

          {/* Members list */}
          {loading ? (
            <div className="text-center py-4 text-muted-foreground">Loading...</div>
          ) : members.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <IconUserPlus className="w-4 h-4" />
                Project Members
              </h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {members.map((member) => (
                  <div key={member.userId} className="flex items-center justify-between p-2 rounded-lg border bg-card">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        {(member.user.name || member.user.email)[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {member.user.name || member.user.email}
                          {member.userId === user?.id && <span className="text-muted-foreground ml-1">(you)</span>}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{member.user.email}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {member.userId !== user?.id ? (
                        <>
                          <Select
                            value={member.role}
                            onValueChange={(v) => handleRoleUpdate(member.userId, v as 'editor' | 'viewer')}
                          >
                            <SelectTrigger className="w-24 h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="editor">Editor</SelectItem>
                              <SelectItem value="viewer">Viewer</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveMember(member.userId)}
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          >
                            <IconTrash className="w-4 h-4" />
                          </Button>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground capitalize">{member.role}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Pending invites */}
          {invites.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <IconMail className="w-4 h-4" />
                Pending Invites
              </h3>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {invites.map((invite) => (
                  <div key={invite.id} className="flex items-center justify-between p-2 rounded-lg border bg-muted/50">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{invite.email || 'Link invite'}</p>
                      <p className="text-xs text-muted-foreground">
                        {invite.role} · expires {new Date(invite.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleCancelInvite(invite.id)}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <IconX className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
