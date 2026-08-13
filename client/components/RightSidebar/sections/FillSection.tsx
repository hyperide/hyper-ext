import { TID } from '@shared/data-testid-map';
import { memo } from 'react';
import { ColorCombobox } from '../../ui/color-combobox';
import { type FillMode, FillPicker } from '../../ui/fill-picker';
import { HintTooltip } from '../../ui/hint-tooltip';
import { Input } from '../../ui/input';
import type { UIKitType } from '../types';
import { hexWithAlpha, parseHexWithAlpha } from '../utils';

/**
 * Pick the background to judge the element's text contrast against: the resolved
 * effective painted background when available, otherwise the element's own background —
 * but never the literal `transparent`, which produces a meaningless 1:1 "Bad" verdict.
 */
function resolveTextContrastBg(effective: string | undefined, ownBg: string): string | undefined {
  if (effective) return effective;
  if (ownBg && ownBg.toLowerCase() !== 'transparent') return ownBg;
  return undefined;
}

interface FillSectionProps {
  backgroundColor: string;
  /** Effective painted background ('#rrggbb') used as the contrast pair for text color. */
  textContrastBackgroundHex?: string;
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
  onNumericKeyDown?: (
    e: React.KeyboardEvent<HTMLInputElement>,
    currentValue: string,
    setValue: (value: string) => void,
    styleKey?: string,
    defaultValue?: string,
  ) => void;
  engine?: import('@/lib/canvas-engine/core/CanvasEngine').CanvasEngine | null;
  componentPath?: string | null;
  textOpacity?: string;
  onTextOpacityChange?: (value: string) => void;
}

export const FillSection = memo(function FillSection({
  backgroundColor,
  textContrastBackgroundHex,
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
  onNumericKeyDown,
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
          {/* See the StrokeSection ColorCombobox wrapper comment (tracked as HYP-1086): FillPicker
              doesn't spread arbitrary trigger props either, so HintTooltip needs a plain <div>
              here for its pointer/focus handlers to actually attach to a DOM node. */}
          {/* Layout sizing lives on this wrapper `flex-1` div now that it — not FillPicker's own
              root — is the flex item in the row above; FillPicker no longer needs its own
              `flex-1` (its root is a block-level element and fills the wrapper's width either
              way, but keeping the class only on one owner avoids two sources of truth). */}
          <HintTooltip label="Fill color — background color or image">
            <div className="flex-1">
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
                engine={engine}
                componentPath={componentPath}
                opacity={fillOpacity}
                onOpacityChange={onFillOpacityChange}
                contrastPairedHex={textColor || undefined}
                contrastRole="bg"
              />
            </div>
          </HintTooltip>
        </div>
      </div>
      {/* Text Color */}
      <div className="flex flex-col gap-2 mt-4">
        <span className="text-xs text-muted-foreground min-w-[60px]">Text</span>
        {/* Layout sizing moved to this wrapper (was on ColorCombobox's own `flex-1`, now dead
            since ColorCombobox's root is no longer the direct flex-col child). */}
        <HintTooltip label="Text color">
          <div className="flex-1">
            <ColorCombobox
              testId={TID.inspector.fillTextColor}
              value={textColor || ''}
              onChange={(val) => {
                if (val?.startsWith('#')) {
                  const { color: baseColor, opacity: incomingAlpha } = parseHexWithAlpha(val);
                  onTextColorChange(baseColor);
                  const effectiveOpacity = incomingAlpha ?? textOpacity ?? '100';
                  const syncValue =
                    effectiveOpacity !== '100' ? hexWithAlpha(baseColor, effectiveOpacity) : baseColor;
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
              tokenSystem={projectUIKit === 'tamagui' ? 'tamagui' : 'tailwind'}
              engine={engine}
              componentPath={componentPath}
              opacity={textOpacity}
              onOpacityChange={onTextOpacityChange}
              contrastPairedHex={resolveTextContrastBg(textContrastBackgroundHex, backgroundColor)}
              contrastRole="text"
            />
          </div>
        </HintTooltip>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground min-w-[60px]">Size</span>
          <HintTooltip label="Font size — press ↑/↓ to nudge by 1px, Shift+↑/↓ by 10px">
            <div className="flex-1 h-6 px-2 bg-muted rounded flex items-center">
              <Input
                testId={TID.inspector.fontSize}
                value={fontSize ?? ''}
                onChange={(e) => {
                  onFontSizeChange(e.target.value);
                  syncStyleChange('fontSize', e.target.value);
                }}
                onBlur={handleFontSizeBlur}
                onKeyDown={(e) => onNumericKeyDown?.(e, fontSize ?? '', onFontSizeChange, 'fontSize')}
                placeholder="15px"
                className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 w-full"
              />
            </div>
          </HintTooltip>
        </div>
      </div>
    </div>
  );
});

export const SampleDefault = () => {
  return (
    <FillSection
      backgroundColor="hsl(var(--background))"
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
