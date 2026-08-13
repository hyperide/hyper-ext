import { useEffect, useRef } from 'react';
import type { ParsedStyles } from '@/lib/canvas-engine/adapters/types';
import type { CanvasEngine } from '@/lib/canvas-engine';
import type { EffectItem, StrokeItem } from '../types';
import { cssToPosition, mapShadowSizeToValues, parseHexWithAlpha } from '../utils';

interface UsePopulateStyleStateDeps {
  selectedId: string | null;
  parsedStyles: Partial<ParsedStyles> | null;
  effectiveParsed: Partial<ParsedStyles>;
  dataTextContent: string | null;
  childrenType: 'expression' | 'expression-complex' | 'jsx' | 'text' | undefined;
  engine: CanvasEngine | null;
  setSelectedPosition: React.Dispatch<React.SetStateAction<ReturnType<typeof cssToPosition>>>;
  setPosTop: React.Dispatch<React.SetStateAction<string>>;
  setPosRight: React.Dispatch<React.SetStateAction<string>>;
  setPosBottom: React.Dispatch<React.SetStateAction<string>>;
  setPosLeft: React.Dispatch<React.SetStateAction<string>>;
  setWidth: React.Dispatch<React.SetStateAction<string>>;
  setHeight: React.Dispatch<React.SetStateAction<string>>;
  setMarginTop: React.Dispatch<React.SetStateAction<string>>;
  setMarginRight: React.Dispatch<React.SetStateAction<string>>;
  setMarginBottom: React.Dispatch<React.SetStateAction<string>>;
  setMarginLeft: React.Dispatch<React.SetStateAction<string>>;
  setPaddingTop: React.Dispatch<React.SetStateAction<string>>;
  setPaddingRight: React.Dispatch<React.SetStateAction<string>>;
  setPaddingBottom: React.Dispatch<React.SetStateAction<string>>;
  setPaddingLeft: React.Dispatch<React.SetStateAction<string>>;
  setGap: React.Dispatch<React.SetStateAction<string>>;
  setJustifyContent: React.Dispatch<React.SetStateAction<string>>;
  setAlignItems: React.Dispatch<React.SetStateAction<string>>;
  setColumnGap: React.Dispatch<React.SetStateAction<string>>;
  setRowGap: React.Dispatch<React.SetStateAction<string>>;
  setGridJustifyItems: React.Dispatch<React.SetStateAction<string>>;
  setGridAlignItems: React.Dispatch<React.SetStateAction<string>>;
  setGridCols: React.Dispatch<React.SetStateAction<string>>;
  setGridRows: React.Dispatch<React.SetStateAction<string>>;
  setBackgroundColor: React.Dispatch<React.SetStateAction<string>>;
  setFillOpacity: React.Dispatch<React.SetStateAction<string>>;
  setOpacity: React.Dispatch<React.SetStateAction<string>>;
  setBackgroundImage: React.Dispatch<React.SetStateAction<string | null>>;
  setTextColor: React.Dispatch<React.SetStateAction<string>>;
  setTextOpacity: React.Dispatch<React.SetStateAction<string>>;
  setFontSize: React.Dispatch<React.SetStateAction<string>>;
  setBorderRadius: React.Dispatch<React.SetStateAction<string>>;
  setClipContent: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedLayout: React.Dispatch<React.SetStateAction<any>>;
  setStrokes: React.Dispatch<React.SetStateAction<StrokeItem[]>>;
  setEffects: React.Dispatch<React.SetStateAction<EffectItem[]>>;
  setTextContent: React.Dispatch<React.SetStateAction<any>>;
  setIsTextFromProps: React.Dispatch<React.SetStateAction<boolean>>;
  isEditingTextRef: React.RefObject<boolean>;
}

