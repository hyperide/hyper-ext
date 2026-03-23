/**
 * useElementStyleData — reads element style data for the inspector panel.
 *
 * Two modes:
 * 1. Browser/SaaS: engine + DOM (synchronous, reads AST node + iframe DOM element)
 * 2. VS Code webview: RPC via canvas (async, sends styles:readClassName to extension host)
 *
 * Mode is auto-detected: if engine is provided, uses browser path.
 */

import { useEffect, useRef, useState } from 'react';
import { findNodeById } from '@/components/RightSidebar/utils';
import type { CanvasEngine } from '@/lib/canvas-engine';
import type { StyleAdapter } from '@/lib/canvas-engine/adapters/StyleAdapter';
import type { ParsedStyles } from '@/lib/canvas-engine/adapters/types';
import type { ParsedTailwindStyles } from '@/lib/canvas-engine/utils/tailwindParser';
import { parseTailwindClasses } from '@/lib/canvas-engine/utils/tailwindParser';
import { buildElementSelector, getPreviewIframe } from '@/lib/dom-utils';
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
  /** Increment to force re-read of styles (VS Code mode) */
  refreshKey?: number;
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
  const { elementId, componentPath, canvas, engine, styleAdapter, activeInstanceId, refreshKey } = options;

  const [data, setData] = useState<ElementStyleData>(EMPTY_DATA);

  // Track latest RPC request to ignore stale responses (VS Code mode only)
  const latestRequestRef = useRef<string | null>(null);

  useEffect(() => {
    if (!elementId) {
      setData(EMPTY_DATA);
      latestRequestRef.current = null;
      return;
    }

    // =================================================================
    // Browser mode: synchronous engine + DOM
    // =================================================================
    if (engine && styleAdapter) {
      // Find AST node by walking engine tree
      let astNode: ReturnType<typeof findNodeById> = null;
      const root = engine.getRoot();

      const rootAst = root.metadata?.astStructure;
      if (Array.isArray(rootAst)) {
        astNode = findNodeById(rootAst, elementId);
      }

      if (!astNode) {
        for (const childId of root.children || []) {
          const inst = engine.getInstance(childId);
          const childAst = inst?.metadata?.astStructure;
          if (Array.isArray(childAst)) {
            astNode = findNodeById(childAst, elementId);
            if (astNode) break;
          }
        }
      }

      if (!astNode) {
        setData(EMPTY_DATA);
        return;
      }

      // Get DOM element from iframe for computed styles
      const iframe = getPreviewIframe();
      const doc = iframe?.contentDocument;
      const selector = buildElementSelector(elementId, activeInstanceId);
      const domElement = doc?.querySelector(selector) as HTMLElement | null;
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
    if (!canvas || !componentPath) {
      setData(EMPTY_DATA);
      latestRequestRef.current = null;
      return;
    }

    const requestId = crypto.randomUUID();
    latestRequestRef.current = requestId;
    setData((prev) => ({ ...prev, loading: true }));

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

      setData({
        parsedStyles: fullStyles,
        childrenType: response.childrenType,
        textContent: response.textContent || '',
        tagType: response.tagType || 'unknown',
        loading: false,
        childrenLocation: response.childrenLocation,
      });
    });

    canvas.sendEvent({
      type: 'styles:readClassName',
      requestId,
      elementId,
      componentPath,
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
  }, [elementId, componentPath, canvas, engine, styleAdapter, activeInstanceId, refreshKey]);

  return data;
}
