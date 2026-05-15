import { TID } from '@shared/data-testid-map';
import { memo } from 'react';
import { ColorCombobox } from '../../ui/color-combobox';
import { type FillMode, FillPicker } from '../../ui/fill-picker';
import { Input } from '../../ui/input';
import type { UIKitType } from '../types';
import { hexWithAlpha, parseHexWithAlpha } from '../utils';

interface FillSectionProps {
  backgroundColor: string;
  fillOpacity: string;
  backgroundImage: string | null;
  textColor: string;
  fontSize: string;
  fillMode: FillMode;
  projectUIKit: UIKitType;
  publicDirExists: boolean;
  activeProjectId: string | null;
  onBackgroundColorChange: (value: string) => void;
  onFillOpacityChange: (value: string) => void;
  onBackgroundImageChange: (path: string | null) => void;
  onTextColorChange: (value: string) => void;
  onFontSizeChange: (value: string) => void;
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
  fontSize,
  fillMode,
  projectUIKit,
  publicDirExists,
  activeProjectId,
  onBackgroundColorChange,
  onFillOpacityChange,
  onBackgroundImageChange,
  onTextColorChange,
  onFontSizeChange,
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

  const handleFontSizeBlur = () => {
    const trimmed = fontSize.trim();
    if (!trimmed) return;
    if (/^-?\d*\.?\d+$/.test(trimmed)) {
      const normalized = `${trimmed}px`;
      if (normalized !== fontSize) {
        onFontSizeChange(normalized);
        syncStyleChange('fontSize', normalized);
      }
    }
  };

  return (
    <div
      data-testid={TID.inspector.sectionHeader('fill')}
      className="w-full px-4 py-3 border-t border-border overflow-hidden"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-foreground">Fill</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-end gap-px flex-1">
          <FillPicker
            testId={TID.inspector.fillColorPicker}
            inputTestId={TID.inspector.fillColorInput}
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
      <div className="flex flex-col gap-2 mt-4">
        <span className="text-xs text-muted-foreground min-w-[60px]">Text</span>
        <ColorCombobox
          testId={TID.inspector.fillTextColor}
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
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground min-w-[60px]">Size</span>
          <div className="flex-1 h-6 px-2 bg-muted rounded flex items-center">
            <Input
              testId={TID.inspector.fontSize}
              value={fontSize ?? ''}
              onChange={(e) => {
                onFontSizeChange(e.target.value);
                syncStyleChange('fontSize', e.target.value);
              }}
              onBlur={handleFontSizeBlur}
              placeholder="15px"
              className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 w-full"
            />
          </div>
        </div>
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
      fontSize="15px"
      fillMode="color"
      projectUIKit="tailwind"
      publicDirExists={true}
      activeProjectId="proj-abc-123"
      onBackgroundColorChange={(value) => console.log('Background color changed:', value)}
      onFillOpacityChange={(value) => console.log('Fill opacity changed:', value)}
      onBackgroundImageChange={(path) => console.log('Background image changed:', path)}
      onTextColorChange={(value) => console.log('Text color changed:', value)}
      onFontSizeChange={(value) => console.log('Font size changed:', value)}
      onFillModeChange={(mode) => console.log('Fill mode changed:', mode)}
      syncStyleChange={
        (key, value) => console.log(`Style synchronized: ${key} = ${value}`) // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      }
    />
  );
};
