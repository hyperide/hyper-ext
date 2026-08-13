import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutType } from '../../types';

const DB = { debounceOnly: true } as const;

export interface UseLayoutSectionParams {
  selectedLayout: LayoutType;
  width: string;
  height: string;
  justifyContent: string;
  alignItems: string;
  clipContent: boolean;
  onLayoutChange: (layout: LayoutType) => void;
  onWidthChange: (value: string) => void;
  onHeightChange: (value: string) => void;
  onJustifyContentChange: (value: string) => void;
  onAlignItemsChange: (value: string) => void;
  onPaddingChange: (key: string, value: string) => void;
  onClipContentChange: (value: boolean) => void;
  syncStyleChange: (key: string, value: string, options?: { debounceOnly?: boolean }) => void;
  onGridJustifyItemsChange: (value: string) => void;
  onGridAlignItemsChange: (value: string) => void;
}

export function useLayoutSection({
  selectedLayout,
  width,
  height,
  justifyContent,
  alignItems,
  clipContent,
  onWidthChange,
  onHeightChange,
  onJustifyContentChange,
  onAlignItemsChange,
  onPaddingChange,
  onClipContentChange,
  syncStyleChange,
  onGridJustifyItemsChange,
  onGridAlignItemsChange,
}: UseLayoutSectionParams) {
  const [aspectRatioLocked, setAspectRatioLocked] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [paddingExpanded, setPaddingExpanded] = useState(false);
  const [showGridTooltip, setShowGridTooltip] = useState(false);
  const bothStretchClickCountRef = useRef(0);
  const bothStretchClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bothStretchLastClickTimeRef = useRef(0);

  useEffect(() => {
    if (selectedLayout === 'grid') {
      const dismissed = localStorage.getItem('gridStretchTooltipDismissed');
      if (!dismissed) setShowGridTooltip(true);
    } else {
      setShowGridTooltip(false);
    }
  }, [selectedLayout]);

  const dismissGridTooltip = useCallback(() => {
    setShowGridTooltip(false);
    localStorage.setItem('gridStretchTooltipDismissed', 'true');
  }, []);

  const handleAspectRatioToggle = useCallback(() => {
    if (!aspectRatioLocked) {
      const widthNum = Number.parseFloat(width) || 0;
      const heightNum = Number.parseFloat(height) || 0;
      if (widthNum > 0 && heightNum > 0) {
        setAspectRatio(widthNum / heightNum);
        setAspectRatioLocked(true);
      }
    } else {
      setAspectRatioLocked(false);
      setAspectRatio(null);
    }
  }, [aspectRatioLocked, width, height]);

  const handleWidthInputChange = useCallback(
    (value: string) => {
      onWidthChange(value);
      if (aspectRatioLocked && aspectRatio) {
        const widthNum = Number.parseFloat(value) || 0;
        if (widthNum > 0) {
          onHeightChange(`${widthNum / aspectRatio}px`);
        }
      }
    },
    [aspectRatioLocked, aspectRatio, onWidthChange, onHeightChange],
  );

  const handleHeightInputChange = useCallback(
    (value: string) => {
      onHeightChange(value);
      if (aspectRatioLocked && aspectRatio) {
        const heightNum = Number.parseFloat(value) || 0;
        if (heightNum > 0) {
          onWidthChange(`${heightNum * aspectRatio}px`);
        }
      }
    },
    [aspectRatioLocked, aspectRatio, onWidthChange, onHeightChange],
  );

  const handleLayoutGridClick = useCallback(
    (pos: { justify: string; align: string }) => {
      const isSpaceBetween = justifyContent === 'space-between';
      if (isSpaceBetween) {
        if (selectedLayout === 'row') {
          syncStyleChange('alignItems', pos.align, DB);
          onAlignItemsChange(pos.align);
        } else {
          syncStyleChange('alignItems', pos.justify, DB);
          onAlignItemsChange(pos.justify);
        }
      } else {
        if (selectedLayout === 'row') {
          syncStyleChange('justifyContent', pos.justify, DB);
          syncStyleChange('alignItems', pos.align, DB);
          onJustifyContentChange(pos.justify);
          onAlignItemsChange(pos.align);
        } else {
          syncStyleChange('justifyContent', pos.align, DB);
          syncStyleChange('alignItems', pos.justify, DB);
          onJustifyContentChange(pos.align);
          onAlignItemsChange(pos.justify);
        }
      }
    },
    [selectedLayout, justifyContent, syncStyleChange, onJustifyContentChange, onAlignItemsChange],
  );

  const handleLayoutGridDoubleClick = useCallback(
    (pos: { justify: string; align: string }) => {
      const isSpaceBetween = justifyContent === 'space-between';
      if (isSpaceBetween) {
        if (selectedLayout === 'row') {
          syncStyleChange('justifyContent', pos.justify, DB);
          syncStyleChange('alignItems', pos.align, DB);
          onJustifyContentChange(pos.justify);
          onAlignItemsChange(pos.align);
        } else {
          syncStyleChange('justifyContent', pos.align, DB);
          syncStyleChange('alignItems', pos.justify, DB);
          onJustifyContentChange(pos.align);
          onAlignItemsChange(pos.justify);
        }
      } else {
        syncStyleChange('justifyContent', 'space-between', DB);
        onJustifyContentChange('space-between');
        if (selectedLayout === 'row') {
          syncStyleChange('alignItems', pos.align, DB);
          onAlignItemsChange(pos.align);
        } else {
          syncStyleChange('alignItems', pos.justify, DB);
          onAlignItemsChange(pos.justify);
        }
      }
    },
    [selectedLayout, justifyContent, syncStyleChange, onJustifyContentChange, onAlignItemsChange],
  );

  const handleHorizontalPaddingChange = useCallback(
    (value: string) => {
      onPaddingChange('paddingLeft', value);
      onPaddingChange('paddingRight', value);
      syncStyleChange('paddingLeft', value, DB);
      syncStyleChange('paddingRight', value, DB);
    },
    [onPaddingChange, syncStyleChange],
  );

  const handleVerticalPaddingChange = useCallback(
    (value: string) => {
      onPaddingChange('paddingTop', value);
      onPaddingChange('paddingBottom', value);
      syncStyleChange('paddingTop', value, DB);
      syncStyleChange('paddingBottom', value, DB);
    },
    [onPaddingChange, syncStyleChange],
  );

  const handleClipContentToggle = useCallback(() => {
    const newValue = !clipContent;
    onClipContentChange(newValue);
    syncStyleChange('overflow', newValue ? 'hidden' : 'visible');
  }, [clipContent, onClipContentChange, syncStyleChange]);

  const handleGridClick = useCallback(
    (
      pos: { justify: string; align: string; col: number; row: number },
      gridState: { isBothStretch: boolean; isHorStretch: boolean; isVertStretch: boolean },
    ) => {
      const { isBothStretch, isHorStretch, isVertStretch } = gridState;
      const alignValue = pos.align === 'flex-start' ? 'start' : pos.align === 'flex-end' ? 'end' : pos.align;
      const justifyValue = pos.justify === 'flex-start' ? 'start' : pos.justify === 'flex-end' ? 'end' : pos.justify;

      if (isBothStretch) {
        const now = Date.now();
        const timeSinceLastClick = now - bothStretchLastClickTimeRef.current;
        bothStretchLastClickTimeRef.current = now;
        bothStretchClickCountRef.current += 1;
        if (bothStretchClickTimerRef.current) clearTimeout(bothStretchClickTimerRef.current);
        if (bothStretchClickCountRef.current >= 2 && timeSinceLastClick > 500) {
          setShowGridTooltip(true);
          localStorage.removeItem('gridStretchTooltipDismissed');
          bothStretchClickCountRef.current = 0;
        } else {
          bothStretchClickTimerRef.current = setTimeout(() => {
            bothStretchClickCountRef.current = 0;
          }, 10_000);
        }
      } else if (isHorStretch) {
        syncStyleChange('alignItems', alignValue, DB);
        onGridAlignItemsChange(pos.align);
      } else if (isVertStretch) {
        syncStyleChange('justifyItems', justifyValue, DB);
        onGridJustifyItemsChange(pos.justify);
      } else {
        syncStyleChange('justifyItems', justifyValue, DB);
        syncStyleChange('alignItems', alignValue, DB);
        onGridJustifyItemsChange(pos.justify);
        onGridAlignItemsChange(pos.align);
      }
    },
    [syncStyleChange, onGridJustifyItemsChange, onGridAlignItemsChange],
  );

  const handleGridDoubleClick = useCallback(
    (
      pos: { justify: string; align: string },
      gridState: { isBothStretch: boolean; isHorStretch: boolean; isVertStretch: boolean },
    ) => {
      const { isBothStretch, isHorStretch, isVertStretch } = gridState;
      bothStretchClickCountRef.current = 0;
      if (bothStretchClickTimerRef.current) clearTimeout(bothStretchClickTimerRef.current);

      if (isBothStretch) {
        syncStyleChange(
          'justifyItems',
          pos.justify === 'flex-start' ? 'start' : pos.justify === 'flex-end' ? 'end' : pos.justify,
          DB,
        );
        syncStyleChange(
          'alignItems',
          pos.align === 'flex-start' ? 'start' : pos.align === 'flex-end' ? 'end' : pos.align,
          DB,
        );
        onGridJustifyItemsChange(pos.justify);
        onGridAlignItemsChange(pos.align);
      } else if (isVertStretch) {
        syncStyleChange(
          'justifyItems',
          pos.justify === 'flex-start' ? 'start' : pos.justify === 'flex-end' ? 'end' : pos.justify,
          DB,
        );
        syncStyleChange('alignItems', 'stretch', DB);
        onGridJustifyItemsChange(pos.justify);
        onGridAlignItemsChange('stretch');
      } else if (isHorStretch) {
        syncStyleChange('justifyItems', 'stretch', DB);
        syncStyleChange(
          'alignItems',
          pos.align === 'flex-start' ? 'start' : pos.align === 'flex-end' ? 'end' : pos.align,
          DB,
        );
        onGridJustifyItemsChange('stretch');
        onGridAlignItemsChange(pos.align);
      } else {
        syncStyleChange('justifyItems', 'stretch', DB);
        syncStyleChange(
          'alignItems',
          pos.align === 'flex-start' ? 'start' : pos.align === 'flex-end' ? 'end' : pos.align,
          DB,
        );
        onGridJustifyItemsChange('stretch');
        onGridAlignItemsChange(pos.align);
      }
    },
    [syncStyleChange, onGridJustifyItemsChange, onGridAlignItemsChange],
  );

  return {
    aspectRatioLocked,
    paddingExpanded,
    showGridTooltip,
    setPaddingExpanded,
    dismissGridTooltip,
    handleAspectRatioToggle,
    handleWidthInputChange,
    handleHeightInputChange,
    handleLayoutGridClick,
    handleLayoutGridDoubleClick,
    handleHorizontalPaddingChange,
    handleVerticalPaddingChange,
    handleClipContentToggle,
    handleGridClick,
    handleGridDoubleClick,
  };
}
