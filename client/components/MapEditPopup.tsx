/**
 * MapEditPopup - popup for editing map expressions and generating items
 * Rendered via React Portal
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { authFetch } from '@/utils/authFetch';
import type { MapBoundary } from './MapOverlay';

interface MapEditPopupProps {
  boundary: MapBoundary;
  portalContainer: HTMLElement;
  onClose: () => void;
  onSave: (parentMapId: string, newExpression: string) => void;
  projectId?: string;
  componentPath?: string;
  instanceId?: string;
  onItemsGenerated?: () => void;
}

export function MapEditPopup({
  boundary,
  portalContainer,
  onClose,
  onSave,
  projectId,
  componentPath,
  instanceId,
  onItemsGenerated,
}: MapEditPopupProps) {
  const [expression, setExpression] = useState('');
  const [generateCount, setGenerateCount] = useState(3);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  useEffect(() => {
    // Load expression from boundary
    setExpression(boundary.expression);
  }, [boundary.parentMapId, boundary.expression]);

  const handleSave = () => {
    onSave(boundary.parentMapId, expression);
    onClose();
  };

  const handleGenerateItems = async () => {
    if (!projectId || !componentPath || !instanceId) {
      setGenerateError('Missing project context');
      return;
    }

    setIsGenerating(true);
    setGenerateError(null);

    try {
      const response = await authFetch(`/api/canvas-composition/${projectId}/generate-map-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          componentPath,
          instanceId,
          arrayPropName: expression,
          count: generateCount,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        setGenerateError(data.error || 'Failed to generate items');
        return;
      }

      // For canvas_props, trigger refresh (no HMR for canvas.json)
      // For sampleRender, HMR will handle the update automatically
      if (data.source === 'canvas_props') {
        onItemsGenerated?.();
      }
      onClose();
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsGenerating(false);
    }
  };

  const canGenerate = projectId && componentPath && instanceId && expression;

  return createPortal(
    <>
      {/* Backdrop */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss pattern */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss pattern */}
      <div className="fixed inset-0 bg-black/20 z-[60]" onClick={onClose} />

      {/* Popup - centered */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation on popup container */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation on popup container */}
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] bg-background rounded-lg shadow-lg border border-border p-4 min-w-[300px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-foreground">Edit map expression</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ×
          </button>
        </div>

        <div className="mb-3">
          <label htmlFor="map-expression-input" className="block text-xs text-muted-foreground mb-1">
            Array/collection expression
          </label>
          <input
            id="map-expression-input"
            type="text"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            className="w-full px-2 py-1 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., screenshots, items"
          />
        </div>

        {/* Generate items section */}
        {canGenerate && (
          <div className="mb-3 pt-3 border-t border-border">
            <label htmlFor="map-generate-count" className="block text-xs text-muted-foreground mb-1">
              Generate more items
            </label>
            <div className="flex items-center gap-2">
              <input
                id="map-generate-count"
                type="number"
                min={1}
                max={10}
                value={generateCount}
                onChange={(e) => setGenerateCount(Math.max(1, Math.min(10, Number(e.target.value))))}
                className="w-16 px-2 py-1 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                type="button"
                onClick={handleGenerateItems}
                disabled={isGenerating}
                className="px-3 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? 'Generating...' : 'Generate'}
              </button>
            </div>
            {generateError && <p className="mt-1 text-xs text-red-500">{generateError}</p>}
          </div>
        )}

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
