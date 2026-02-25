import { memo, useCallback, useState } from 'react';
import { useComments } from '@/components/comments';
import { useAuthStore } from '@/stores/authStore';
import { useEditorStore } from '@/stores/editorStore';
import { CommentsSection } from './CommentsSection';

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
  const { user } = useAuthStore();
  const { selectedCommentId, setSelectedCommentId } = useEditorStore();
  const [showResolved, setShowResolved] = useState(false);

  const { comments, isLoading, createReply, updateComment, resolveComment, reopenComment, deleteComment } = useComments(
    { projectId, componentPath },
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
      onReply={handleReply}
      onResolve={handleResolve}
      onReopen={handleReopen}
      onDelete={handleDelete}
      onEdit={handleEdit}
      currentUserId={user?.id}
      showResolved={showResolved}
      onToggleShowResolved={() => setShowResolved(!showResolved)}
      onClose={onClose}
      selectedCommentId={selectedCommentId}
      onSelectComment={setSelectedCommentId}
    />
  );
});
