/**
 * SelectionOverlay - renders selection and hover borders over canvas elements
 * Uses React Portal with position absolute and pointer-events: none
 */

import { createPortal } from 'react-dom';

export interface SelectionRect {
  elementId: string;
  rect: DOMRect;
  type: 'hover' | 'select';
}

interface SelectionOverlayProps {
  selections: SelectionRect[];
  portalContainer: HTMLElement;
}

/**
 * Single selection border
 */
function SelectionBorderOverlay({ selection }: { selection: SelectionRect }) {
  const { rect, type } = selection;

  const borderColor = type === 'select' ? 'rgb(59, 130, 246)' : 'rgba(59, 130, 246, 0.5)';
  const brightness = type === 'select' ? 0.95 : 0.98;

  return (
    <>
      {/* Border */}
      <div
        className="absolute pointer-events-none"
        style={{
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          border: `2px solid ${borderColor}`,
          filter: `brightness(${brightness})`,
          transition: 'all 0.15s ease',
        }}
      />
    </>
  );
}

/**
 * SelectionOverlay component - renders all selection borders via Portal
 */
export function SelectionOverlay({ selections, portalContainer }: SelectionOverlayProps) {
  return createPortal(
    selections.map((selection) => (
      <SelectionBorderOverlay key={`${selection.elementId}-${selection.type}`} selection={selection} />
    )),
    portalContainer,
  );
}
