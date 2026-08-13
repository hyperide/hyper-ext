import { useEffect } from 'react';
import { IPHONE_SIZES } from '@/components/RightSidebar/constants';
import type { SourceLocation } from '@shared/element-tracing/types';
import { normalizeEventTarget } from '@shared/canvas-interaction/normalize-event-target';
import type { ClickRetryQueue } from '@/lib/element-tracing/click-retry-queue';
import { ElementTracer } from '@/lib/element-tracing/element-tracer';
import type { CanvasMode } from '../../../shared/types/canvas';

interface UseIframeEventHandlersParams {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  engine: { getMode(): 'design' | 'interact' | 'code' };
  tracer: ElementTracer | null;
  /** Retry queue for clicks that raced source-map warmup (HYP-635). */
  clickRetryQueue?: ClickRetryQueue | null;
  setPendingSelection: (source: SourceLocation, itemIndex: number) => void;
  canvasMode: CanvasMode;
  activeInstanceId?: string | null;
  boardModeActive?: boolean;
  isAddingComment?: boolean;
  overrideSrc?: string;
  onElementClick?: (
    nodeRef: string | null,
    element: HTMLElement,
    event: MouseEvent,
    itemIndex: number,
    source: SourceLocation,
  ) => void;
  onElementHover?: (
    nodeRef: string | null,
    element: HTMLElement | null,
    itemIndex: number | null,
    source: SourceLocation | null,
  ) => void;
  onEmptyClick?: () => void;
  onOtherInstanceClick?: (instanceId: string) => void;
  onAddComment?: (position: { x: number; y: number }, elementId: string | null, instanceId: string | null) => void;
  iframeLoadedCounter?: number;
  instanceSizes?: Record<string, { width?: number; height?: number }>;
  editorMode?: 'design' | 'interact' | 'code';
}

