/**
 * CondEditPopup - popup for editing conditional expressions
 * Rendered via React Portal
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CondBoundary } from './CondOverlay';

interface CondEditPopupProps {
  boundary: CondBoundary;
  portalContainer: HTMLElement;
  onClose: () => void;
  onSave: (condId: string, newExpression: string) => void;
}

export function CondEditPopup({ boundary, portalContainer, onClose, onSave }: CondEditPopupProps) {
  const [expression, setExpression] = useState('');

  useEffect(() => {
    // Load expression from boundary
    setExpression(boundary.expression);
  }, [boundary.condId, boundary.expression]);

  const handleSave = () => {
    onSave(boundary.condId, expression);
    onClose();
  };

  const inputId = `cond-expr-${boundary.condId}`;

  return createPortal(
    <>
      {/* Backdrop */}
      {/* biome-ignore lint/a11y/useSemanticElements: backdrop overlay is not a real button */}
      <div
        className="fixed inset-0 bg-black/20 z-[60]"
        role="button"
        tabIndex={-1}
        onClick={onClose}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      />

      {/* Popup - centered */}
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] bg-background rounded-lg shadow-lg border border-border p-4 min-w-[300px]"
        role="dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-foreground">Edit {boundary.type} condition</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ×
          </button>
        </div>

        <div className="mb-3">
          <label htmlFor={inputId} className="block text-xs text-muted-foreground mb-1">
            Condition expression
          </label>
          <input
            id={inputId}
            type="text"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            className="w-full px-2 py-1 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., isActive, count > 0"
          />
        </div>

        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      </div>
    </>,
    portalContainer,
  );
}
