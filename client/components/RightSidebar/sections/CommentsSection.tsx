import { IconCheck, IconMessage, IconX } from '@tabler/icons-react';
import cn from 'clsx';
import { memo, useCallback, useState } from 'react';
import { CommentThread } from '@/components/comments/CommentThread';
import type { Comment } from '@/components/comments/types';

interface CommentsSectionProps {
  comments: Comment[];
  isLoading?: boolean;
  onReply: (commentId: string, content: string) => Promise<void>;
  onResolve: (commentId: string) => Promise<void>;
  onReopen: (commentId: string) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  onEdit: (commentId: string, content: string) => Promise<void>;
  currentUserId?: string;
  showResolved?: boolean;
  onToggleShowResolved?: () => void;
  onClose: () => void;
  selectedCommentId?: string | null;
  onSelectComment?: (id: string | null) => void;
}

export const CommentsSection = memo(function CommentsSection({
  comments,
  isLoading = false,
  onReply,
  onResolve,
  onReopen,
  onDelete,
  onEdit,
  currentUserId,
  showResolved = false,
  onToggleShowResolved,
  onClose,
  selectedCommentId: externalSelectedCommentId,
  onSelectComment,
}: CommentsSectionProps) {
  const [internalSelectedCommentId, setInternalSelectedCommentId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Use external or internal state
  const selectedCommentId = externalSelectedCommentId ?? internalSelectedCommentId;
  const setSelectedCommentId = onSelectComment ?? setInternalSelectedCommentId;

  const openComments = comments.filter((c) => c.status === 'open');
  const resolvedComments = comments.filter((c) => c.status === 'resolved');

  const displayedComments = showResolved ? [...openComments, ...resolvedComments] : openComments;

  const handleReply = useCallback(
    async (content: string) => {
      if (!selectedCommentId) return;
      setIsSubmitting(true);
      try {
        await onReply(selectedCommentId, content);
      } finally {
        setIsSubmitting(false);
      }
    },
    [selectedCommentId, onReply],
  );

  const handleResolve = useCallback(async () => {
    if (!selectedCommentId) return;
    setIsSubmitting(true);
    try {
      await onResolve(selectedCommentId);
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedCommentId, onResolve]);

  const handleReopen = useCallback(async () => {
    if (!selectedCommentId) return;
    setIsSubmitting(true);
    try {
      await onReopen(selectedCommentId);
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedCommentId, onReopen]);

  const handleDelete = useCallback(async () => {
    if (!selectedCommentId) return;
    setIsSubmitting(true);
    try {
      await onDelete(selectedCommentId);
      setSelectedCommentId(null);
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedCommentId, onDelete, setSelectedCommentId]);

  const handleEdit = useCallback(
    async (content: string) => {
      if (!selectedCommentId) return;
      setIsSubmitting(true);
      try {
        await onEdit(selectedCommentId, content);
      } finally {
        setIsSubmitting(false);
      }
    },
    [selectedCommentId, onEdit],
  );

  const selectedComment = selectedCommentId ? comments.find((c) => c.id === selectedCommentId) : null;

  return (
    <div className="border-t border-border">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconMessage className="w-4 h-4" stroke={1.5} />
          <span className="text-xs font-semibold text-foreground">Comments</span>
          {openComments.length > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/20 text-blue-500 rounded-full">
              {openComments.length}
            </span>
          )}
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded hover:bg-muted">
          <IconX className="w-4 h-4" stroke={1.5} />
        </button>
      </div>

      <div className="px-4 pb-4 space-y-3">
        {/* Actions bar */}
        <div className="flex items-center justify-end">
          {resolvedComments.length > 0 && (
            <button
              type="button"
              onClick={onToggleShowResolved}
              className={cn(
                'text-xs flex items-center gap-1',
                showResolved ? 'text-blue-600' : 'text-muted-foreground',
              )}
            >
              <IconCheck className="w-3 h-3" stroke={2} />
              {resolvedComments.length} resolved
            </button>
          )}
        </div>

        {/* Loading state */}
        {isLoading && <div className="text-center py-4 text-sm text-muted-foreground">Loading comments...</div>}

        {/* Empty state */}
        {!isLoading && displayedComments.length === 0 && (
          <div className="text-center py-6">
            <IconMessage className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" stroke={1.5} />
            <p className="text-sm text-muted-foreground">No comments yet</p>
            <p className="text-xs text-muted-foreground mt-1">Start a conversation about this component</p>
          </div>
        )}

        {/* Comment list */}
        {!isLoading && displayedComments.length > 0 && (
          <div className="space-y-2">
            {displayedComments.map((comment) => (
              <button
                key={comment.id}
                type="button"
                onClick={() => setSelectedCommentId(selectedCommentId === comment.id ? null : comment.id)}
                className={cn(
                  'w-full p-3 rounded-lg text-left transition-colors',
                  'border hover:border-border',
                  selectedCommentId === comment.id
                    ? 'border-blue-500/50 bg-blue-500/10'
                    : 'border-border bg-background',
                  comment.status === 'resolved' && 'opacity-60',
                )}
              >
                <div className="flex items-start gap-2">
                  {comment.author.avatarUrl ? (
                    <img
                      src={comment.author.avatarUrl}
                      alt={comment.author.name || comment.author.email}
                      className="h-6 w-6 rounded-full flex-shrink-0"
                    />
                  ) : (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-medium flex-shrink-0">
                      {(comment.author.name || comment.author.email).charAt(0).toUpperCase()}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium truncate">
                        {comment.author.name || comment.author.email}
                      </span>
                      {comment.status === 'resolved' && (
                        <span className="px-1.5 py-0.5 text-[10px] bg-green-500/20 text-green-600 rounded">
                          Resolved
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{comment.content}</p>
                    {comment.replies && comment.replies.length > 0 && (
                      <span className="text-[10px] text-muted-foreground mt-1 block">
                        {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Selected comment thread */}
        {selectedComment && (
          <div className="mt-4 p-4 bg-background border border-border rounded-lg">
            <CommentThread
              comment={selectedComment}
              onReply={handleReply}
              onResolve={handleResolve}
              onReopen={handleReopen}
              onDelete={handleDelete}
              onEdit={handleEdit}
              canEdit={selectedComment.author.id === currentUserId}
              isSubmitting={isSubmitting}
            />
          </div>
        )}
      </div>
    </div>
  );
});
