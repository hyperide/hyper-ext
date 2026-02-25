import { memo, useEffect, useRef } from 'react';
import type { ArrowAnnotation } from '../../../shared/types/annotations';

export interface ArrowElementProps {
  arrow: ArrowAnnotation;
  isSelected: boolean;
  isDark?: boolean;
  isEditingLabel?: boolean;
  onLabelChange?: (label: string) => void;
  onLabelEditEnd?: () => void;
}

/**
 * SVG Arrow element with arrowhead, selection handles, and optional label
 * Pure rendering component - interaction is handled by AnnotationsLayer
 */
export const ArrowElement = memo(function ArrowElement({
  arrow,
  isSelected,
  isDark = false,
  isEditingLabel = false,
  onLabelChange,
  onLabelEditEnd,
}: ArrowElementProps) {
  const markerId = `arrowhead-${arrow.id}`;
  const inputRef = useRef<HTMLInputElement>(null);

  // Handle clicks outside the input to confirm editing
  useEffect(() => {
    if (!isEditingLabel) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        // Save current value and end editing
        onLabelChange?.(inputRef.current.value);
        onLabelEditEnd?.();
      }
    };

    // Use capture phase to catch clicks before they're stopped
    window.addEventListener('mousedown', handleClickOutside, true);
    return () => window.removeEventListener('mousedown', handleClickOutside, true);
  }, [isEditingLabel, onLabelChange, onLabelEditEnd]);

  // Handle sizes
  const handleRadius = 8;
  const hitAreaWidth = 16;

  // Default stroke width if not specified (make arrows thicker)
  const strokeWidth = arrow.strokeWidth || 3;

  // Calculate label position and rotation
  const midX = (arrow.startX + arrow.endX) / 2;
  const midY = (arrow.startY + arrow.endY) / 2;
  const dx = arrow.endX - arrow.startX;
  const dy = arrow.endY - arrow.startY;
  let angle = Math.atan2(dy, dx) * (180 / Math.PI);
  // Flip text if arrow points left to keep it readable
  if (angle > 90 || angle < -90) {
    angle += 180;
  }

  const labelFontSize = 14;
  const labelPadding = 4;

  return (
    <g
      data-annotation-id={arrow.id}
      data-annotation-type="arrow"
      data-start-binding={arrow.startBinding?.instanceId || ''}
      data-end-binding={arrow.endBinding?.instanceId || ''}
      data-base-start-x={arrow.startX}
      data-base-start-y={arrow.startY}
      data-base-end-x={arrow.endX}
      data-base-end-y={arrow.endY}
    >
      {/* Arrowhead marker definitions */}
      <defs>
        {/* Main arrowhead with optional white stroke for dark mode */}
        <marker
          id={markerId}
          markerWidth="10"
          markerHeight="7"
          refX="9"
          refY="3.5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <polygon
            points="0 0, 10 3.5, 0 7"
            fill={arrow.strokeColor}
            stroke={isDark ? 'white' : 'none'}
            strokeWidth={isDark ? 1 : 0}
          />
        </marker>
      </defs>

      {/* Hit area - invisible thick line for easier clicking */}
      <line
        data-arrow-hit-area={arrow.id}
        x1={arrow.startX}
        y1={arrow.startY}
        x2={arrow.endX}
        y2={arrow.endY}
        stroke="transparent"
        strokeWidth={hitAreaWidth}
        style={{ cursor: isSelected ? 'move' : 'pointer' }}
      />

      {/* White outline for dark mode - line only, arrowhead has its own stroke */}
      {isDark && (
        <line
          x1={arrow.startX}
          y1={arrow.startY}
          x2={arrow.endX}
          y2={arrow.endY}
          stroke="white"
          strokeWidth={strokeWidth + 4}
          pointerEvents="none"
        />
      )}

      {/* Visible line with arrowhead */}
      <line
        x1={arrow.startX}
        y1={arrow.startY}
        x2={arrow.endX}
        y2={arrow.endY}
        stroke={arrow.strokeColor}
        strokeWidth={strokeWidth}
        markerEnd={`url(#${markerId})`}
        pointerEvents="none"
      />

      {/* Label - displayed along the arrow line */}
      {(arrow.label || isEditingLabel) && (
        <g transform={`translate(${midX}, ${midY}) rotate(${angle})`}>
          {/* Label text with white stroke outline */}
          {arrow.label && !isEditingLabel && (
            <>
              {/* White stroke outline for readability */}
              <text
                x={0}
                y={-labelPadding - 4}
                textAnchor="middle"
                fill="none"
                stroke="#ffffff"
                strokeWidth={3}
                fontSize={labelFontSize}
                fontFamily="system-ui, sans-serif"
                pointerEvents="none"
              >
                {arrow.label}
              </text>
              {/* Black text on top */}
              <text
                x={0}
                y={-labelPadding - 4}
                textAnchor="middle"
                fill="#000000"
                fontSize={labelFontSize}
                fontFamily="system-ui, sans-serif"
                pointerEvents="none"
              >
                {arrow.label}
              </text>
            </>
          )}
          {/* Inline editing input */}
          {isEditingLabel && (
            <foreignObject
              x={-100}
              y={-labelFontSize - labelPadding - 8}
              width={200}
              height={labelFontSize + labelPadding * 2 + 4}
              style={{ overflow: 'visible' }}
            >
              <input
                ref={inputRef}
                type="text"
                defaultValue={arrow.label || ''}
                // biome-ignore lint/a11y/noAutofocus: intentional autofocus for annotation editing
                autoFocus
                style={{
                  width: '100%',
                  height: '100%',
                  padding: `${labelPadding}px 8px`,
                  fontSize: `${labelFontSize}px`,
                  fontFamily: 'system-ui, sans-serif',
                  textAlign: 'center',
                  border: '2px solid #3b82f6',
                  borderRadius: '3px',
                  outline: 'none',
                  backgroundColor: isDark ? '#1f2937' : '#ffffff',
                  color: isDark ? '#e5e7eb' : '#000000',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onLabelChange?.((e.target as HTMLInputElement).value);
                    onLabelEditEnd?.();
                  }
                  if (e.key === 'Escape') {
                    onLabelEditEnd?.();
                  }
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              />
            </foreignObject>
          )}
        </g>
      )}

      {/* Selection handles - only shown when selected */}
      {isSelected && (
        <>
          {/* Start handle */}
          <circle
            data-arrow-handle={`${arrow.id}:start`}
            cx={arrow.startX}
            cy={arrow.startY}
            r={handleRadius}
            fill="white"
            stroke="#3b82f6"
            strokeWidth={2}
            style={{ cursor: 'grab' }}
          />

          {/* End handle */}
          <circle
            data-arrow-handle={`${arrow.id}:end`}
            cx={arrow.endX}
            cy={arrow.endY}
            r={handleRadius}
            fill="white"
            stroke="#3b82f6"
            strokeWidth={2}
            style={{ cursor: 'grab' }}
          />

          {/* Selection outline - dashed rectangle around arrow */}
          <rect
            x={Math.min(arrow.startX, arrow.endX) - 8}
            y={Math.min(arrow.startY, arrow.endY) - 8}
            width={Math.abs(arrow.endX - arrow.startX) + 16}
            height={Math.abs(arrow.endY - arrow.startY) + 16}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={1}
            strokeDasharray="4 2"
            pointerEvents="none"
          />
        </>
      )}
    </g>
  );
});
