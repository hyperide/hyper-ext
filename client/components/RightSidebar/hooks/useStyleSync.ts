import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasEngine } from '@/lib/canvas-engine';
import type { StyleAdapter } from '@/lib/canvas-engine/adapters/StyleAdapter';
import { getDOMClassesFromIframe } from '@/lib/dom-utils';
import { getElementLocByUuid, resolveUuidToNodeRef } from '@/lib/element-tracing/id-bridge';
import type { AstOperations } from '@/lib/platform/types';
import {
  captureComputedStyles,
  getUniqueCSSProperties,
  type StyleNotAppliedContext,
  startStyleVerification,
} from '@/lib/style-change-detector';
import { STYLE_DEBOUNCE_MS } from '../constants';

interface UseStyleSyncOptions {
  selectedIds: string[];
  /** File path for the component — used for style writes */
  filePath: string | null;
  styleAdapter: StyleAdapter;
  /** AST operations for text updates (platform-aware) */
  astOps: AstOperations;
  currentState?: string;
  /** Optional engine for DOM class reading (browser mode only) */
  engine?: CanvasEngine | null;
  /** Selected non-computed style source tab for shared write routing */
  selectedSourceTabId?: string;
  /** Called when style sync fails (e.g. to open AI chat as fallback) */
  onSyncError?: (styles: Record<string, string>, error: string) => void;
  /** Called when setIsStyleSyncing(true) */
  onSyncStart?: () => void;
  /** Called when setIsStyleSyncing(false) — verified, timeout, or error */
  onSyncEnd?: () => void;
  /** Called when computed styles didn't change after write + HMR */
  onStyleNotApplied?: (context: StyleNotAppliedContext) => void;
}

interface SyncStyleOptions {
  /** Skip leading edge — use trailing-only debounce (for dblclick-capable controls) */
  debounceOnly?: boolean;
}

interface UseStyleSyncReturn {
  syncStyleChange: (key: string, value: string, options?: SyncStyleOptions) => void;
  syncTextChange: (text: string) => void;
  isStyleSyncing: boolean;
}

const FIXED_DELAY_FALLBACK_MS = 800;

