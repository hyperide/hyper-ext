/**
 * useElementStyleData — reads element style data for the inspector panel.
 *
 * Two modes:
 * 1. Browser/SaaS: engine + DOM (synchronous, reads AST node + iframe DOM element)
 * 2. VS Code webview: RPC via canvas (async, sends styles:readClassName to extension host)
 *
 * Mode is auto-detected: if engine is provided, uses browser path.
 */

import type { ComponentPropSurfaceFacts, StyleReadResult } from '@lib/style-read/types';
import type { SelectedElementRuntimeStyle } from '@lib/types';
import type { I18nBindingResult } from '@shared/i18n-text/types';
import { normalizeComputedColor } from '@shared/utils/color';
import { computeEffectiveBackgroundColor } from '@shared/utils/effective-background';
import { useEffect, useMemo, useRef, useState } from 'react';
import { findNodeById } from '@/components/RightSidebar/utils';
import type { CanvasEngine } from '@/lib/canvas-engine';
import type { StyleAdapter } from '@/lib/canvas-engine/adapters/StyleAdapter';
import type { ParsedStyles } from '@/lib/canvas-engine/adapters/types';
import type { ParsedTailwindStyles } from '@/lib/canvas-engine/utils/tailwindParser';
import { parseTailwindClasses } from '@/lib/canvas-engine/utils/tailwindParser';
import { getElementFromIframe } from '@/lib/dom-utils';
import { getActiveTracer } from '@/lib/element-tracing/active-tracer';
import { findAstNodeBySourceLoc, getElementLocByUuid, resolveUuidToNodeRef } from '@/lib/element-tracing/id-bridge';
import { authFetch } from '@/utils/authFetch';
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
  /**
   * A1 forward-detector facts (HYP-1229/HYP-1280/HYP-1294) — per-channel evidence for whether this
   * element actually forwards `className`/`style` to the DOM. Populated on BOTH platforms:
   * browser/SaaS mode fetches it async via GET /api/element-forwarding (the browser read path has
   * no other server round-trip for this), never blocking the rest of the synchronous browser style
   * read; VS Code mode carries it on the `styles:response` RPC payload (`StyleReadService.
   * buildElementFacts`'s `forwardDetection`, projected via `projectForwardDetectionToPropSurface`
   * — the SAME projection both platforms use, so this never drifts per platform). Both paths reset
   * to `undefined` on selection change and populate once the read resolves.
   * RESET TIMING (review finding, HYP-1294): this field ALONE resets at RENDER TIME (see the
   * hook's own `propSurfaceKey` state, keyed on elementId+componentPath) — every OTHER field on
   * this interface (`tagType`, `parsedStyles`, `i18nText`, …) still resets EFFECT-driven, one
   * render behind a selection change. A consumer that reads `componentPropSurface` alongside
   * another field from THIS SAME hook (as `useNoStyleWriteSurfaceWarning` does with `tagType`)
   * relies on the invariant that `componentPropSurface` is `undefined` throughout the one render
   * where the other fields are still mid-transition — true today (VS Code sets both together in
   * one batched RPC handler; the browser fetch resolves long after the transition render), but
   * worth restating here so a future consumer pairing this field with a DIFFERENT one doesn't
   * assume the same atomicity without checking.
   */
  componentPropSurface?: ComponentPropSurfaceFacts;
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
  // Discard a snapshot from a different item index (normalize undefined/null to
  // null so a .map()-item snapshot never leaks onto an index-less selection).
  if ((runtime.itemIndex ?? null) !== (itemIndex ?? null)) return base;

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

  // Effective painted background resolved in the iframe (already an opaque hex —
  // no normalization). Drives correct text-contrast judgement for transparent elements.
  if (!merged.effectiveBackgroundColor && cs.effectiveBackgroundColor) {
    merged.effectiveBackgroundColor = cs.effectiveBackgroundColor;
    changed = true;
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
// Browser-mode synchronous reader (shared by the hook and multi-select merge)
// ============================================================================

/**
 * Synchronously read one element's parsed styles + text in browser/SaaS mode.
 *
 * Walks the engine AST (sample structure preferred), falling back to source-location
 * resolution via the active tracer when `elementId` is a nodeRef, then reads styles
 * through the supplied adapter against the matching iframe DOM element.
 *
 * Returns null when no AST node and no DOM element can be found. When only a DOM element
 * exists (NodePod mode), `parsedStyles` is null but `textContent`/`tagType` are populated.
 *
 * Shared so multi-select can read each element identically to the single-select hook.
 */
export function readBrowserElementStyle(
  elementId: string,
  engine: CanvasEngine,
  styleAdapter: StyleAdapter,
  itemIndex?: number | null,
): {
  parsedStyles: ParsedStyles | null;
  childrenType: ElementStyleData['childrenType'];
  textContent: string;
  tagType: string;
} | null {
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

  // Get DOM element from iframe for computed styles (itemIndex selects specific .map() item)
  const domElement = getElementFromIframe(elementId, itemIndex);

  if (!astNode) {
    // NodePod mode: no server-side AST, show minimal element info from DOM
    if (domElement) {
      return {
        parsedStyles: null,
        childrenType: undefined,
        textContent: domElement.textContent?.trim() ?? '',
        tagType: domElement.tagName.toLowerCase(),
      };
    }
    return null;
  }

  const domTextContent = domElement?.textContent?.trim() || '';

  // Read parsed styles via adapter (TailwindAdapter or TamaguiAdapter)
  const parsed = styleAdapter.read(astNode, domElement || undefined);

  // Resolve the effective painted background from the live DOM (browser/SaaS mode has
  // direct iframe DOM access). VS Code mode fills this via the runtime-style snapshot.
  if (domElement && !parsed.effectiveBackgroundColor) {
    parsed.effectiveBackgroundColor = computeEffectiveBackgroundColor(domElement);
  }

  // Determine text content
  let textContent = '';
  if (astNode.childrenType !== 'jsx') {
    textContent = astNode.childrenType ? String(astNode.props?.children ?? '') : domTextContent;
  }

  return {
    parsedStyles: parsed,
    childrenType: astNode.childrenType,
    textContent,
    tagType: astNode.type || 'unknown',
  };
}

// ============================================================================
// Hook
// ============================================================================

const RPC_TIMEOUT = 10_000;

/**
 * Fetch A1 forward-detector facts (HYP-1280) for one browser-mode element via the SaaS server
 * route. Best-effort: a failed/aborted fetch, a non-2xx status (every failure the route can
 * produce goes through the global error middleware as a non-2xx — see
 * server/routes/readElementForwarding.ts's `ReadElementForwardingResponse` doc comment; there is
 * no `success: false` 200 shape to check for), or an unexpected body resolves to `null` and the
 * caller just leaves `componentPropSurface` unset — fail-open, matching the write path's own
 * `unknown` verdict never refusing a write on an unresolved guess.
 */
export async function fetchComponentPropSurface(
  filePath: string,
  nodeRef: string,
  elementLoc: { line: number; column: number } | undefined,
  signal: AbortSignal,
): Promise<ComponentPropSurfaceFacts | null> {
  const params = new URLSearchParams({ filePath, nodeRef });
  if (elementLoc) {
    params.set('elementLocLine', String(elementLoc.line));
    params.set('elementLocColumn', String(elementLoc.column));
  }
  try {
    const res = await authFetch(`/api/element-forwarding?${params.toString()}`, { signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { success: true; componentPropSurface: ComponentPropSurfaceFacts };
    return body.componentPropSurface ?? null;
  } catch {
    return null;
  }
}

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

  // A1 forward-detector facts (HYP-1280, browser/SaaS mode only — VS Code computes these
  // internally in StyleReadService, no separate client-side fetch needed there).
  const [componentPropSurface, setComponentPropSurface] = useState<ComponentPropSurfaceFacts | undefined>(undefined);
  // RENDER-TIME reset (review finding, HYP-1294) — not effect-driven. An effect-driven reset (the
  // old `setComponentPropSurface(undefined)` at the top of the forwarding-fetch effect below) lags
  // ONE RENDER behind elementId/componentPath changing: on the render where selection moves from
  // element A to element B, this hook already returns B's elementId/componentPath but STILL the
  // OLD componentPropSurface state (A's facts) — the reset effect hasn't run yet. Any consumer that
  // reads componentPropSurface alongside elementId/componentPath in that SAME render (e.g. the
  // proactive non-forwarding warning, `useNoStyleWriteSurfaceWarning`) sees a mismatched pairing:
  // B's identity with A's verdict for the ONE render where they're inconsistent. This is React's
  // documented "adjust state while rendering" pattern, resolving synchronously before this render
  // commits/paints — so no mismatched pairing survives to paint or to an effect. Uses `useState`
  // for the tracked key, NOT a `useRef` (2nd review round finding, Opus + GLM independently):
  // React can discard an interrupted render pass (e.g. under a transition); a `useState` write is
  // discarded along with that pass, keeping the tracked key and the `componentPropSurface` reset
  // atomic. A `useRef` write is NOT discarded (refs survive a thrown-away render), so a ref-based
  // version could desync the two on a rare interrupted-render replay — low probability, but this
  // is the exact mechanism the whole reset exists to close, so it's made provably safe rather than
  // merely "safe in the common case". (A LATE async resolution for the previously-selected element
  // — not a render race, but the fetch itself replying after the selection already moved on — is a
  // SEPARATE, already-guarded concern: see the `AbortController`/`latestRequestRef` staleness
  // checks in the fetch effect and the RPC handler below, both pre-existing and unchanged by this
  // reset. This render-time reset only closes the RENDER-ordering gap, not fetch-resolution races.)
  const [propSurfaceKey, setPropSurfaceKey] = useState<string | null>(null);
  const currentPropSurfaceKey = elementId && componentPath ? `${componentPath}::${elementId}` : null;
  if (propSurfaceKey !== currentPropSurfaceKey) {
    setPropSurfaceKey(currentPropSurfaceKey);
    if (componentPropSurface !== undefined) setComponentPropSurface(undefined);
  }

  // Track latest RPC request to ignore stale responses (VS Code mode only)
  const latestRequestRef = useRef<string | null>(null);
  // Track latest i18n keys request
  const latestKeysRequestRef = useRef<string | null>(null);

  // Track (elementId, effectiveComponentPath) of the last initiated request.
  // isElementChange fires when EITHER changes so we eagerly clear parsedStyles:
  //   - same-component element click: elementId changes
  //   - component switch with stale selectedIds: componentPath changes, elementId stays same
  //     (RightPanelProvider's component:open handler only patches currentComponent, not selectedIds)
  const prevElementIdRef = useRef<string | null>(null);
  const prevComponentPathRef = useRef<string | null>(null);

  /* eslint-disable react-hooks/exhaustive-deps -- refreshKey is an intentional trigger to force style re-read after external changes */
  useEffect(() => {
    if (!elementId) {
      setData(EMPTY_DATA);
      latestRequestRef.current = null;
      prevElementIdRef.current = null;
      prevComponentPathRef.current = null;
      return;
    }

    // =================================================================
    // Browser mode: synchronous engine + DOM
    // =================================================================
    if (engine && styleAdapter) {
      const browserData = readBrowserElementStyle(elementId, engine, styleAdapter, itemIndex);
      setData(browserData ? { ...browserData, loading: false } : EMPTY_DATA);
      return;
    }

    // =================================================================
    // VS Code mode: async RPC via canvas
    // =================================================================
    if (!canvas) {
      setData(EMPTY_DATA);
      latestRequestRef.current = null;
      prevElementIdRef.current = null;
      prevComponentPathRef.current = null;
      return;
    }

    // Derive componentPath from syntheticRef when no component is open from Explorer.
    // StyleReadService uses the embedded path in the syntheticRef (fileName:line:col) anyway.
    let effectiveComponentPath = componentPath;
    if (!effectiveComponentPath) {
      // elementId is always truthy here (early return at top of effect guards it)
      const m = elementId.match(/^(.+):\d+:\d+$/);
      if (m) effectiveComponentPath = m[1];
    }

    if (!effectiveComponentPath) {
      setData(EMPTY_DATA);
      latestRequestRef.current = null;
      prevElementIdRef.current = null;
      prevComponentPathRef.current = null;
      return;
    }

    const requestId = crypto.randomUUID();
    latestRequestRef.current = requestId;

    // Fire on EITHER elementId or effectiveComponentPath change so both cases are covered:
    //   1. User clicks a different element (same component): elementId changes
    //   2. User switches component with stale selectedIds (RightPanelProvider's component:open
    //      patches currentComponent only; selectedIds stays from previous component):
    //      effectiveComponentPath changes while elementId stays the same
    // On match: reset to EMPTY_DATA (clears parsedStyles, tagType, textContent, i18nText) before
    // the new RPC response arrives so no stale values leak into the Inspector.
    // On re-read (same element, same component — locale change, refreshKey bump, write re-read):
    // both refs match → keep prev data to avoid flicker while the re-read is in-flight.
    const isElementChange =
      prevElementIdRef.current !== elementId || prevComponentPathRef.current !== effectiveComponentPath;
    prevElementIdRef.current = elementId;
    prevComponentPathRef.current = effectiveComponentPath;
    setData((prev) => ({
      ...(isElementChange ? EMPTY_DATA : prev),
      loading: true,
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

      setData((prev) => ({
        parsedStyles: fullStyles,
        childrenType: response.childrenType,
        textContent: response.textContent || '',
        tagType: response.tagType || 'unknown',
        loading: false,
        childrenLocation: response.childrenLocation,
        styleReadResult: response.styleReadResult,
        i18nText: response.i18nText ?? prev.i18nText,
      }));
      // HYP-1294 AC2 — VS Code parity: the browser/SaaS path fills componentPropSurface via its
      // own separate fetch effect below; VS Code mode has no such fetch, so this is the only place
      // it's ever set there. Shares the same `componentPropSurface` state (and thus the same final
      // merge in the `data` memo below) as the browser path. `?? prevSurface` mirrors the
      // `i18nText ?? prev.i18nText` idiom just above (review finding, HYP-1294): a response that
      // genuinely carries no facts (the "selection lost after HMR" empty-result path) keeps the
      // last known-good verdict rather than clobbering it to undefined, so the warning doesn't
      // flicker off on a transient re-read blip for the SAME already-verified element.
      setComponentPropSurface((prevSurface) => response.componentPropSurface ?? prevSurface);
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

  // Fetch A1 forward-detector facts for the selected element (HYP-1280, browser/SaaS mode only).
  // Async and non-blocking — the synchronous browser style read above already returned; this
  // fills in componentPropSurface once the server route resolves, or leaves it unset on failure.
  // The reset-on-element-change above is now RENDER-TIME (propSurfaceKeyRef), not here — a
  // refreshKey-only re-fetch (same element) intentionally does NOT reset first, so a shown warning
  // doesn't flicker off during the refetch window; it only updates once the new fetch resolves.
  useEffect(() => {
    if (!engine || !styleAdapter || !elementId || !componentPath) return;

    const nodeRef = resolveUuidToNodeRef(elementId, engine);
    const elementLoc = getElementLocByUuid(elementId, engine) ?? undefined;
    // resolveUuidToNodeRef's own contract falls back to the input id (already guarded truthy
    // above) on any resolution failure, so this can't fire today — kept as an explicit guard
    // rather than trusting that contract silently, in case a future change to that helper starts
    // returning '' (review round 3 flagged the missing guard even though it traced to a false
    // positive under the CURRENT contract).
    if (!nodeRef && !elementLoc) return;
    const controller = new AbortController();
    fetchComponentPropSurface(componentPath, nodeRef, elementLoc, controller.signal).then((facts) => {
      if (!controller.signal.aborted && facts) setComponentPropSurface(facts);
    });
    return () => controller.abort();
    // refreshKey mirrors the main read effect's re-read trigger (post-write / external-edit):
    // a code edit can change a component's forwarding shape, or shift its line/col and invalidate
    // the nodeRef/elementLoc the facts were fetched with, so this must re-fetch on the same signal.
  }, [elementId, componentPath, engine, styleAdapter, refreshKey]);

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
  /* eslint-enable react-hooks/exhaustive-deps */

  // Apply runtime style merge reactively — updates whenever runtimeStyle changes
  // without triggering a new RPC. Only fills fields that Tailwind parsing left empty.
  const data = useMemo(() => {
    if (!classData.parsedStyles && !availableKeys && !componentPropSurface) {
      if (!runtimeStyle) return classData;
    }
    const base = {
      ...classData,
      ...(availableKeys !== undefined ? { availableKeys } : {}),
      ...(componentPropSurface !== undefined ? { componentPropSurface } : {}),
    };
    if (!base.parsedStyles || !runtimeStyle) return base;
    const merged = mergeRuntimeStyle(base.parsedStyles, runtimeStyle, elementId, itemIndex);
    if (merged === base.parsedStyles) return base;
    return { ...base, parsedStyles: merged };
  }, [classData, availableKeys, componentPropSurface, runtimeStyle, elementId, itemIndex]);

  return data;
}