export function useIframeEventHandlers({
  iframeRef,
  engine,
  tracer,
  clickRetryQueue,
  setPendingSelection,
  canvasMode,
  activeInstanceId,
  boardModeActive,
  isAddingComment,
  overrideSrc,
  onElementClick,
  onElementHover,
  onEmptyClick,
  onOtherInstanceClick,
  onAddComment,
  iframeLoadedCounter,
  instanceSizes,
  editorMode,
}: UseIframeEventHandlersParams) {
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentDocument) return;

    const doc = iframe.contentDocument;

    const handleMouseDown = (e: MouseEvent) => {
      // Normalize a Text-node target (mousedown over visible text) up to its owning
      // Element before calling DOM APIs like `closest` (e2e #13).
      const target = normalizeEventTarget(e.target);
      if (!target) return;
      if (target.closest('[data-role="context-menu"]')) return;
      if (e.button !== 1) return;
      window.dispatchEvent(new CustomEvent('contextmenuclose'));
    };

    const handleClick = (e: MouseEvent) => {
      const mode = engine.getMode();

      // Any new click supersedes a retry queued for a previous one (HYP-635).
      clickRetryQueue?.cancel();

      // Normalize a Text-node target (click over visible text) up to its owning
      // Element so `closest` / fiber resolution never throw (e2e #13).
      const target = normalizeEventTarget(e.target);
      if (!target) return;

      if (isAddingComment && onAddComment) {
        e.preventDefault();
        e.stopPropagation();
        const fiberResult = tracer?.resolveClickLocal(target);
        const elementId = fiberResult?.nodeRef ?? null;
        const instanceElement = target.closest('[data-canvas-instance-id]') as HTMLElement;
        const instanceId = instanceElement?.dataset.canvasInstanceId || activeInstanceId || null;
        const doc = target.ownerDocument;
        const scrollX = doc.documentElement.scrollLeft || doc.body?.scrollLeft || 0;
        const scrollY = doc.documentElement.scrollTop || doc.body?.scrollTop || 0;
        const isSingleMode = canvasMode === 'single';
        const position = {
          x: isSingleMode ? e.clientX + scrollX : e.clientX,
          y: isSingleMode ? e.clientY + scrollY : e.clientY,
        };
        onAddComment(position, elementId, instanceId);
        return;
      }

      if (boardModeActive) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (mode === 'design' || mode === 'interact') {
        if (mode === 'design') {
          e.preventDefault();
          e.stopPropagation();
        }

        if (activeInstanceId) {
          const instanceElement = target.closest('[data-canvas-instance-id]') as HTMLElement;
          const clickedInstanceId = instanceElement?.dataset.canvasInstanceId;
          if (clickedInstanceId && clickedInstanceId !== activeInstanceId) {
            onOtherInstanceClick?.(clickedInstanceId);
            return;
          }
        }

        if (mode === 'design' && onElementClick) {
          if (tracer) {
            const result = tracer.resolveClickLocal(target);
            if (result) {
              onElementClick(result.nodeRef, target, e, result.itemIndex, result.source);
              return;
            }
            // Warmup race (HYP-635): the click may have resolved to raw transformed
            // coords because the module's source map is still fetching. Queue it for
            // one re-resolution when the map lands; the raw fallback below still runs
            // so a hung fetch never blocks selection.
            clickRetryQueue?.enqueue(target, (late) => {
              onElementClick(late.nodeRef, target, e, late.itemIndex, late.source);
            });
            const source = tracer.getSourceLocation(target);
            if (source) {
              const itemIndex = tracer.getItemIndex(target);
              setPendingSelection(source, itemIndex);
              const effectiveNodeRef = overrideSrc ? ElementTracer.encodeSyntheticNodeRef(source, itemIndex) : null;
              onElementClick(effectiveNodeRef, target, e, itemIndex, source);
              return;
            }
          }
          onEmptyClick?.();
        }
      }
    };

    const handleFocusIn = (e: FocusEvent) => {
      const mode = engine.getMode();
      if (mode === 'design') {
        const target = e.target as HTMLElement;
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable
        ) {
          e.preventDefault();
          target.blur();
        }
      }
    };

    const handleMouseOver = (e: MouseEvent) => {
      const mode = engine.getMode();
      if (mode !== 'design') return;
      // Normalize a Text-node target (hover over visible text) up to its owning
      // Element before fiber resolution (e2e #13).
      const target = normalizeEventTarget(e.target);
      if (!target) return;
      if (tracer && onElementHover) {
        const result = tracer.resolveClickLocal(target);
        if (result) {
          onElementHover(result.nodeRef, target, result.itemIndex, result.source);
          return;
        }
        if (overrideSrc) {
          const source = tracer.getSourceLocation(target);
          if (source) {
            const itemIndex = tracer.getItemIndex(target);
            onElementHover(ElementTracer.encodeSyntheticNodeRef(source, itemIndex), target, itemIndex, source);
            return;
          }
        }
      }
    };

    const handleMouseOut = (e: MouseEvent) => {
      const mode = engine.getMode();
      if (mode !== 'design') return;
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      if (tracer && relatedTarget) {
        const source = tracer.getSourceLocation(relatedTarget);
        if (source) return;
      }
      onElementHover?.(null, null, null, null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      const modifierOnlyKeys = ['Shift', 'Control', 'Alt', 'Meta'];
      if (modifierOnlyKeys.includes(e.key)) return;
      const isMod = e.metaKey || e.ctrlKey;
      const canvasHotkeys = ['c', 'v', 'x', 'd'];
      if (isMod && canvasHotkeys.includes(e.key.toLowerCase())) return;
      const newEvent = new KeyboardEvent(e.type, {
        key: e.key,
        code: e.code,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        bubbles: true,
        cancelable: true,
        repeat: e.repeat,
        location: e.location,
      });
      document.body.dispatchEvent(newEvent);
      if (newEvent.defaultPrevented) {
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      const modifierOnlyKeys = ['Shift', 'Control', 'Alt', 'Meta'];
      if (modifierOnlyKeys.includes(e.key)) return;
      const newEvent = new KeyboardEvent('keyup', {
        key: e.key,
        code: e.code,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        bubbles: true,
        cancelable: true,
        repeat: e.repeat,
        location: e.location,
      });
      document.body.dispatchEvent(newEvent);
    };

    window.addEventListener('mousedown', handleMouseDown, { capture: true });
    doc.addEventListener('click', handleClick, { capture: true });
    doc.addEventListener('mouseover', handleMouseOver, { capture: true });
    doc.addEventListener('mouseout', handleMouseOut, { capture: true });
    doc.addEventListener('focusin', handleFocusIn, { capture: true });

    const iframeWindow = iframe.contentWindow;
    if (iframeWindow) {
      iframeWindow.addEventListener('keydown', handleKeyDown, { capture: true });
      iframeWindow.addEventListener('keyup', handleKeyUp, { capture: true });
    }

    return () => {
      // Do NOT cancel clickRetryQueue here: the deliver closure captures
      // onElementClick at enqueue time (correct for the click that triggered it),
      // and the queue is cancelled by every subsequent new click (line ~78) and by
      // useElementTracer on teardown. Cancelling on every dep-change would drop a
      // valid warmup-retry whenever onElementClick changes identity mid-flight.
      window.removeEventListener('mousedown', handleMouseDown, { capture: true });
      doc.removeEventListener('click', handleClick, { capture: true });
      doc.removeEventListener('mouseover', handleMouseOver, { capture: true });
      doc.removeEventListener('mouseout', handleMouseOut, { capture: true });
      doc.removeEventListener('focusin', handleFocusIn, { capture: true });
      if (iframeWindow) {
        iframeWindow.removeEventListener('keydown', handleKeyDown, { capture: true });
        iframeWindow.removeEventListener('keyup', handleKeyUp, { capture: true });
      }
    };
  }, [
    onElementClick,
    onElementHover,
    onEmptyClick,
    onOtherInstanceClick,
    onAddComment,
    boardModeActive,
    activeInstanceId,
    isAddingComment,
    engine,
    iframeLoadedCounter,
    canvasMode,
    tracer,
    clickRetryQueue,
    setPendingSelection,
    overrideSrc,
    iframeRef,
  ]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentDocument) return;
    const instances = iframe.contentDocument.querySelectorAll('[data-canvas-instance-id]');
    for (const instance of instances) {
      const instanceId = (instance as HTMLElement).dataset.canvasInstanceId;
      if (!instanceId) continue;
      const isActive = instanceId === activeInstanceId;
      const opacity = boardModeActive || isActive ? '1' : '0.5';
      (instance as HTMLElement).style.opacity = opacity;
    }
  }, [activeInstanceId, boardModeActive, iframeRef]);

  useEffect(() => {
    if (!instanceSizes) return;
    const applyInstanceSizes = () => {
      if (!iframeRef.current?.contentDocument) return;
      const doc = iframeRef.current.contentDocument;
      for (const [instanceId, size] of Object.entries(instanceSizes)) {
        const el = doc.querySelector(`[data-canvas-instance-id="${instanceId}"]`) as HTMLElement;
        if (el && size.width && size.height) {
          el.style.width = `${size.width}px`;
          el.style.height = `${size.height}px`;
          const hasFullBezel = size.width === IPHONE_SIZES.bezel.width && size.height === IPHONE_SIZES.bezel.height;
          const hasStatusbar = size.width === IPHONE_SIZES.safe.width && size.height === IPHONE_SIZES.safe.height;
          if (hasFullBezel) {
            el.style.overflow = 'hidden';
            el.style.borderRadius = IPHONE_SIZES.bezel.borderRadius;
          } else if (hasStatusbar) {
            el.style.overflow = 'hidden';
            el.style.borderRadius = IPHONE_SIZES.safe.borderRadius;
          } else {
            el.style.overflow = 'auto';
            el.style.borderRadius = '';
          }
        }
      }
    };
    applyInstanceSizes();
    const timeoutId = setTimeout(applyInstanceSizes, 100);
    return () => clearTimeout(timeoutId);
  }, [instanceSizes, iframeLoadedCounter, iframeRef]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentDocument) return;
    const body = iframe.contentDocument.body;
    if (!body) return;
    if (editorMode === 'design') {
      body.classList.add('design-mode');
    } else {
      body.classList.remove('design-mode');
    }
  }, [editorMode, iframeLoadedCounter, iframeRef]);
}
