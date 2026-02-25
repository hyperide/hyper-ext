import { memo, useState, useEffect, useCallback } from 'react';
import { useComments } from '@/components/comments';
import { CommentsSection } from './CommentsSection';
import type { MentionUser } from '@/components/comments/CommentInput';
import { useAuthStore } from '@/stores/authStore';
import { useEditorStore } from '@/stores/editorStore';
import { authFetch } from '@/utils/authFetch';

interface CommentsSectionContainerProps {
  projectId: string | undefined;
  componentPath: string | undefined;
  onClose: () => void;
}

export const CommentsSectionContainer = memo(function CommentsSectionContainer({
  projectId,
  componentPath,
  onClose,
}: CommentsSectionContainerProps) {
  const { user, currentWorkspace, accessToken } = useAuthStore();
  const { selectedCommentId, setSelectedCommentId } = useEditorStore();
  const [workspaceMembers, setWorkspaceMembers] = useState<MentionUser[]>([]);
  const [showResolved, setShowResolved] = useState(false);

  const {
    comments,
    isLoading,
    createComment,
    createReply,
    updateComment,
    resolveComment,
    reopenComment,
    deleteComment,
  } = useComments({ projectId, componentPath });

  // Fetch workspace members for @mentions
  useEffect(() => {
    if (!currentWorkspace || !accessToken) return;

    const fetchMembers = async () => {
      try {
        const response = await authFetch(
          `/api/workspaces/${currentWorkspace.id}/members`,
        );
        if (response.ok) {
          const data = await response.json();
          const members: MentionUser[] = (data.members || []).map((m: any) => ({
            id: m.user.id,
            name: m.user.name,
            email: m.user.email,
            avatarUrl: m.user.avatarUrl,
          }));
          setWorkspaceMembers(members);
        }
      } catch (err) {
        console.error('Failed to fetch workspace members:', err);
      }
    };

    fetchMembers();
  }, [currentWorkspace, accessToken]);

  // Handler wrappers
  const handleCreateComment = useCallback(
    async (
      content: string,
      mentionedUserIds: string[],
      position?: { elementId?: string; x?: number; y?: number },
    ) => {
      if (!componentPath) return;
      await createComment({
        content,
        componentPath,
        mentionedUserIds,
        elementId: position?.elementId,
        positionX: position?.x,
        positionY: position?.y,
      });
    },
    [componentPath, createComment],
  );

  const handleReply = useCallback(
    async (commentId: string, content: string) => {
      await createReply(commentId, { content });
    },
    [createReply],
  );

  const handleResolve = useCallback(
    async (commentId: string) => {
      await resolveComment(commentId);
    },
    [resolveComment],
  );

  const handleReopen = useCallback(
    async (commentId: string) => {
      await reopenComment(commentId);
    },
    [reopenComment],
  );

  const handleDelete = useCallback(
    async (commentId: string) => {
      await deleteComment(commentId);
    },
    [deleteComment],
  );

  const handleEdit = useCallback(
    async (commentId: string, content: string) => {
      await updateComment(commentId, content);
    },
    [updateComment],
  );

  // Don't render if no project
  if (!projectId) {
    return null;
  }

  return (
    <CommentsSection
      comments={comments}
      isLoading={isLoading}
      onCreateComment={handleCreateComment}
      onReply={handleReply}
      onResolve={handleResolve}
      onReopen={handleReopen}
      onDelete={handleDelete}
      onEdit={handleEdit}
      currentUserId={user?.id}
      workspaceMembers={workspaceMembers}
      showResolved={showResolved}
      onToggleShowResolved={() => setShowResolved(!showResolved)}
      onClose={onClose}
      selectedCommentId={selectedCommentId}
      onSelectComment={setSelectedCommentId}
    />
  );
});
