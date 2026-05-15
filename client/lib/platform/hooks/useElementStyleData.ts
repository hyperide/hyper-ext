/**
 * useElementStyleData — reads element style data for the inspector panel.
 *
 * Two modes:
 * 1. Browser/SaaS: engine + DOM (synchronous, reads AST node + iframe DOM element)
 * 2. VS Code webview: RPC via canvas (async, sends styles:readClassName to extension host)
 *
 * Mode is auto-detected: if engine is provided, uses browser path.
 */

import type { StyleReadResult } from '@lib/style-read/types';
import type { SelectedElementRuntimeStyle } from '@lib/types';
import type { I18nBindingResult } from '@shared/i18n-text/types';
import { normalizeComputedColor } from '@shared/utils/color';
import { useEffect, useMemo, useRef, useState } from 'react';
import { findNodeById } from '@/components/RightSidebar/utils';
import type { CanvasEngine } from '@/lib/canvas-engine';
import type { StyleAdapter } from '@/lib/canvas-engine/adapters/StyleAdapter';
import type { ParsedStyles } from '@/lib/canvas-engine/adapters/types';
import type { ParsedTailwindStyles } from '@/lib/canvas-engine/utils/tailwindParser';
import { parseTailwindClasses } from '@/lib/canvas-engine/utils/tailwindParser';
import { getElementFromIframe } from '@/lib/dom-utils';
import { getActiveTracer } from '@/lib/element-tracing/active-tracer';
import { findAstNodeBySourceLoc } from '@/lib/element-tracing/id-bridge';
import type { CanvasAdapter, MessageOfType } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface ElementStyleData {
  /** Full parsed styles including state variants (hover, focus, etc.) */
  parsedStyles: ParsedStyles | null;
  /** Type of children content in the element */
  childrenType: 'text' | 'expression' | 'expression-complex' | 'jsx' | undefined;
  /** Text content of the element (if applicable) */
  textContent: string;
  /** Element tag type (div, Button, etc.) */
  tagType: string;
  /** Whether data is currently loading */
  loading: boolean;
  /** Location of the first meaningful child in source (VS Code only) */
  childrenLocation?: { line: number; column: number };
  /** Shared read result with source ownership tabs and inspector decisions */
  styleReadResult?: StyleReadResult;
  /** i18n binding detected in JSX expression children (VS Code only; SaaS browser requires server-side read path) */
  i18nText?: I18nBindingResult;
  /** All available i18n keys from the locale file (VS Code only; populated after i18nText arrives) */
  availableKeys?: string[];
}

export interface UseElementStyleDataOptions {
  elementId: string | null;
  componentPath: string | null;
  /** Canvas adapter for VS Code RPC (always available via PlatformProvider) */
  canvas?: CanvasAdapter | null;
  /** Canvas engine — present in browser/SaaS, absent in VS Code */
  engine?: CanvasEngine | null;
  /** Style adapter — required for browser mode (reads AST node + DOM) */
  styleAdapter?: StyleAdapter | null;
  /** Active instance ID — for scoping DOM queries in multi-instance mode */
  activeInstanceId?: string | null;
  /** Item index for .map()-rendered elements — selects specific item in DOM */
  itemIndex?: number | null;
  /** Increment to force re-read of styles (VS Code mode) */
  refreshKey?: number;
  /** Runtime computed style snapshot from the preview iframe. Used to fill in CSS-variable-based
   *  Tailwind values (e.g. bg-primary/15) that the extension-host parser cannot resolve. */
  runtimeStyle?: SelectedElementRuntimeStyle | null;
  /** Trimmed innerText from the selected DOM element — used for i18n DOM-text search. */
  domTextContent?: string;
  /** When set, resolve i18n text for this locale (VS Code only). Triggers a re-read when changed. */
  activeLocale?: string;
}

// ============================================================================
// Conversion helpers (extracted from TailwindAdapter.read logic)
// ============================================================================

function convertStateStyles(state: Partial<ParsedTailwindStyles> | undefined): Partial<ParsedStyles> | undefined {
  if (!state) return undefined;

  const converted: Partial<ParsedStyles> = {};

  if (state.flexDirection) {
    converted.flexDirection =
      state.flexDirection === 'column' ? 'column' : state.flexDirection === 'row' ? 'row' : undefined;
  }

  for (const [key, value] of Object.entries(state)) {
    if (
      key !== 'flexDirection' &&
      key !== 'hover' &&
      key !== 'focus' &&
      key !== 'active' &&
      key !== 'focusVisible' &&
      key !== 'disabled' &&
      key !== 'groupHover' &&
      key !== 'groupFocus' &&
      key !== 'focusWithin'
    ) {
      (converted as Record<string, unknown>)[key] = value;
    }
  }

  return converted;
}

