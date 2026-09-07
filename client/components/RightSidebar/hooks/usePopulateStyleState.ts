import { useEffect, useRef } from 'react';
import type { ParsedStyles } from '@/lib/canvas-engine/adapters/types';
import type { CanvasEngine } from '@/lib/canvas-engine';
import type { EffectItem, LayoutType, StrokeItem } from '../types';
import { cssToPosition, mapShadowSizeToValues, parseHexWithAlpha } from '../utils';

// Text-entry input types whose focus means "the user is typing a value". Excludes
// checkbox/radio/color/range/etc. — clicking a color swatch or toggle must NOT freeze
// inspector population.
const TEXT_ENTRY_INPUT_TYPES = new Set(['text', 'number', 'search', 'tel', 'url', 'email', 'password']);

/**
 * True when the user is currently typing into an inspector numeric/text field.
 *
 * Every inspector style write triggers an HMR re-read that re-runs the populate effect.
 * If the edited field is focused, repopulating it with the last-committed computed value
 * clobbers the in-progress edit — keystrokes get eaten (typing "12px" landed as "2px") and
 * the value reverts to the computed default the moment it is written, so an ArrowUp nudge
 * increments an empty field to "1" instead of the visible value to "11" (HYP-1001).
 *
 * Scope note: the inspector (RightSidebar) renders inside its OWN webview document —
 * separate from the AI-chat and left-sidebar webviews — so any focused text-entry input in
 * this document is an inspector field. The guard is intentionally document-wide within the
 * inspector rather than per-field: while one field is being edited, the whole populate pass
 * is skipped, so a simultaneous EXTERNAL change to a different field (canvas drag-resize,
 * undo, AI edit) is not reflected until the next re-read after blur/commit — an acceptable
 * trade for never eating the user's keystrokes. The normal edit flow always triggers that
 * follow-up re-read (the commit writes → re-reads); a purely external change with no
 * subsequent re-read is the only case that stays stale until the next inspector interaction.
 */
function isInspectorFieldFocused(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return TEXT_ENTRY_INPUT_TYPES.has((el as HTMLInputElement).type);
}

/**
 * CONTRACT: every `set*` field below MUST be a raw `useState` setter (or an equally
 * identity-stable dispatch, e.g. `useReducer`'s dispatch) — never a wrapped/derived function
 * (`useCallback`, an inline arrow, a context value recreated per render). The populate effect
 * in this hook lists all of them in its dependency array; a non-stable setter would make that
 * effect re-run on every render instead of only on real selection/style-source changes,
 * re-clobbering in-progress inspector edits. The type system can't enforce this — it's a
 * runtime identity contract, not a structural one — so it's stated here where every caller
 * sees it before wiring a new setter through.
 */
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
  setSelectedLayout: React.Dispatch<React.SetStateAction<LayoutType>>;
  setStrokes: React.Dispatch<React.SetStateAction<StrokeItem[]>>;
  setEffects: React.Dispatch<React.SetStateAction<EffectItem[]>>;
  // biome/oxlint: `any` here is deliberate, NOT a lazy placeholder — `dataTextContent` is
  // `string | null` (see below) but the concrete `setTextContent` passed by every current
  // caller (RightSidebar.tsx `useState('')`) is `Dispatch<SetStateAction<string>>`, which
  // does not accept `null`. Narrowing this to `string | null` breaks that call site's
  // typecheck; narrowing to `string` and adding `?? ''` at the one call site (line ~354)
  // would change runtime behavior (a real null currently flows through, and RightSidebar's
  // controlled `<input value={textContent}>` may already rely on/be affected by that — not
  // verified here). Needs a real decision, not a lint-debt-cleanup guess — tracked as
  // HYP-1322.
  // oxlint-disable-next-line no-explicit-any
  setTextContent: React.Dispatch<React.SetStateAction<any>>;
  setIsTextFromProps: React.Dispatch<React.SetStateAction<boolean>>;
  isEditingTextRef: React.RefObject<boolean>;
}

export function usePopulateStyleState(deps: UsePopulateStyleStateDeps) {
  // Track previous selectedId to detect when the user has switched to a different
  // element. When selectedId changes, parsedStyles still holds the previous element's
  // data for this render cycle — useElementStyleData's setData fires in the same
  // effects batch but its setState won't apply until the next render. Clearing on a
  // genuine selection transition prevents the inspector from briefly showing stale
  // values from the old element.
  const prevSelectedIdRef = useRef<string | null>(null);

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
    // A genuine element-to-element transition: prevRef is non-null (not the initial mount)
    // and selectedId has changed to a different value. On initial mount prevRef is null, so
    // the first selection is not treated as a transition — parsedStyles is correct there.
    const selectionChanged = prevSelectedIdRef.current !== null && prevSelectedIdRef.current !== selectedId;
    prevSelectedIdRef.current = selectedId;

    // Clear when: no element selected, no styles yet, OR selection just changed to a new element.
    // The selectionChanged case is the stale-data guard: parsedStyles still carries the previous
    // element's values in this render cycle (useElementStyleData's setData fires in the same
    // effects batch but its setState won't apply until the next render). The populate branch
    // runs on the next render, after useElementStyleData has delivered the new element's data.
    if (!selectedId || !parsedStyles || selectionChanged) {
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

    // Same element still selected (a genuine selection change already cleared+returned
    // above). If the user is mid-edit in a focused field, do NOT repopulate — the re-read
    // that triggered this run must not overwrite what they are typing (see
    // isInspectorFieldFocused). On blur the next re-read repopulates normally.
    if (isInspectorFieldFocused()) return;

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
    // The ~38 `set*` state setters below are listed, not suppressed: they are useState
    // setters, which React guarantees have a stable identity across renders, so listing them
    // is behavior-neutral (no extra re-runs) and keeps this rule live for any REAL future
    // missing dependency in this large effect body — the opposite of what a blanket
    // exhaustive-deps suppression here would do.
  }, [
    selectedId,
    parsedStyles,
    effectiveParsed,
    dataTextContent,
    childrenType,
    engine,
    isEditingTextRef,
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
  ]);
}
