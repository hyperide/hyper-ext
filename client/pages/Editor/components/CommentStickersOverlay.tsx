import { memo, useMemo } from 'react';
import type { Comment } from '@/components/comments/types';
import { getPreviewIframe } from '@/lib/dom-utils';
import { ExpandedCommentSticker } from './ExpandedCommentSticker';

interface CommentStickersOverlayProps {
  comments: Comment[];
  selectedCommentId: string | null;
  canvasMode: 'single' | 'multi';
  viewportZoom: number;
  onCommentSelect: (commentId: string) => void;
}

/**
 * Overlay for displaying positioned comment stickers on the canvas.
 * Handles position calculation based on canvas mode and viewport zoom.
 * Uses data attributes for RAF-based scroll sync (see useCanvasComments).
 */
export const CommentStickersOverlay = memo(function CommentStickersOverlay({
  comments,
  selectedCommentId,
  canvasMode,
  viewportZoom,
  onCommentSelect,
}: CommentStickersOverlayProps) {
  // In single mode, zoom is always 1 (no scaling transform)
  const effectiveZoom = canvasMode === 'single' ? 1 : viewportZoom;

  // Filter to root comments that have position and are not resolved
  const visibleComments = useMemo(
    () =>
      comments.filter((c) => !c.parentId && c.status !== 'resolved' && c.positionX !== null && c.positionY !== null),
    [comments],
  );

  // Get iframe rect for positioning
  const iframe = getPreviewIframe();
  const iframeRect = iframe?.getBoundingClientRect();

  if (!iframeRect || !iframe?.contentDocument) {
    return null;
  }

  return (
    <>
      {visibleComments.map((comment) => {
        const posX = comment.positionX as number;
        const posY = comment.positionY as number;

        return (
          <div
            key={comment.id}
            data-comment-sticker-id={comment.id}
            data-comment-instance-id={comment.instanceId || ''}
            data-comment-base-x={posX}
            data-comment-base-y={posY}
            data-comment-zoom={effectiveZoom}
            className="fixed z-10"
            style={{
              // Initial position - RAF loop will update during scroll
              left: iframeRect.left + posX * effectiveZoom,
              top: iframeRect.top + posY * effectiveZoom,
            }}
          >
            <ExpandedCommentSticker
              comment={comment}
              isSelected={selectedCommentId === comment.id}
              onClick={() => onCommentSelect(comment.id)}
            />
          </div>
        );
      })}
    </>
  );
});
