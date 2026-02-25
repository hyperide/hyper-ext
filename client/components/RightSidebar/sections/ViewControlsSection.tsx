import { IconChevronDown, IconDeviceDesktop } from '@tabler/icons-react';
import cn from 'clsx';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { SIZE_PRESETS, ZOOM_PRESETS } from '../constants';

interface ViewControlsSectionProps {
  viewport?: { zoom: number; panX: number; panY: number };
  onZoomChange?: (zoom: number) => void;
  onFitToContent?: () => void;
  instanceSize?: { width: number; height: number };
  onInstanceSizeChange?: (width: number, height: number) => void;
}

export const ViewControlsSection = memo(function ViewControlsSection({
  viewport,
  onZoomChange,
  onFitToContent,
  instanceSize,
  onInstanceSizeChange,
}: ViewControlsSectionProps) {
  const [zoomInputValue, setZoomInputValue] = useState('100');
  const [showZoomDropdown, setShowZoomDropdown] = useState(false);
  const [showSizeDropdown, setShowSizeDropdown] = useState(false);
  const zoomInputRef = useRef<HTMLInputElement>(null);

  // Sync zoom input with viewport
  useEffect(() => {
    if (viewport) {
      setZoomInputValue(Math.round(viewport.zoom * 100).toString());
    }
  }, [viewport]);

  const handleZoomInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9]/g, '');
    setZoomInputValue(value);
  }, []);

  const handleZoomInputBlur = useCallback(() => {
    const numValue = Number.parseInt(zoomInputValue, 10);
    if (!Number.isNaN(numValue) && numValue > 0 && onZoomChange) {
      const clampedZoom = Math.max(25, Math.min(200, numValue)) / 100;
      onZoomChange(clampedZoom);
    } else if (viewport) {
      setZoomInputValue(Math.round(viewport.zoom * 100).toString());
    }
  }, [zoomInputValue, onZoomChange, viewport]);

  const handleZoomInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  }, []);

  const handleZoomPreset = useCallback(
    (preset: number | 'fit') => {
      if (preset === 'fit') {
        onFitToContent?.();
      } else {
        onZoomChange?.(preset / 100);
      }
      setShowZoomDropdown(false);
    },
    [onZoomChange, onFitToContent],
  );

  // Close dropdowns when clicking outside
  useEffect(() => {
    if (!showZoomDropdown && !showSizeDropdown) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (showZoomDropdown && !target.closest('[data-zoom-dropdown]')) {
        setShowZoomDropdown(false);
      }
      if (showSizeDropdown && !target.closest('[data-size-dropdown]')) {
        setShowSizeDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showZoomDropdown, showSizeDropdown]);

  return (
    <div className="px-4 py-3 flex items-center justify-between border-b border-border">
      <div className="relative" data-size-dropdown>
        <button
          type="button"
          onClick={() => setShowSizeDropdown(!showSizeDropdown)}
          className="flex items-center gap-2 hover:bg-muted rounded px-1 py-0.5 -mx-1 max-w-[120px]"
        >
          <IconDeviceDesktop className="w-4 h-4 shrink-0" stroke={1.5} />
          <span className="text-xs font-medium text-foreground truncate">
            {instanceSize
              ? (SIZE_PRESETS.find((p) => p.width === instanceSize.width && p.height === instanceSize.height)?.label ??
                `${instanceSize.width}×${instanceSize.height}`)
              : 'Auto'}
          </span>
          <IconChevronDown className="w-3 h-3 shrink-0" stroke={1.5} />
        </button>
        {showSizeDropdown && (
          <div className="absolute left-0 top-full mt-1 bg-background border border-border rounded shadow-lg py-1 z-50 min-w-[180px] whitespace-nowrap">
            {SIZE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  onInstanceSizeChange?.(preset.width, preset.height);
                  setShowSizeDropdown(false);
                }}
                className={cn(
                  'w-full px-3 py-1.5 text-xs text-left hover:bg-muted flex justify-between items-center',
                  instanceSize?.width === preset.width && instanceSize?.height === preset.height && 'bg-muted',
                )}
              >
                <span>{preset.label}</span>
                <span className="text-muted-foreground">
                  {preset.width}×{preset.height}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Only show zoom controls when viewport is provided (multi mode) */}
      {viewport && onZoomChange && (
        <div className="relative" data-zoom-dropdown>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: click delegates focus to nested input */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: wrapper delegates focus to nested input */}
          <div
            className="flex items-center gap-1 min-h-6 px-2 bg-muted rounded"
            onClick={() => zoomInputRef.current?.focus()}
          >
            <input
              ref={zoomInputRef}
              type="text"
              value={zoomInputValue}
              onChange={handleZoomInputChange}
              onBlur={handleZoomInputBlur}
              onKeyDown={handleZoomInputKeyDown}
              className="w-7 h-6 text-xs font-medium text-foreground text-right bg-transparent focus:outline-none"
            />
            <span className="text-xs font-medium text-foreground">%</span>
            <button
              type="button"
              onClick={(e) => {
                setShowZoomDropdown(!showZoomDropdown);
                e.stopPropagation();
              }}
              className="p-1 hover:bg-muted rounded"
            >
              <IconChevronDown className="w-3 h-3" stroke={1.5} />
            </button>
          </div>
          {showZoomDropdown && (
            <div className="absolute right-0 top-full mt-1 bg-background border border-border rounded shadow-lg py-1 z-50 min-w-[80px]">
              {ZOOM_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleZoomPreset(preset)}
                  className="w-full px-3 py-1.5 text-xs text-left hover:bg-muted"
                  title={preset === 100 ? 'Shift+0' : undefined}
                >
                  {preset}%
                </button>
              ))}
              <div className="border-t border-border my-1" />
              <button
                type="button"
                onClick={() => handleZoomPreset('fit')}
                className="w-full px-3 py-1.5 text-xs text-left hover:bg-muted"
              >
                Fit
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
