import { IconCheck, IconEdit, IconRefresh, IconTrash } from '@tabler/icons-react';
import { formatDistanceToNow } from 'date-fns';
import { memo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Comment } from './types';

interface CommentThreadProps {
  comment: Comment;
  onReply: (content: string) => void;
  onResolve: () => void;
  onReopen: () => void;
  onDelete: () => void;
  onEdit?: (content: string) => void;
  canEdit?: boolean;
  isSubmitting?: boolean;
}

export const CommentThread = memo(function CommentThread({
  comment,
  onReply,
  onResolve,
  onReopen,
  onDelete,
  onEdit,
  canEdit = false,
  isSubmitting = false,
}: CommentThreadProps) {
  const [replyContent, setReplyContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);

  const handleSubmitReply = () => {
    if (!replyContent.trim()) return;
    onReply(replyContent.trim());
    setReplyContent('');
  };

  const handleSubmitEdit = () => {
    if (!editContent.trim() || !onEdit) return;
    onEdit(editContent.trim());
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      action();
    }
  };

  return (
    <div className="space-y-4">
      {/* Main comment */}
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          {comment.author.avatarUrl ? (
            <img
              src={comment.author.avatarUrl}
              alt={comment.author.name || comment.author.email}
              className="h-8 w-8 rounded-full"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-sm font-medium">
              {(comment.author.name || comment.author.email).charAt(0).toUpperCase()}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">{comment.author.name || comment.author.email}</span>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
              </span>
              {comment.editedAt && <span className="text-xs text-muted-foreground">(edited)</span>}
            </div>

            {isEditing ? (
              <div className="mt-2 space-y-2">
                <Textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, handleSubmitEdit)}
                  className="min-h-[60px] text-sm"
                  placeholder="Edit your comment..."
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSubmitEdit} disabled={isSubmitting}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-sm whitespace-pre-wrap break-words">{comment.content}</p>
            )}
          </div>
        </div>

        {/* Actions */}
        {!isEditing && (
          <div className="flex items-center gap-1 ml-10">
            {comment.status === 'open' ? (
              <Button size="sm" variant="ghost" onClick={onResolve} disabled={isSubmitting}>
                <IconCheck className="h-4 w-4 mr-1" />
                Resolve
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={onReopen} disabled={isSubmitting}>
                <IconRefresh className="h-4 w-4 mr-1" />
                Reopen
              </Button>
            )}

            {canEdit && (
              <Button size="sm" variant="ghost" onClick={() => setIsEditing(true)} disabled={isSubmitting}>
                <IconEdit className="h-4 w-4 mr-1" />
                Edit
              </Button>
            )}

            <Button
              size="sm"
              variant="ghost"
              onClick={onDelete}
              disabled={isSubmitting}
              className="text-red-500 hover:text-red-600"
            >
              <IconTrash className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="ml-10 space-y-3 border-l-2 border-gray-100 pl-4">
          {comment.replies.map((reply) => (
            <div key={reply.id} className="flex items-start gap-2">
              {reply.author.avatarUrl ? (
                <img
                  src={reply.author.avatarUrl}
                  alt={reply.author.name || reply.author.email}
                  className="h-6 w-6 rounded-full"
                />
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-medium">
                  {(reply.author.name || reply.author.email).charAt(0).toUpperCase()}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-xs truncate">{reply.author.name || reply.author.email}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(reply.createdAt), { addSuffix: true })}
                  </span>
                  {reply.editedAt && <span className="text-xs text-muted-foreground">(edited)</span>}
                </div>
                <p className="mt-0.5 text-sm whitespace-pre-wrap break-words">{reply.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reply input */}
      <div className="ml-10 space-y-2">
        <Textarea
          value={replyContent}
          onChange={(e) => setReplyContent(e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, handleSubmitReply)}
          placeholder="Write a reply... (Cmd+Enter to send)"
          className="min-h-[60px] text-sm"
        />
        <Button size="sm" onClick={handleSubmitReply} disabled={!replyContent.trim() || isSubmitting}>
          Reply
        </Button>
      </div>
    </div>
  );
});
