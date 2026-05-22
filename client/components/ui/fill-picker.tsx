import { IconPalette, IconPhoto } from '@tabler/icons-react';
import cn from 'clsx';
import { useEffect } from 'react';
import { ColorCombobox } from './color-combobox';
import type { TokenSystem } from './color-utils';
import type { CanvasEngine } from '@/lib/canvas-engine/core/CanvasEngine';
import { ImageBackgroundPicker } from './image-background-picker';

export type FillMode = 'color' | 'image';

export const SampleDefault = () => {
  const tokenSystem: TokenSystem = 'tailwind';

  return (
    <MemoryRouter initialEntries={['/projects/project-123']}>
      <div className="p-6 w-80">
        <FillPicker
          colorValue="#0066CC"
          onColorChange={(value) => console.log('Color changed:', value)}
          tokenSystem={tokenSystem}
          imageValue="/assets/backgrounds/default-bg.png"
          onImageChange={(path) => console.log('Image changed:', path)}
          mode="color"
          onModeChange={(mode) => console.log('Mode changed:', mode)}
          publicDirExists={true}
          projectId="project-123"
          placeholder="Choose an image..."
          inputPlaceholder="None"
          className="w-full"
          beforeUnlinkSlot={<div className="text-xs text-gray-500 mt-2 mb-1">+ Opacity</div>}
        />
      </div>
      <Routes>
        <Route path="/projects/:projectId" element={null} />
      </Routes>
    </MemoryRouter>
  );
};

interface FillPickerProps {
  // Color props
  colorValue: string;
  onColorChange: (value: string) => void;
  tokenSystem: TokenSystem;

  // Image props
  imageValue: string | null;
  onImageChange: (path: string | null) => void;

  // Mode
  mode: FillMode;
  onModeChange: (mode: FillMode) => void;

  // State
  publicDirExists: boolean;
  projectId: string;

  // Optional
  placeholder?: string;
  inputPlaceholder?: string;
  className?: string;
  /** Slot to render content between color picker and unlink button (e.g., opacity input) */
  beforeUnlinkSlot?: React.ReactNode;
  /** data-testid on the root container */
  testId?: string;
  /** data-testid on the color hex input */
  inputTestId?: string;
  /** Canvas engine instance for extracting component colors */
  engine?: CanvasEngine | null;
  /** Path to the currently open component file */
  componentPath?: string | null;
  /** Current opacity value (0-100) */
  opacity?: string;
  /** Callback when opacity changes */
  onOpacityChange?: (value: string) => void;
  /** Paired color for contrast check (text↔bg of the selected element) */
  contrastPairedHex?: string;
  /** Role of this picker: 'text' = editing text color, 'bg' = editing background */
  contrastRole?: 'text' | 'bg';
}

export function FillPicker({
  colorValue,
  onColorChange,
  tokenSystem,
  imageValue,
  onImageChange,
  mode,
  onModeChange,
  publicDirExists,
  projectId,
  placeholder,
  inputPlaceholder,
  className,
  beforeUnlinkSlot,
  testId,
  inputTestId,
  engine,
  componentPath,
  opacity,
  onOpacityChange,
  contrastPairedHex,
  contrastRole,
}: FillPickerProps) {
  // Auto-select mode based on current values
  useEffect(() => {
    if (imageValue && publicDirExists) {
      onModeChange('image');
    } else if (colorValue) {
      onModeChange('color');
    }
  }, [imageValue, colorValue, publicDirExists, onModeChange]);
  return (
    <div className={cn('flex flex-col gap-2', className)} {...(testId != null ? { 'data-testid': testId } : {})}>
      {/* Tab switcher */}
      <div className="flex gap-0.5">
        <button
          type="button"
          onClick={() => onModeChange('color')}
          title="Solid color"
          className={cn(
            'flex items-center justify-center w-7 h-6 rounded-l transition-colors',
            mode === 'color'
              ? 'bg-accent text-accent-foreground'
              : 'bg-muted text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <IconPalette className="w-4 h-4" stroke={1.5} />
        </button>
        <button
          type="button"
          onClick={() => publicDirExists && onModeChange('image')}
          disabled={!publicDirExists}
          title={publicDirExists ? 'Background image' : 'No public directory found - configure in project settings'}
          className={cn(
            'flex items-center justify-center w-7 h-6 rounded-r transition-colors',
            !publicDirExists
              ? 'bg-muted/50 text-muted-foreground/30 cursor-not-allowed'
              : mode === 'image'
                ? 'bg-accent text-accent-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <IconPhoto className="w-4 h-4" stroke={1.5} />
        </button>
      </div>
      {/* Content based on mode */}
      {mode === 'color' ? (
        <ColorCombobox
          value={colorValue}
          onChange={onColorChange}
          inputPlaceholder={inputPlaceholder || 'none'}
          tokenSystem={tokenSystem}
          inputTestId={inputTestId}
          className="flex-1"
          beforeUnlinkSlot={beforeUnlinkSlot}
          engine={engine}
          componentPath={componentPath}
          opacity={opacity}
          onOpacityChange={onOpacityChange}
          contrastPairedHex={contrastPairedHex}
          contrastRole={contrastRole}
        />
      ) : (
        <ImageBackgroundPicker
          value={imageValue}
          onChange={onImageChange}
          projectId={projectId}
          placeholder={placeholder || 'Select image...'}
          className="flex-1"
        />
      )}
    </div>
  );
}

import { MemoryRouter, Route, Routes } from 'react-router-dom';