/**
 * Convert a raw className string to ParsedStyles.
 * Same logic as TailwindAdapter.read() but without DOM element access.
 */
export function classNameToStyles(className: string): ParsedStyles {
  const parsed = parseTailwindClasses(className);

  let layoutType: 'layout' | 'col' | 'row' | 'grid' = 'layout';
  if (parsed.display === 'grid' || parsed.display === 'inline-grid') {
    layoutType = 'grid';
  } else if (parsed.display === 'flex' || parsed.display === 'inline-flex') {
    layoutType = parsed.flexDirection === 'column' ? 'col' : 'row';
  }

  const flexDirection: 'row' | 'column' | undefined =
    parsed.flexDirection === 'column' ? 'column' : parsed.flexDirection === 'row' ? 'row' : undefined;

  return {
    ...parsed,
    flexDirection,
    layoutType,
    fontSize: parsed.fontSize,
    color: parsed.textColor,
    paddingTop: parsed.padding?.top,
    paddingRight: parsed.padding?.right,
    paddingBottom: parsed.padding?.bottom,
    paddingLeft: parsed.padding?.left,
    marginTop: parsed.margin?.top,
    marginRight: parsed.margin?.right,
    marginBottom: parsed.margin?.bottom,
    marginLeft: parsed.margin?.left,
    hover: convertStateStyles(parsed.hover),
    focus: convertStateStyles(parsed.focus),
    active: convertStateStyles(parsed.active),
    focusVisible: convertStateStyles(parsed.focusVisible),
    disabled: convertStateStyles(parsed.disabled),
    groupHover: convertStateStyles(parsed.groupHover),
    groupFocus: convertStateStyles(parsed.groupFocus),
    focusWithin: convertStateStyles(parsed.focusWithin),
  };
}

// ============================================================================
// Runtime style merge helper
// ============================================================================

/**
 * Fill in ParsedStyles fields that Tailwind parsing could not resolve
 * (e.g. CSS-variable-backed tokens like bg-primary/15) using the browser's
 * getComputedStyle snapshot captured in the iframe on element click.
 *
 * Only fills missing/empty values — never overwrites Tailwind-parsed results.
 */
export function mergeRuntimeStyle(
  base: ParsedStyles,
  runtime: SelectedElementRuntimeStyle | null | undefined,
  elementId: string | null,
  itemIndex?: number | null,
): ParsedStyles {
  if (!runtime || !elementId || runtime.elementId !== elementId) return base;
  // For .map()-rendered elements, discard a snapshot from a different item index.
  if (runtime.itemIndex != null && itemIndex != null && runtime.itemIndex !== itemIndex) return base;

  const cs = runtime.computedStyle;
  const merged: ParsedStyles = { ...base };
  let changed = false;

  if (!merged.backgroundColor && cs.backgroundColor) {
    const normalized = normalizeComputedColor(cs.backgroundColor);
    if (normalized) {
      merged.backgroundColor = normalized;
      changed = true;
    }
  }

  if (!merged.color && cs.color) {
    const normalized = normalizeComputedColor(cs.color);
    if (normalized) {
      merged.color = normalized;
      changed = true;
    }
  }

  if (!merged.borderColor && cs.borderColor) {
    const normalized = normalizeComputedColor(cs.borderColor);
    if (normalized) {
      merged.borderColor = normalized;
      changed = true;
    }
  }

  if (!merged.borderWidth && cs.borderWidth && cs.borderWidth !== '0px') {
    merged.borderWidth = cs.borderWidth;
    changed = true;
  }

  if (!merged.borderStyle && cs.borderStyle) {
    merged.borderStyle = cs.borderStyle;
    changed = true;
  }

  if (!merged.borderRadius && cs.borderRadius) {
    merged.borderRadius = cs.borderRadius;
    changed = true;
  }

  if (merged.opacity == null && cs.opacity) {
    const num = Number.parseFloat(cs.opacity);
    if (!Number.isNaN(num)) {
      merged.opacity = Math.round(num * 100).toString();
      changed = true;
    }
  }

  if (!merged.fontSize && cs.fontSize) {
    merged.fontSize = cs.fontSize;
    changed = true;
  }

  return changed ? merged : base;
}

// ============================================================================
// Default empty state
// ============================================================================

const EMPTY_DATA: ElementStyleData = {
  parsedStyles: null,
  childrenType: undefined,
  textContent: '',
  tagType: '',
  loading: false,
};

