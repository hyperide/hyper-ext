import { IconPalette, IconPhoto } from '@tabler/icons-react';
import cn from 'clsx';
import { useEffect } from 'react';
import { ColorCombobox, type TokenSystem } from './color-combobox';
import { ImageBackgroundPicker } from './image-background-picker';

export type FillMode = 'color' | 'image';

export const SampleDefault = () => {
  const tokenSystem: TokenSystem = 'tailwind';

  return (
    <MemoryRouter data-uniq-id="f6dcf57f-eb15-46dd-9f56-4a0d6b6152c3" initialEntries={['/projects/project-123']}>
      <div data-uniq-id="dc7895e4-8445-495e-8727-f252752667ed" className="p-6 w-80">
        <FillPicker
          data-uniq-id="1be1416e-6703-4d17-a6e6-130fe78be8f7"
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
          beforeUnlinkSlot={
            <div data-uniq-id="8f1dd9f5-3abd-4a55-a0ff-b06e45e2bc3d" className="text-xs text-gray-500 mt-2 mb-1">
              + Opacity
            </div>
          }
        />
      </div>
      <Routes data-uniq-id="21eab3ef-fe33-4f91-adb1-458f12c23902">
        <Route data-uniq-id="73da322f-4dfe-4850-bbc6-f792f6621a0e" path="/projects/:projectId" element={null} />
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
    <div data-uniq-id="de8f96dd-2620-46d3-8470-968f5e707b53" className={cn('flex flex-col gap-2', className)}>
      {/* Tab switcher */}
      <div data-uniq-id="eea08778-07ef-4670-b8eb-8597c6b20048" className="flex gap-0.5">
        <button
          data-uniq-id="e242cd56-c9ba-41fb-876d-ad12adeab1ba"
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
          <IconPalette data-uniq-id="5349c3fa-7e56-46bd-b3b9-0df2bc2b5428" className="w-4 h-4" stroke={1.5} />
        </button>
        <button
          data-uniq-id="95e120b7-3f60-4c28-8bd7-f881196707db"
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
          <IconPhoto data-uniq-id="bbf2efdd-ddbb-4aca-904a-ff6c82d6d0bf" className="w-4 h-4" stroke={1.5} />
        </button>
      </div>
      {/* Content based on mode */}
      {mode === 'color' ? (
        <ColorCombobox
          data-uniq-id="671a7e49-ca36-4768-a0be-a17cff8fd6d8"
          value={colorValue}
          onChange={onColorChange}
          inputPlaceholder={inputPlaceholder || 'none'}
          tokenSystem={tokenSystem}
          className="flex-1"
          beforeUnlinkSlot={beforeUnlinkSlot}
        />
      ) : (
        <ImageBackgroundPicker
          data-uniq-id="84360881-b475-4a4d-a888-5693eda2c11c"
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
