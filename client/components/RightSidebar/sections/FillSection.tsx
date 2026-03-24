import { TID } from '@shared/data-testid-map';
import { memo } from 'react';
import { ColorCombobox } from '../../ui/color-combobox';
import { type FillMode, FillPicker } from '../../ui/fill-picker';
import type { UIKitType } from '../types';
import { hexWithAlpha, parseHexWithAlpha } from '../utils';

interface FillSectionProps {
  backgroundColor: string;
  fillOpacity: string;
  backgroundImage: string | null;
  textColor: string;
  fillMode: FillMode;
  projectUIKit: UIKitType;
  publicDirExists: boolean;
  activeProjectId: string | null;
  onBackgroundColorChange: (value: string) => void;
  onFillOpacityChange: (value: string) => void;
  onBackgroundImageChange: (path: string | null) => void;
  onTextColorChange: (value: string) => void;
  onFillModeChange: (mode: FillMode) => void;
  syncStyleChange: (key: string, value: string) => void;
  engine?: import('@/lib/canvas-engine/core/CanvasEngine').CanvasEngine | null;
  componentPath?: string | null;
  textOpacity?: string;
  onTextOpacityChange?: (value: string) => void;
}

export const FillSection = memo(function FillSection({
  backgroundColor,
  fillOpacity,
  backgroundImage,
  textColor,
  fillMode,
  projectUIKit,
  publicDirExists,
  activeProjectId,
  onBackgroundColorChange,
  onFillOpacityChange,
  onBackgroundImageChange,
  onTextColorChange,
  onFillModeChange,
  syncStyleChange,
  engine,
  componentPath,
  textOpacity,
  onTextOpacityChange,
}: FillSectionProps) {
  const handleColorChange = (val: string) => {
    if (val?.startsWith('#')) {
      // Split incoming value: opacity input sends #RRGGBBAA, color pick sends #RRGGBB
      const { color: baseColor, opacity: incomingAlpha } = parseHexWithAlpha(val);
      // Store only 6-digit hex to avoid breaking <input type="color"> and token matching
      onBackgroundColorChange(baseColor);
      // Use incoming alpha if present (from opacity input), otherwise apply current fillOpacity
      const effectiveOpacity = incomingAlpha ?? fillOpacity ?? '100';
      const syncValue = effectiveOpacity !== '100' ? hexWithAlpha(baseColor, effectiveOpacity) : baseColor;
      syncStyleChange('backgroundColor', syncValue);
      if (!fillOpacity && !incomingAlpha) {
        onFillOpacityChange('100');
      }
    } else {
      onBackgroundColorChange(val);
      syncStyleChange('backgroundColor', val);
      if (projectUIKit === 'tamagui') {
        onFillOpacityChange('');
      }
    }
    if (val && backgroundImage) {
      onBackgroundImageChange(null);
      syncStyleChange('backgroundImage', '');
    }
  };

  const handleImageChange = (path: string | null) => {
    onBackgroundImageChange(path);
    syncStyleChange('backgroundImage', path || '');
    if (path && backgroundColor) {
      onBackgroundColorChange('');
      syncStyleChange('backgroundColor', '');
    }
  };

  return (
    <div
      data-testid={TID.inspector.sectionHeader('fill')}
      data-uniq-id="2f95e299-d823-4ec1-ba66-9d71ab8c8074"
      className="px-4 py-3 border-t border-border max-w-sidebar-section overflow-hidden"
    >
      <div data-uniq-id="42945982-1ada-4134-8f07-5756a6c5f2de" className="flex items-center justify-between mb-3">
        <span data-uniq-id="344f7abc-528e-43a9-b6f0-9146899c1566" className="text-xs font-semibold text-foreground">
          Fill
        </span>
      </div>
      <div data-uniq-id="15b6a55d-3b27-4f99-91b2-a894945e244b" className="flex items-center gap-2">
        <div data-uniq-id="f16a5fbc-a44e-4bf2-9f47-b3b761107f3c" className="flex items-end gap-px flex-1">
          <FillPicker
            testId={TID.inspector.fillColorPicker}
            inputTestId={TID.inspector.fillColorInput}
            data-uniq-id="d86f7556-47ca-4162-94e1-70539c34dfd0"
            colorValue={backgroundColor || ''}
            onColorChange={handleColorChange}
            tokenSystem={projectUIKit === 'tamagui' ? 'tamagui' : 'tailwind'}
            imageValue={backgroundImage}
            onImageChange={handleImageChange}
            mode={fillMode}
            onModeChange={onFillModeChange}
            publicDirExists={publicDirExists}
            projectId={activeProjectId || ''}
            inputPlaceholder="transparent"
            className="flex-1"
            engine={engine}
            componentPath={componentPath}
            opacity={fillOpacity}
            onOpacityChange={onFillOpacityChange}
            contrastPairedHex={textColor || undefined}
            contrastRole="bg"
          />
        </div>
      </div>
      {/* Text Color */}
      <div data-uniq-id="885cbe9f-d98b-442f-b5ad-bf282bc55810" className="flex flex-col gap-2 mt-4">
        <span
          data-uniq-id="332590c5-dc7d-462d-96fd-22ea5d625953"
          className="text-xs text-muted-foreground min-w-[60px]"
        >
          Text
        </span>
        <ColorCombobox
          testId={TID.inspector.fillTextColor}
          data-uniq-id="d59ad045-1334-475e-b11c-440bc0539261"
          value={textColor || ''}
          onChange={(val) => {
            if (val?.startsWith('#')) {
              const { color: baseColor, opacity: incomingAlpha } = parseHexWithAlpha(val);
              onTextColorChange(baseColor);
              const effectiveOpacity = incomingAlpha ?? textOpacity ?? '100';
              const syncValue = effectiveOpacity !== '100' ? hexWithAlpha(baseColor, effectiveOpacity) : baseColor;
              syncStyleChange('color', syncValue);
              if (!textOpacity && !incomingAlpha) {
                onTextOpacityChange?.(effectiveOpacity);
              }
            } else {
              onTextColorChange(val);
              syncStyleChange('color', val);
            }
          }}
          inputPlaceholder="000000"
          className="flex-1"
          tokenSystem={projectUIKit === 'tamagui' ? 'tamagui' : 'tailwind'}
          engine={engine}
          componentPath={componentPath}
          opacity={textOpacity}
          onOpacityChange={onTextOpacityChange}
          contrastPairedHex={backgroundColor || undefined}
          contrastRole="text"
        />
      </div>
    </div>
  );
});

export const SampleDefault = () => {
  return (
    <FillSection
      backgroundColor="#ffffff"
      fillOpacity="90"
      backgroundImage="/assets/wood-texture.png"
      textColor="#333333"
      fillMode="color"
      projectUIKit="tailwind"
      publicDirExists={true}
      activeProjectId="proj-abc-123"
      onBackgroundColorChange={(value) => console.log('Background color changed:', value)}
      onFillOpacityChange={(value) => console.log('Fill opacity changed:', value)}
      onBackgroundImageChange={(path) => console.log('Background image changed:', path)}
      onTextColorChange={(value) => console.log('Text color changed:', value)}
      onFillModeChange={(mode) => console.log('Fill mode changed:', mode)}
      syncStyleChange={
        (key, value) => console.log(`Style synchronized: ${key} = ${value}`) // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      }
    />
  );
};
