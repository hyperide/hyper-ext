import { memo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CommentSticker } from './CommentSticker';
import type { Comment } from './types';

interface CommentStickerOverlayProps {
  comments: Comment[];
  selectedCommentId: string | null;
  onCommentSelect: (id: string | null) => void;
  portalContainer: HTMLElement | null;
  getElementRect: (elementId: string) => DOMRect | null;
  canvasOffset?: { x: number; y: number };
  zoom?: number;
}

export const CommentStickerOverlay = memo(function CommentStickerOverlay({
  comments,
  selectedCommentId,
  onCommentSelect,
  portalContainer,
  getElementRect,
  canvasOffset = { x: 0, y: 0 },
  zoom = 1,
}: CommentStickerOverlayProps) {
  // Only render root comments (stickers), not replies
  const rootComments = comments.filter((c) => !c.parentId);

  console.log('[CommentStickerOverlay] Rendering', {
    totalComments: comments.length,
    rootComments: rootComments.length,
    canvasOffset,
    zoom,
  });

  const getPosition = useCallback(
    (comment: Comment): { left: number; top: number } | null => {
      console.log('[CommentStickerOverlay] getPosition for comment:', {
        id: comment.id,
        elementId: comment.elementId,
        positionX: comment.positionX,
        positionY: comment.positionY,
        isOrphaned: comment.isOrphaned,
      });

      // If attached to element, get element position
      if (comment.elementId && !comment.isOrphaned) {
        const rect = getElementRect(comment.elementId);
        console.log('[CommentStickerOverlay] Element rect:', rect);
        if (rect) {
          // Position at top-right corner of element
          // canvasOffset is iframe position, rect coords are inside iframe (need zoom)
          return {
            left: canvasOffset.x + rect.right * zoom,
            top: canvasOffset.y + rect.top * zoom,
          };
        }
        // Element not found - fall through to use positionX/Y if available
      }

      // Free-positioned, orphaned, or element not found (positionX/Y stored without zoom)
      if (comment.positionX !== null && comment.positionY !== null) {
        const pos = {
          left: canvasOffset.x + comment.positionX * zoom,
          top: canvasOffset.y + comment.positionY * zoom,
        };
        console.log('[CommentStickerOverlay] Using positionX/Y:', pos);
        return pos;
      }

      console.log('[CommentStickerOverlay] No position found, returning null');
      return null;
    },
    [getElementRect, canvasOffset, zoom]
  );

  const handleClick = useCallback(
    (commentId: string) => {
      onCommentSelect(selectedCommentId === commentId ? null : commentId);
    },
    [onCommentSelect, selectedCommentId]
  );

  if (!portalContainer) {
    return null;
  }

  return createPortal(
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {rootComments.map((comment) => {
        const position = getPosition(comment);

        if (!position) {
          return null;
        }

        const hasUnread = comment.replies?.some((r) => !r.firstViewedAt) || false;

        return (
          <div
            key={comment.id}
            className="pointer-events-auto absolute"
            style={{
              left: position.left,
              top: position.top,
              transform: 'translate(-50%, -100%) translateY(-8px)',
              zIndex: selectedCommentId === comment.id ? 1000 : 100,
            }}
          >
            <CommentSticker
              comment={comment}
              isSelected={selectedCommentId === comment.id}
              hasUnread={hasUnread}
              onClick={() => handleClick(comment.id)}
            />
          </div>
        );
      })}
    </div>,
    portalContainer
  );
});
