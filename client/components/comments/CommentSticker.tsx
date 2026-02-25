import cn from 'clsx';
import { memo } from 'react';
import type { Comment } from './types';

interface CommentStickerProps {
  comment: Comment;
  isSelected: boolean;
  hasUnread?: boolean;
  onClick: () => void;
}

export const CommentSticker = memo(function CommentSticker({
  comment,
  isSelected,
  hasUnread = false,
  onClick,
}: CommentStickerProps) {
  const replyCount = comment.replies?.length || 0;
  const isResolved = comment.status === 'resolved';

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onClick();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        'group relative flex items-center justify-center rounded shadow-lg transition-all',
        'hover:scale-110 active:scale-95',
        'w-6 h-6',
        isSelected ? 'bg-yellow-400 ring-2 ring-yellow-600' : isResolved ? 'bg-green-400' : 'bg-yellow-400',
        comment.isOrphaned && 'opacity-70 border-2 border-dashed border-orange-600',
      )}
      style={{
        // Yellow sticky note shape - slightly rotated pin
        clipPath: 'polygon(0 10%, 10% 0, 100% 0, 100% 100%, 0 100%)',
      }}
    >
      {/* Reply count badge */}
      {replyCount > 0 && (
        <span className="absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-white text-[10px] font-bold ring-1 ring-white">
          {replyCount}
        </span>
      )}

      {/* Unread indicator */}
      {hasUnread && !isSelected && (
        <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-red-500 ring-2 ring-white" />
      )}

      {/* Resolved checkmark */}
      {isResolved && (
        <svg
          className="h-3.5 w-3.5 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
});