export function useStyleSync({
  selectedIds,
  filePath,
  styleAdapter,
  astOps,
  currentState,
  engine,
  selectedSourceTabId,
  onSyncError,
  onSyncStart,
  onSyncEnd,
  onStyleNotApplied,
}: UseStyleSyncOptions): UseStyleSyncReturn {
  const [isStyleSyncing, setIsStyleSyncing] = useState(false);
  const styleQueueRef = useRef<Map<string, string>>(new Map());
  const styleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFlushTimeRef = useRef<number>(0);
  const verificationCleanupRef = useRef<(() => void) | null>(null);
  /** nodeRef of the last fast-patched element — finishSync must clear the exact key applyPatch used. */
  const lastFastPatchIdRef = useRef<string | null>(null);
  const selectedKey = selectedIds.join('\0');
  const previousSyncScopeRef = useRef({ filePath, selectedKey });

  const cancelPendingStyleSync = useCallback(() => {
    styleQueueRef.current.clear();

    if (styleTimerRef.current) {
      clearTimeout(styleTimerRef.current);
      styleTimerRef.current = null;
    }

    // Check before calling — verificationCleanupRef is set only after setIsStyleSyncing(true)
    // in SaaS mode. Cancelling it without resetting the flag leaves the spinner stuck.
    const hadActiveSync = verificationCleanupRef.current !== null;
    verificationCleanupRef.current?.();
    verificationCleanupRef.current = null;
    if (hadActiveSync) {
      setIsStyleSyncing(false);
    }
  }, []);

  useEffect(() => {
    return cancelPendingStyleSync;
  }, [cancelPendingStyleSync]);

  useEffect(() => {
    const previousSyncScope = previousSyncScopeRef.current;
    if (previousSyncScope.filePath !== filePath || previousSyncScope.selectedKey !== selectedKey) {
      cancelPendingStyleSync();
      previousSyncScopeRef.current = { filePath, selectedKey };
    }
  }, [filePath, selectedKey, cancelPendingStyleSync]);

  const finishSync = useCallback(() => {
    // HMR has applied the real change (or we gave up waiting) — drop the
    // instant fast-patch so the two don't fight.
    const id = lastFastPatchIdRef.current;
    if (engine && id) {
      engine.fastPatch.clearPatch(id);
      lastFastPatchIdRef.current = null;
    }
    setIsStyleSyncing(false);
    onSyncEnd?.();
  }, [onSyncEnd, engine]);

  const flushQueue = useCallback(async () => {
    if (styleQueueRef.current.size === 0) return;
    if (selectedIds.length === 0 || !selectedIds[0]) return;

    const selectedId = selectedIds[0];

    if (!filePath) {
      console.error('[useStyleSync] No file path provided');
      return;
    }

    // Tree selection stores parse UUIDs the server can never resolve (HYP-593):
    // convert to a tracer nodeRef when possible, and carry the AST loc so the
    // server can fall back to a node-map loc match when conversion misses.
    const writeId = engine ? resolveUuidToNodeRef(selectedId, engine) : selectedId;
    const elementLoc = engine ? (getElementLocByUuid(selectedId, engine) ?? undefined) : undefined;

    const styles = Object.fromEntries(styleQueueRef.current);
    styleQueueRef.current.clear();

    // Cancel any previous verification
    verificationCleanupRef.current?.();
    verificationCleanupRef.current = null;

    // Prepare CSS properties for verification
    const cssProperties = getUniqueCSSProperties(Object.keys(styles));

    // Skip verification for state variants (hover/focus) — can't verify via getComputedStyle
    const skipVerification = !!currentState || cssProperties.length === 0;

    // Capture before-snapshot (before engine call)
    const beforeSnapshot = !skipVerification ? captureComputedStyles(writeId, cssProperties) : null;

    setIsStyleSyncing(true);
    onSyncStart?.();

    try {
      if (engine) {
        // SaaS browser mode: route through engine for undo/redo support
        console.log('[useStyleSync] Syncing style changes via engine:', styles);

        // Instant visual feedback before the backend write + HMR round-trip.
        // Cleared in finishSync once the real change lands. Must use writeId —
        // the tracer resolves nodeRefs, not parse UUIDs (HYP-593), and the
        // engine write below targets the same id.
        engine.fastPatch.applyPatch(writeId, styles);
        lastFastPatchIdRef.current = writeId;

        const domClasses = getDOMClassesFromIframe(writeId);

        let backendPromise: Promise<void> | undefined;

        if (styleAdapter.writeMode === 'props' && styleAdapter.convertToProps) {
          const rnProps = styleAdapter.convertToProps(styles);
          engine.updateASTProps(writeId, filePath, rnProps);
        } else {
          backendPromise = engine.updateASTStyles(writeId, filePath, styles, {
            domClasses,
            instanceProps: {},
            instanceId: selectedId,
            state: currentState,
            selectedSourceTabId,
            elementLoc,
          });
        }

        if (skipVerification || !beforeSnapshot) {
          // Fixed delay fallback — track for cancellation
          const fallbackTimer = setTimeout(finishSync, FIXED_DELAY_FALLBACK_MS);
          verificationCleanupRef.current = () => clearTimeout(fallbackTimer);
        } else {
          // Start verification pipeline
          verificationCleanupRef.current = startStyleVerification({
            elementId: writeId,
            filePath,
            styles,
            cssProperties,
            beforeSnapshot,
            backendPromise,
            onVerified: finishSync,
            onNotApplied: (ctx) => {
              finishSync();
              onStyleNotApplied?.(ctx);
            },
            onTimeout: finishSync,
            onLongWait: undefined,
          });
        }
      } else {
        // VS Code mode: route through astOps RPC
        console.log('[useStyleSync] Syncing style changes via astOps:', styles);

        if (styleAdapter.writeMode === 'props' && styleAdapter.convertToProps) {
          const rnProps = styleAdapter.convertToProps(styles);
          await astOps.updateProps({
            elementId: selectedId,
            filePath,
            props: rnProps,
          });
        } else {
          await astOps.updateStyles({
            elementId: selectedId,
            filePath,
            styles,
            // Live applied className from the DOM (HYP-544) — authoritative replace target.
            // Without this the extension-host plumbing receives `undefined` and the DOM-anchored
            // residual override never activates for VS Code users.
            domClasses: getDOMClassesFromIframe(selectedId),
            state: currentState,
            selectedSourceTabId,
          });
        }

        finishSync();
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[useStyleSync] Failed to sync style changes:', errorMsg);
      onSyncError?.(styles, errorMsg);
      finishSync();
    }
  }, [
    selectedIds,
    filePath,
    styleAdapter,
    astOps,
    currentState,
    engine,
    selectedSourceTabId,
    onSyncError,
    onSyncStart,
    onStyleNotApplied,
    finishSync,
  ]);

  const syncStyleChange = useCallback(
    (styleKey: string, styleValue: string, options?: SyncStyleOptions) => {
      if (selectedIds.length === 0 || !selectedIds[0]) return;
      if (!filePath) {
        console.error('[useStyleSync] No file path provided');
        return;
      }

      styleQueueRef.current.set(styleKey, styleValue);

      if (styleTimerRef.current) {
        clearTimeout(styleTimerRef.current);
      }

      const timeSinceLastFlush = Date.now() - lastFlushTimeRef.current;
      const canLeadingFlush = !options?.debounceOnly && timeSinceLastFlush > STYLE_DEBOUNCE_MS;

      if (canLeadingFlush) {
        // Leading: flush immediately (first call in a new batch)
        lastFlushTimeRef.current = Date.now();
        flushQueue();
      } else {
        // Trailing: schedule batch flush (dblclick-capable controls, or rapid changes)
        styleTimerRef.current = setTimeout(() => {
          styleTimerRef.current = null;
          lastFlushTimeRef.current = Date.now();
          flushQueue();
        }, STYLE_DEBOUNCE_MS);
      }
    },
    [selectedIds, filePath, flushQueue],
  );

  const syncTextChange = useCallback(
    (text: string) => {
      if (selectedIds.length === 0 || !selectedIds[0]) return;

      const selectedId = selectedIds[0];

      if (!filePath) return;

      if (engine) {
        engine.updateASTProp(selectedId, filePath, 'text', text);
      } else {
        astOps
          .updateText({
            elementId: selectedId,
            filePath,
            text,
          })
          .catch((err) => {
            console.error('[useStyleSync] Text update failed:', err);
          });
      }
    },
    [selectedIds, filePath, astOps, engine],
  );

  return { syncStyleChange, syncTextChange, isStyleSyncing };
}
