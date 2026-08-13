/**
 * MapOverlay - renders map() boundaries and labels over canvas elements
 * Uses React Portal with position absolute and pointer-events: none
 */

import { createPortal } from 'react-dom';

export interface MapBoundary {
  parentMapId: string;
  depth: number;
  rect: DOMRect;
  expression: string; // Array expression being mapped over (e.g., "screenshots")
  elementId: string; // ID элемента внутри map для поиска в AST
}

interface MapOverlayProps {
  boundaries: MapBoundary[];
  portalContainer: HTMLElement;
  onMapClick?: (boundary: MapBoundary) => void;
}

/**
 * Single map boundary with border and label
 */
function MapBoundaryOverlay({
  boundary,
  onMapClick,
}: {
  boundary: MapBoundary;
  onMapClick?: (boundary: MapBoundary) => void;
}) {
  const { rect, depth } = boundary;

  // Calculate border color based on depth (nested maps have different shades)
  const borderOpacity = Math.max(0.3, 1 - depth * 0.2);

  return (
    <>
      {/* Border */}
      <div
        className="absolute border border-dashed border-purple-500 pointer-events-none"
        style={{
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          opacity: borderOpacity,
        }}
      />

      {/* Label - clickable */}
      {/* biome-ignore lint/a11y/useSemanticElements: inline overlay label with absolute positioning */}
      <div
        className="absolute px-1 h-2.5 bg-purple-100 rounded-br shadow-[inset_-1px_-1px_4px_rgba(0,0,0,0.1),inset_1px_1px_4px_#fff] text-gray-900 text-[8px] leading-none flex items-center cursor-pointer hover:bg-purple-200 transition-colors pointer-events-auto"
        role="button"
        tabIndex={0}
        style={{
          left: `${rect.left}px`,
          top: `${rect.top}px`,
        }}
        onClick={() => onMapClick?.(boundary)}
        onKeyDown={(e) => e.key === 'Enter' && onMapClick?.(boundary)}
      >
        map
      </div>
    </>
  );
}

/**
 * MapOverlay component - renders all map boundaries via Portal
 */
export function MapOverlay({ boundaries, portalContainer, onMapClick }: MapOverlayProps) {
  return createPortal(
    <div className="fixed inset-0 pointer-events-none z-10">
      {boundaries.map((boundary, index) => (
        <MapBoundaryOverlay key={`${boundary.parentMapId}-${index}`} boundary={boundary} onMapClick={onMapClick} />
      ))}
    </div>,
    portalContainer,
  );
}