export function usePopulateStyleState(deps: UsePopulateStyleStateDeps) {
  const {
    selectedId,
    parsedStyles,
    effectiveParsed,
    dataTextContent,
    childrenType,
    engine,
    setSelectedPosition,
    setPosTop,
    setPosRight,
    setPosBottom,
    setPosLeft,
    setWidth,
    setHeight,
    setMarginTop,
    setMarginRight,
    setMarginBottom,
    setMarginLeft,
    setPaddingTop,
    setPaddingRight,
    setPaddingBottom,
    setPaddingLeft,
    setGap,
    setJustifyContent,
    setAlignItems,
    setColumnGap,
    setRowGap,
    setGridJustifyItems,
    setGridAlignItems,
    setGridCols,
    setGridRows,
    setBackgroundColor,
    setFillOpacity,
    setOpacity,
    setBackgroundImage,
    setTextColor,
    setTextOpacity,
    setFontSize,
    setBorderRadius,
    setClipContent,
    setSelectedLayout,
    setStrokes,
    setEffects,
    setTextContent,
    setIsTextFromProps,
    isEditingTextRef,
  } = deps;

  useEffect(() => {
    if (!selectedId || !parsedStyles) {
      setSelectedPosition('static');
      setPosTop('');
      setPosRight('');
      setPosBottom('');
      setPosLeft('');
      setWidth('');
      setHeight('');
      setMarginTop('');
      setMarginRight('');
      setMarginBottom('');
      setMarginLeft('');
      setPaddingTop('');
      setPaddingRight('');
      setPaddingBottom('');
      setPaddingLeft('');
      setGap('');
      setJustifyContent('');
      setAlignItems('');
      setColumnGap('');
      setRowGap('');
      setGridJustifyItems('');
      setGridAlignItems('');
      setGridCols('');
      setGridRows('');
      setBackgroundColor('');
      setFillOpacity('');
      setOpacity('');
      setBackgroundImage(null);
      setTextColor('');
      setTextOpacity('');
      setFontSize('');
      setBorderRadius('');
      setClipContent(false);
      setSelectedLayout('layout');
      setStrokes([]);
      setEffects([]);
      setTextContent('');
      setIsTextFromProps(false);
      return;
    }

    const ep = effectiveParsed;

    setSelectedPosition(cssToPosition(ep.position || 'static'));
    setPosTop(ep.top || '');
    setPosRight(ep.right || '');
    setPosBottom(ep.bottom || '');
    setPosLeft(ep.left || '');
    setWidth(ep.width || '');
    setHeight(ep.height || '');
    setMarginTop(ep.marginTop || '');
    setMarginRight(ep.marginRight || '');
    setMarginBottom(ep.marginBottom || '');
    setMarginLeft(ep.marginLeft || '');
    setPaddingTop(ep.paddingTop || '');
    setPaddingRight(ep.paddingRight || '');
    setPaddingBottom(ep.paddingBottom || '');
    setPaddingLeft(ep.paddingLeft || '');
    setGap(ep.gap || '');
    setJustifyContent(ep.justifyContent || '');
    setAlignItems(ep.alignItems || '');
    setColumnGap(ep.columnGap || '');
    setRowGap(ep.rowGap || '');
    setGridJustifyItems(ep.justifyItems || '');
    setGridAlignItems(ep.alignItems || '');
    setGridCols(ep.gridTemplateColumns || '');
    setGridRows(ep.gridTemplateRows || '');

    if (ep.backgroundColor) {
      const { color, opacity: parsedFillOpacity } = parseHexWithAlpha(ep.backgroundColor);
      setBackgroundColor(color);
      setFillOpacity(parsedFillOpacity ?? '100');
    } else {
      setBackgroundColor('');
      setFillOpacity('');
    }
    setOpacity(ep.opacity || '');
    setBackgroundImage(ep.backgroundImage || null);

    if (ep.color) {
      const { color, opacity: parsedTextOpacity } = parseHexWithAlpha(ep.color);
      setTextColor(color);
      setTextOpacity(parsedTextOpacity ?? '100');
    } else {
      setTextColor('');
      setTextOpacity('');
    }

    setFontSize(ep.fontSize ?? '');
    setBorderRadius(ep.borderRadius || '');

    if (ep.overflow === 'hidden' || ep.overflow === 'scroll' || ep.overflow === 'auto') {
      setClipContent(true);
    } else {
      setClipContent(false);
    }

    setSelectedLayout(ep.layoutType || 'layout');

    const hasAnyBorder =
      (ep.borderWidth && ep.borderWidth !== '0' && ep.borderWidth !== '0px') ||
      ep.borderTopWidth ||
      ep.borderRightWidth ||
      ep.borderBottomWidth ||
      ep.borderLeftWidth ||
      '1px';

    if (hasAnyBorder && hasAnyBorder !== '1px') {
      const borderWidth =
        ep.borderWidth ||
        ep.borderTopWidth ||
        ep.borderRightWidth ||
        ep.borderBottomWidth ||
        ep.borderLeftWidth ||
        '1px';

      setStrokes([
        {
          id: '1',
          visible: true,
          color: ep.borderColor || '#000000',
          opacity: '100',
          width: borderWidth.replace('px', ''),
          style: (ep.borderStyle as StrokeItem['style']) || 'solid',
          sides: {
            top: !!ep.borderWidth || !!ep.borderTopWidth,
            right: !!ep.borderWidth || !!ep.borderRightWidth,
            bottom: !!ep.borderWidth || !!ep.borderBottomWidth,
            left: !!ep.borderWidth || !!ep.borderLeftWidth,
          },
        },
      ]);
    } else {
      setStrokes([]);
    }

    const newEffects: EffectItem[] = [];
    if (ep.shadow && ep.shadow !== 'none') {
      const hasArbitraryValues = ep.shadowX || ep.shadowY || ep.shadowBlur || ep.shadowSpread;
      const isPreset = !hasArbitraryValues && ['sm', 'default', 'md', 'lg', 'xl', '2xl', 'inner'].includes(ep.shadow);

      const values = hasArbitraryValues
        ? {
            x: ep.shadowX,
            y: ep.shadowY,
            blur: ep.shadowBlur,
            spread: ep.shadowSpread,
          }
        : mapShadowSizeToValues(
            ep.shadow === 'inner' ? 'default' : ep.shadow,
            ep.shadow === 'inner' ? 'inner-shadow' : 'drop-shadow',
          );

      let color = '#000000';
      let shadowOpacity = '100';
      if (ep.shadowColor?.match(/^#[0-9a-fA-F]{8}$/)) {
        color = ep.shadowColor.slice(0, 7);
        const alpha = Number.parseInt(ep.shadowColor.slice(7, 9), 16);
        shadowOpacity = Math.round((alpha / 255) * 100).toString();
      } else if (ep.shadowColor) {
        color = ep.shadowColor;
        shadowOpacity = ep.shadowOpacity || '100';
      }

      newEffects.push({
        id: '1',
        visible: true,
        type: ep.shadow === 'inner' ? 'inner-shadow' : 'drop-shadow',
        x: values.x,
        y: values.y,
        blur: values.blur,
        spread: values.spread,
        color,
        opacity: shadowOpacity,
        preset: isPreset ? ep.shadow : undefined,
      });
    }
    if (ep.blur && ep.blur !== 'none') {
      newEffects.push({
        id: '2',
        visible: true,
        type: 'blur',
        value: ep.blur,
        color: '#000000',
        opacity: '100',
      });
    }
    setEffects(newEffects);

    if (!isEditingTextRef.current) {
      setTextContent(dataTextContent);
    }
    setIsTextFromProps(engine !== null && !childrenType && !!dataTextContent);
  }, [selectedId, parsedStyles, effectiveParsed, dataTextContent, childrenType, engine]);
}