// ============================================================================
// Hook
// ============================================================================

const RPC_TIMEOUT = 10_000;

/**
 * Read element style data from either engine+DOM (browser) or RPC (VS Code).
 *
 * Browser mode: synchronously reads AST structure from engine + DOM element from iframe.
 * VS Code mode: sends `styles:readClassName` RPC to extension host.
 */
export function useElementStyleData(options: UseElementStyleDataOptions): ElementStyleData {
  const {
    elementId,
    componentPath,
    canvas,
    engine,
    styleAdapter,
    activeInstanceId,
    itemIndex,
    refreshKey,
    runtimeStyle,
    domTextContent,
    activeLocale,
  } = options;

  // Base style data from className RPC or engine — runtime merge applied via useMemo below
  const [classData, setData] = useState<ElementStyleData>(EMPTY_DATA);

  // Available i18n keys (fetched separately after i18nText arrives)
  const [availableKeys, setAvailableKeys] = useState<string[] | undefined>(undefined);

  // Track latest RPC request to ignore stale responses (VS Code mode only)
  const latestRequestRef = useRef<string | null>(null);
  // Track latest i18n keys request
  const latestKeysRequestRef = useRef<string | null>(null);

  // Track the elementId of the last initiated request. Used in the RPC path to detect
  // element switches so we can eagerly clear i18nText before the response arrives.
  // Prevents leaked i18nText from element A appearing on element B while B's RPC is in-flight.
  const prevElementIdRef = useRef<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is an intentional trigger to force style re-read after external changes
  useEffect(() => {
    if (!elementId) {
      setData(EMPTY_DATA);
      latestRequestRef.current = null;
      prevElementIdRef.current = null;
      return;
    }

    // =================================================================
    // Browser mode: synchronous engine + DOM
    // =================================================================
    if (engine && styleAdapter) {
      // Find AST node by walking engine tree
      let astNode: ReturnType<typeof findNodeById> = null;
      const root = engine.getRoot();

      // Prefer sampleStructure (what the iframe renders) over astStructure (component definition)
      const rootAst = root.metadata?.sampleStructure ?? root.metadata?.astStructure;
      if (Array.isArray(rootAst)) {
        astNode = findNodeById(rootAst, elementId);
      }

      if (!astNode) {
        for (const childId of root.children || []) {
          const inst = engine.getInstance(childId);
          const childAst = inst?.metadata?.sampleStructure ?? inst?.metadata?.astStructure;
          if (Array.isArray(childAst)) {
            astNode = findNodeById(childAst, elementId);
            if (astNode) break;
          }
        }
      }

      // elementId might be a nodeRef (canvas click) — resolve via source location
      if (!astNode) {
        const tracer = getActiveTracer();
        if (tracer) {
          const source = tracer.getSourceByNodeRef(elementId);
          if (source) {
            if (Array.isArray(rootAst)) {
              astNode = findAstNodeBySourceLoc(rootAst, source.line, source.column);
            }
            if (!astNode) {
              for (const childId of root.children || []) {
                const inst = engine.getInstance(childId);
                const childAst = inst?.metadata?.sampleStructure ?? inst?.metadata?.astStructure;
                if (Array.isArray(childAst)) {
                  astNode = findAstNodeBySourceLoc(childAst, source.line, source.column);
                  if (astNode) break;
                }
              }
            }
          }
        }
      }

      if (!astNode) {
        setData(EMPTY_DATA);
        return;
      }

      // Get DOM element from iframe for computed styles (itemIndex selects specific .map() item)
      const domElement = getElementFromIframe(elementId, itemIndex);
      const domTextContent = domElement?.textContent?.trim() || '';

      // Read parsed styles via adapter (TailwindAdapter or TamaguiAdapter)
      const parsed = styleAdapter.read(astNode, domElement || undefined);

      // Determine text content
      let textContent = '';
      if (astNode.childrenType !== 'jsx') {
        textContent = astNode.childrenType ? String(astNode.props?.children ?? '') : domTextContent;
      }

      setData({
        parsedStyles: parsed,
        childrenType: astNode.childrenType,
        textContent,
        tagType: astNode.type || 'unknown',
        loading: false,
      });
      return;
    }

    // =================================================================
    // VS Code mode: async RPC via canvas
    // =================================================================
    if (!canvas) {
      setData(EMPTY_DATA);
      latestRequestRef.current = null;
      prevElementIdRef.current = null;
      return;
    }

    // Derive componentPath from syntheticRef when no component is open from Explorer.
    // StyleReadService uses the embedded path in the syntheticRef (fileName:line:col) anyway.
    let effectiveComponentPath = componentPath;
    if (!effectiveComponentPath && elementId) {
      const m = elementId.match(/^(.+):\d+:\d+$/);
      if (m) effectiveComponentPath = m[1];
    }

    if (!effectiveComponentPath) {
      setData(EMPTY_DATA);
      latestRequestRef.current = null;
      prevElementIdRef.current = null;
      return;
    }

    const requestId = crypto.randomUUID();
    latestRequestRef.current = requestId;

    // When element changes, eagerly clear i18nText so the previous element's binding
    // doesn't leak through while the new element's RPC is in-flight. For same-element
    // re-reads (locale change, refreshKey bump, debounced write re-read) we keep prev.i18nText
    // so the I18nTextInspector stays mounted and localText isn't reset mid-typing.
    const isElementChange = prevElementIdRef.current !== elementId;
    prevElementIdRef.current = elementId;
    setData((prev) => ({
      ...prev,
      loading: true,
      ...(isElementChange ? { i18nText: undefined } : {}),
    }));

    const unsub = canvas.onEvent('styles:response', (msg) => {
      const response = msg as MessageOfType<'styles:response'>;
      if (response.requestId !== requestId) return;
      if (latestRequestRef.current !== requestId) return;

      unsub();
      clearTimeout(timer);

      if (!response.success) {
        console.warn('[useElementStyleData] RPC failed:', response.error);
        setData({
          parsedStyles: null,
          childrenType: undefined,
          textContent: '',
          tagType: 'unknown',
          loading: false,
        });
        return;
      }

      const fullStyles = classNameToStyles(response.className || '');

      setData(() => ({
        parsedStyles: fullStyles,
        childrenType: response.childrenType,
        textContent: response.textContent || '',
        tagType: response.tagType || 'unknown',
        loading: false,
        childrenLocation: response.childrenLocation,
        styleReadResult: response.styleReadResult,
        i18nText: response.i18nText,
      }));
    });

    canvas.sendEvent({
      type: 'styles:readClassName',
      requestId,
      elementId,
      componentPath: effectiveComponentPath,
      domTextContent: domTextContent || undefined,
      activeLocale: activeLocale || undefined,
    });

    const timer = setTimeout(() => {
      unsub();
      if (latestRequestRef.current === requestId) {
        setData((prev) => ({ ...prev, loading: false }));
      }
    }, RPC_TIMEOUT);

    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, [
    elementId,
    componentPath,
    canvas,
    engine,
    styleAdapter,
    activeInstanceId,
    itemIndex,
    refreshKey,
    domTextContent,
    activeLocale,
  ]);

  // Fetch available i18n keys after i18nText arrives (VS Code mode only)
  useEffect(() => {
    // Always clear before re-fetching: when the user switches between two i18n
    // elements, the previous element's key list must not leak into the new one's
    // RPC window. Creation remains available for editable bindings while the list
    // is loading; the write path only creates a key path inside an existing dictionary.
    setAvailableKeys(undefined);
    const i18nText = classData.i18nText;
    if (!canvas || !i18nText || i18nText.kind !== 'i18n') {
      latestKeysRequestRef.current = null;
      return;
    }

    const requestId = crypto.randomUUID();
    latestKeysRequestRef.current = requestId;

    const unsub = canvas.onEvent('styles:i18nKeysResponse', (msg) => {
      if (msg.requestId !== requestId) return;
      if (latestKeysRequestRef.current !== requestId) return;
      unsub();
      setAvailableKeys(msg.success ? msg.keys : undefined);
    });

    canvas.sendEvent({
      type: 'styles:fetchI18nKeys',
      requestId,
      library: i18nText.library,
      namespace: i18nText.namespace,
      activeLocale: i18nText.activeLocale,
    });

    return () => {
      unsub();
    };
  }, [canvas, classData.i18nText]);

  // Apply runtime style merge reactively — updates whenever runtimeStyle changes
  // without triggering a new RPC. Only fills fields that Tailwind parsing left empty.
  const data = useMemo(() => {
    if (!classData.parsedStyles && !availableKeys) {
      if (!runtimeStyle) return classData;
    }
    const base = availableKeys !== undefined ? { ...classData, availableKeys } : classData;
    if (!base.parsedStyles || !runtimeStyle) return base;
    const merged = mergeRuntimeStyle(base.parsedStyles, runtimeStyle, elementId, itemIndex);
    if (merged === base.parsedStyles) return base;
    return { ...base, parsedStyles: merged };
  }, [classData, availableKeys, runtimeStyle, elementId, itemIndex]);

  return data;
}
