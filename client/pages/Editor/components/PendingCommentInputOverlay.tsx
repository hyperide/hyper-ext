import { memo } from 'react';
import { CommentInput } from '@/components/comments';
import { getPreviewIframe } from '@/lib/dom-utils';

interface PendingCommentPosition {
  x: number;
  y: number;
  elementId: string | null;
  instanceId: string | null;
}

interface PendingCommentInputOverlayProps {
  position: PendingCommentPosition;
  canvasMode: 'single' | 'multi';
  viewportZoom: number;
  onSubmit: (content: string, mentionedUserIds?: string[]) => void;
  onCancel: () => void;
}

/**
 * Overlay for the pending comment input field.
 * Positioned at the click location with data attributes for RAF-based scroll sync.
 */
export const PendingCommentInputOverlay = memo(function PendingCommentInputOverlay({
  position,
  canvasMode,
  viewportZoom,
  onSubmit,
  onCancel,
}: PendingCommentInputOverlayProps) {
  // In single mode, zoom is always 1 (no scaling transform)
  const effectiveZoom = canvasMode === 'single' ? 1 : viewportZoom;
  const iframeRect = getPreviewIframe()?.getBoundingClientRect();

  if (!iframeRect) {
    return null;
  }

  return (
    <div
      data-pending-comment-input="true"
      data-comment-base-x={position.x}
      data-comment-base-y={position.y}
      data-comment-zoom={effectiveZoom}
      className="fixed z-20"
      style={{
        left: iframeRect.left + position.x * effectiveZoom,
        top: iframeRect.top + position.y * effectiveZoom,
      }}
    >
      <div
        className="bg-yellow-200 shadow-md p-3 w-72"
        style={{
          boxShadow: '3px 3px 0 rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.08)',
        }}
      >
        <CommentInput
          placeholder="Add a comment..."
          submitLabel="Add"
          autoFocus
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
});
