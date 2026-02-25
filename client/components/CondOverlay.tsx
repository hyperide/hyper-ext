/**
 * CondOverlay - renders conditional boundaries and labels over canvas elements
 * Uses React Portal with position absolute and pointer-events: none
 */

import { createPortal } from 'react-dom';

export interface CondBoundary {
  condId: string;
  type: 'if-then' | 'if-else' | 'else-if' | 'switch-case';
  branch: 'then' | 'else' | 'case';
  index?: number;
  expression: string;
  elementId: string; // ID элемента внутри условия для поиска в AST
  rect: DOMRect;
}

interface CondOverlayProps {
  boundaries: CondBoundary[];
  portalContainer: HTMLElement;
  onCondClick?: (boundary: CondBoundary) => void;
}

/**
 * Single conditional boundary with border and label
 */
function CondBoundaryOverlay({
  boundary,
  onCondClick
}: {
  boundary: CondBoundary;
  onCondClick?: (boundary: CondBoundary) => void;
}) {
  const { rect, branch, index } = boundary;

  // Label text based on branch
  const labelText = branch === 'case' && index !== undefined ? `case ${index}` : branch;

  return (
    <>
      {/* Border */}
      <div
        className="absolute border border-dashed border-orange-500 pointer-events-none"
        style={{
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          opacity: 0.6,
        }}
      />

      {/* Label - clickable */}
      <div
        className="absolute px-1 h-2.5 bg-orange-100 rounded-br shadow-[inset_-1px_-1px_4px_rgba(0,0,0,0.1),inset_1px_1px_4px_#fff] text-gray-900 text-[8px] leading-none flex items-center cursor-pointer hover:bg-orange-200 transition-colors pointer-events-auto"
        style={{
          left: `${rect.left}px`,
          top: `${rect.top}px`,
        }}
        onClick={() => onCondClick?.(boundary)}
      >
        {labelText}
      </div>
    </>
  );
}

/**
 * CondOverlay component - renders all conditional boundaries via Portal
 */
export function CondOverlay({ boundaries, portalContainer, onCondClick }: CondOverlayProps) {
  return createPortal(
    <div className="fixed inset-0 pointer-events-none z-10">
      {boundaries.map((boundary, index) => (
        <CondBoundaryOverlay
          key={`${boundary.condId}-${boundary.branch}-${index}`}
          boundary={boundary}
          onCondClick={onCondClick}
        />
      ))}
    </div>,
    portalContainer
  );
}
