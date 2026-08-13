import { useCallback } from 'react';
import type { PositionType } from '../types';
import { computeNumericArrowValue, positionToCss } from '../utils';

interface UseStyleHandlersDeps {
  syncStyleChange: (key: string, value: string) => void;
  setWidth: (v: string) => void;
  setHeight: (v: string) => void;
  setSelectedPosition: (v: PositionType) => void;
  setPosTop: (v: string) => void;
  setPosRight: (v: string) => void;
  setPosBottom: (v: string) => void;
  setPosLeft: (v: string) => void;
  setMarginTop: (v: string) => void;
  setMarginRight: (v: string) => void;
  setMarginBottom: (v: string) => void;
  setMarginLeft: (v: string) => void;
  setPaddingTop: (v: string) => void;
  setPaddingRight: (v: string) => void;
  setPaddingBottom: (v: string) => void;
  setPaddingLeft: (v: string) => void;
  width: string;
  height: string;
  openAIChat: (opts: { prompt: string; forceNewChat: boolean }) => void;
}

export function useStyleHandlers(deps: UseStyleHandlersDeps) {
  const {
    syncStyleChange,
    setWidth,
    setHeight,
    setSelectedPosition,
    setPosTop,
    setPosRight,
    setPosBottom,
    setPosLeft,
    setMarginTop,
    setMarginRight,
    setMarginBottom,
    setMarginLeft,
    setPaddingTop,
    setPaddingRight,
    setPaddingBottom,
    setPaddingLeft,
    width,
    height,
    openAIChat,
  } = deps;

  const handleNumericKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLInputElement>,
      currentValue: string,
      setValue: (value: string) => void,
      styleKey?: string,
      defaultValue?: string,
    ) => {
      const newValue = computeNumericArrowValue({
        key: e.key,
        currentValue,
        styleKey,
        defaultValue,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      });
      if (newValue === null) return;
      e.preventDefault();
      setValue(newValue);
      if (styleKey) syncStyleChange(styleKey, newValue);
    },
    [syncStyleChange],
  );

  const handlePositionChange = useCallback(
    (pos: PositionType) => {
      setSelectedPosition(pos);
      syncStyleChange('position', positionToCss(pos));
    },
    [syncStyleChange, setSelectedPosition],
  );

  const handlePositionValueChange = useCallback(
    (key: 'top' | 'right' | 'bottom' | 'left', value: string) => {
      const setters = {
        top: setPosTop,
        right: setPosRight,
        bottom: setPosBottom,
        left: setPosLeft,
      };
      setters[key](value);
      syncStyleChange(key, value);
    },
    [syncStyleChange, setPosTop, setPosRight, setPosBottom, setPosLeft],
  );

  const handleMarginChange = useCallback(
    (key: string, value: string) => {
      const setters: Record<string, (v: string) => void> = {
        marginTop: setMarginTop,
        marginRight: setMarginRight,
        marginBottom: setMarginBottom,
        marginLeft: setMarginLeft,
      };
      setters[key]?.(value);
      syncStyleChange(key, value);
    },
    [syncStyleChange, setMarginTop, setMarginRight, setMarginBottom, setMarginLeft],
  );

  const handleWidthChange = useCallback(
    (value: string) => {
      setWidth(value);
      syncStyleChange('width', value.replace(' Auto', ''));
    },
    [syncStyleChange, setWidth],
  );

  const handleHeightChange = useCallback(
    (value: string) => {
      setHeight(value);
      syncStyleChange('height', value.replace(' Auto', ''));
    },
    [syncStyleChange, setHeight],
  );

  const handleWidthBlur = useCallback(() => {
    const cleanWidth = width.replace(' Auto', '');
    const num = Number.parseFloat(cleanWidth);
    if (!Number.isNaN(num) && !cleanWidth.includes('px')) {
      const newValue = `${num}px`;
      setWidth(newValue);
      syncStyleChange('width', newValue);
    }
  }, [width, syncStyleChange, setWidth]);

  const handleHeightBlur = useCallback(() => {
    const cleanHeight = height.replace(' Auto', '');
    const num = Number.parseFloat(cleanHeight);
    if (!Number.isNaN(num) && !cleanHeight.includes('px')) {
      const newValue = `${num}px`;
      setHeight(newValue);
      syncStyleChange('height', newValue);
    }
  }, [height, syncStyleChange, setHeight]);

  const handleSetupTailwind = useCallback(() => {
    openAIChat({
      prompt:
        'Install and configure TailwindCSS in this project. Add tailwindcss to devDependencies, create tailwind.config.js file, and add TailwindCSS directives to the main CSS file.',
      forceNewChat: true,
    });
  }, [openAIChat]);

  const handlePaddingChange = useCallback(
    (key: string, value: string) => {
      const setters: Record<string, (v: string) => void> = {
        paddingTop: setPaddingTop,
        paddingRight: setPaddingRight,
        paddingBottom: setPaddingBottom,
        paddingLeft: setPaddingLeft,
      };
      setters[key]?.(value);
    },
    [setPaddingTop, setPaddingRight, setPaddingBottom, setPaddingLeft],
  );

  return {
    handleNumericKeyDown,
    handlePositionChange,
    handlePositionValueChange,
    handleMarginChange,
    handleWidthChange,
    handleHeightChange,
    handleWidthBlur,
    handleHeightBlur,
    handlePaddingChange,
    handleSetupTailwind,
  };
}
