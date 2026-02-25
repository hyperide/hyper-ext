import cn from 'clsx';
import { memo } from 'react';
import type { Comment } from '@/components/comments/types';

interface ExpandedCommentStickerProps {
  comment: Comment;
  isSelected: boolean;
  onClick: () => void;
}

/**
 * Expanded comment sticker with author info, content preview, and reply count.
 * Used in design mode canvas overlay.
 */
export const ExpandedCommentSticker = memo(function ExpandedCommentSticker({
  comment,
  isSelected,
  onClick,
}: ExpandedCommentStickerProps) {
  const replyCount = comment.replies?.length ?? 0;
  const isResolved = comment.status === 'resolved';
  const authorName = comment.author.name || comment.author.email;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        'flex items-start gap-2 p-2 max-w-xs text-left',
        isSelected ? 'bg-yellow-300' : 'bg-yellow-200 hover:bg-yellow-300',
        isResolved && 'opacity-60',
      )}
      style={{
        transition: 'transform 150ms ease-out, box-shadow 150ms ease-out',
        boxShadow: isSelected
          ? '5px 5px 0 rgba(0,0,0,0.2), 0 10px 20px rgba(0,0,0,0.15)'
          : '2px 2px 0 rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.05)',
        transform: isSelected ? 'translateY(-6px) scale(1.05) rotate(-1deg)' : 'translateY(0) scale(1) rotate(0deg)',
      }}
    >
      {comment.author.avatarUrl ? (
        <img src={comment.author.avatarUrl} alt={authorName} className="h-6 w-6 rounded-full flex-shrink-0" />
      ) : (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-yellow-400 text-xs font-medium flex-shrink-0">
          {authorName.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-gray-800 truncate">{authorName}</span>
          <span className="text-[10px] text-gray-500">{new Date(comment.createdAt).toLocaleDateString()}</span>
        </div>
        <p className="text-xs text-gray-700 line-clamp-2 mt-0.5">{comment.content}</p>
        {replyCount > 0 && (
          <span className="text-[10px] text-gray-500 mt-1 block">
            {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
          </span>
        )}
      </div>
    </button>
  );
});
