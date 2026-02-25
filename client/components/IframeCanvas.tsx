import { getItemIndex } from '@shared/canvas-interaction/click-handler';
import { injectDesignStyles } from '@shared/canvas-interaction/style-injector';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IPHONE_SIZES } from '@/components/RightSidebar/constants';
import { useComponentMeta } from '@/contexts/ComponentMetaContext';
import { useCanvasEngine } from '@/lib/canvas-engine';
import { authFetch } from '@/utils/authFetch';
import type { RuntimeError } from '../../shared/runtime-error';
// Canvas composition loaded from server only (no localStorage cache)
import type { CanvasComposition, CanvasMode } from '../../shared/types/canvas';

// Module-level cache for registered preview components
// Clears automatically on page reload (browser refresh)
// Prevents redundant /api/generate-preview calls for already-registered components
const registeredComponentsCache = new Map<string, Set<string>>();

interface IframeCanvasProps {
  componentPath: string;
  iframeLoadedCounter?: number;
  boardModeActive?: boolean;
  activeInstanceId?: string | null;
  instanceSizes?: Record<string, { width?: number; height?: number }>;
  editorMode?: 'design' | 'interact' | 'code';
  isAddingComment?: boolean;
  onElementClick?: (element: HTMLElement | null, event?: MouseEvent, itemIndex?: number | null) => void;
  onElementHover?: (element: HTMLElement | null, itemIndex?: number | null) => void;
  onLoadingChange?: (loading: boolean) => void;
  onCanvasModeChange?: (mode: CanvasMode) => void;
  onEmptyClick?: () => void;
  onOtherInstanceClick?: (instanceId: string) => void;
  onAddComment?: (position: { x: number; y: number }, elementId: string | null, instanceId: string | null) => void;
  // Gateway error callback (502, 503, etc.) with optional error message
  onGatewayError?: (hasError: boolean, errorMessage?: string) => void;
  // Runtime error callback (Next.js, Vite, Bun error overlays)
  onRuntimeError?: (error: RuntimeError | null) => void;
  // Error state change callback for rendering overlays outside pan&zoom
  onErrorChange?: (error: string | null, retryCount: number) => void;
}

export default function IframeCanvas({
  componentPath,
  boardModeActive,
  activeInstanceId,
  instanceSizes,
  iframeLoadedCounter,
  editorMode,
  isAddingComment,
  onElementClick,
  onElementHover,
  onLoadingChange,
  onCanvasModeChange,
  onEmptyClick,
  onOtherInstanceClick,
  onAddComment,
  onGatewayError,
  onRuntimeError,
  onErrorChange,
}: IframeCanvasProps) {
  const { meta } = useComponentMeta();
  const engine = useCanvasEngine();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('single');
  const [canvasComposition, setCanvasComposition] = useState<CanvasComposition | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Show logs panel when error occurs
  useEffect(() => {
    if (error) {
      onGatewayError?.(true);
    }
  }, [error, onGatewayError]);

  // Notify parent about error/retry state for external overlay rendering
  useEffect(() => {
    onErrorChange?.(error, retryCount);
  }, [error, retryCount, onErrorChange]);

  // Check if iframe content has gateway/proxy errors (502, Cloudflare, etc.)
  // Returns error message if proxy error is detected
  const checkForGatewayError = useCallback((): {
    hasError: boolean;
    errorMessage?: string;
  } => {
    const iframe = iframeRef.current;
    if (!iframe) return { hasError: false };

    try {
      const doc = iframe.contentDocument;
      if (!doc) return { hasError: false };

      const title = doc.title?.toLowerCase() || '';
      const bodyText = doc.body?.textContent || '';
      const bodyTextLower = bodyText.toLowerCase();
      const bodyHtml = doc.body?.innerHTML?.toLowerCase() || '';

      // Check for common gateway/proxy error patterns
      const errorPatterns = [
        /bad gateway/i,
        /502/,
        /503/,
        /504/,
        /522/,
        /523/,
        /524/,
        /404/,
        /not found/i,
        /cloudflare/i,
        /nginx/i,
        /upstream/i,
        /gateway timeout/i,
        /service unavailable/i,
        /connection refused/i,
        /failed to connect/i,
      ];

      const content = `${title} ${bodyTextLower}`;

      // Check for 404 specifically to provide better error message with URL
      if (/404|not found/i.test(content)) {
        console.log('[IframeCanvas] 404 error detected');
        const requestedUrl = iframe.contentWindow?.location.href || 'unknown';
        return {
          hasError: true,
          errorMessage: `404 Not Found: ${requestedUrl}`,
        };
      }

      for (const pattern of errorPatterns) {
        if (pattern.test(content)) {
          console.log('[IframeCanvas] Gateway error detected:', pattern);
          // Extract proxy error message if present
          const proxyErrorMatch = bodyText.match(/proxy error:\s*(.+)/i);
          return {
            hasError: true,
            errorMessage: proxyErrorMatch ? proxyErrorMatch[1].trim() : undefined,
          };
        }
      }

      // Check for Cloudflare error page structure
      if (bodyHtml.includes('cf-error-') || bodyHtml.includes('cf-wrapper')) {
        console.log('[IframeCanvas] Cloudflare error page detected');
        return { hasError: true, errorMessage: 'Cloudflare error' };
      }
    } catch {
      // Cross-origin error - can't check content, assume it's an error page
      // (since our project preview should be same-origin)
      console.log('[IframeCanvas] Cannot access iframe content, might be error page');
      return { hasError: true };
    }

    return { hasError: false };
  }, []);

  // Reload iframe with retry logic
  const reloadIframe = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    console.log('[IframeCanvas] Reloading iframe, retry count:', retryCount);
    setLoading(true);
    setError(null);
    iframe.contentWindow.location.reload();
    setRetryCount((prev) => prev + 1);
  }, [retryCount]);

  // Notify parent about loading state changes
  useEffect(() => {
    if (onLoadingChange) {
      onLoadingChange(loading);
    }
  }, [loading, onLoadingChange]);

  // Export instances to window for iframe access (avoids URL length limits)
  useEffect(() => {
    Object.assign(window, { __CANVAS_INSTANCES__: canvasComposition?.instances ?? {} });
  }, [canvasComposition]);

  // Load canvas composition and determine mode
  useEffect(() => {
    if (!meta?.projectId || !componentPath) {
      setCanvasComposition(null);
      setCanvasMode('single');
      onCanvasModeChange?.('single');
      // Don't call onBoardModeChange here - board mode is controlled by Toolbar
      return;
    }

    // Load composition from server only (no localStorage cache)
    const loadComposition = async () => {
      let composition: CanvasComposition | null = null;

      try {
        const response = await authFetch(
          `/api/canvas-composition/${meta.projectId}/${encodeURIComponent(componentPath)}`,
        );
        if (response.ok) {
          const data = await response.json();
          composition = data.composition;
        }
      } catch (error) {
        console.error('[IframeCanvas] Failed to load composition from server:', error);
      }

      // Single mode: no instances OR only 'default' instance
      // Multi mode: multiple instances OR named instances (not just 'default')
      const instanceKeys = composition ? Object.keys(composition.instances) : [];
      const isMultiMode = instanceKeys.length > 1 || (instanceKeys.length === 1 && instanceKeys[0] !== 'default');
      const mode = isMultiMode ? 'multi' : 'single';

      setCanvasComposition(composition);
      setCanvasMode(mode);
      onCanvasModeChange?.(mode);
      // Don't call onBoardModeChange here - board mode is controlled by Toolbar

      console.log('[IframeCanvas] Canvas mode:', mode, 'Composition:', composition);
    };

    loadComposition();
  }, [meta?.projectId, componentPath, onCanvasModeChange]);

  // Listen for canvasCompositionChanged event to reload composition
  useEffect(() => {
    const handleCanvasChanged = async () => {
      if (!meta?.projectId || !componentPath) return;

      try {
        const response = await authFetch(
          `/api/canvas-composition/${meta.projectId}/${encodeURIComponent(componentPath)}`,
        );
        if (response.ok) {
          const data = await response.json();
          const composition = data.composition;

          const instanceKeys = composition ? Object.keys(composition.instances) : [];
          const isMultiMode = instanceKeys.length > 1 || (instanceKeys.length === 1 && instanceKeys[0] !== 'default');
          const mode = isMultiMode ? 'multi' : 'single';

          setCanvasComposition(composition);
          setCanvasMode(mode);
          onCanvasModeChange?.(mode);
          // Don't call onBoardModeChange here - board mode is controlled by Toolbar

          console.log('[IframeCanvas] Composition reloaded after canvasCompositionChanged');
        }
      } catch (error) {
        console.error('[IframeCanvas] Failed to reload composition:', error);
      }
    };

    window.addEventListener('canvasCompositionChanged', handleCanvasChanged);
    return () => window.removeEventListener('canvasCompositionChanged', handleCanvasChanged);
  }, [meta?.projectId, componentPath, onCanvasModeChange]);

  // Auto-register component in __canvas_preview__.tsx before loading iframe
  // Uses module-level cache to avoid redundant API calls for same component
  useEffect(() => {
    if (!meta?.projectId || !componentPath) {
      setPreviewReady(false);
      return;
    }

    // Check cache first - skip HTTP request if already registered
    const projectCache = registeredComponentsCache.get(meta.projectId);
    if (projectCache?.has(componentPath)) {
      console.log('[IframeCanvas] Component already registered (cached):', componentPath);
      setPreviewReady(true);
      return;
    }

    setLoading(true);
    setPreviewReady(false);
    setError(null);

    // Call API to ensure component is registered in __canvas_preview__.tsx
    authFetch('/api/generate-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: meta.projectId,
        components: [componentPath],
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to register component');
        }
        return response.json();
      })
      .then(() => {
        console.log('[IframeCanvas] Component registered:', componentPath);
        // Update cache after successful registration
        if (!registeredComponentsCache.has(meta.projectId)) {
          registeredComponentsCache.set(meta.projectId, new Set());
        }
        registeredComponentsCache.get(meta.projectId)?.add(componentPath);
        setPreviewReady(true);
      })
      .catch((err) => {
        console.error('[IframeCanvas] Failed to register component:', err);
        setError(`Failed to register component: ${err.message}`);
        setLoading(false);
      });
  }, [meta?.projectId, componentPath]);

  // Inject styles on iframe load + check for gateway errors
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !previewReady) return;

    const handleLoad = () => {
      // Check for gateway errors after load
      // Use setTimeout to ensure DOM is fully parsed
      setTimeout(() => {
        const errorCheck = checkForGatewayError();
        if (errorCheck.hasError) {
          console.log('[IframeCanvas] Gateway error on load, scheduling retry');
          onGatewayError?.(true, errorCheck.errorMessage); // Notify parent with error message
          // Exponential backoff: 1s, 2s, 4s, 8s, max 8s
          const delay = Math.min(1000 * 2 ** retryCount, 8000);
          retryTimeoutRef.current = setTimeout(() => {
            if (retryCount < 10) {
              reloadIframe();
            } else {
              setError('Failed to connect to project. Please check if the project is running.');
              setLoading(false);
            }
          }, delay);
        } else {
          setLoading(false);
          setRetryCount(0); // Reset on success
          onGatewayError?.(false); // Clear gateway error state
        }
      }, 100);
    };

    const handleError = () => {
      setLoading(false);
      setError('Failed to load component preview');
    };

    iframe.addEventListener('load', handleLoad);
    iframe.addEventListener('error', handleError);

    return () => {
      iframe.removeEventListener('load', handleLoad);
      iframe.removeEventListener('error', handleError);
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [previewReady, retryCount, checkForGatewayError, reloadIframe, onGatewayError]);

  // Retry on network recovery and tab activation
  useEffect(() => {
    const handleOnline = () => {
      console.log('[IframeCanvas] Network online, checking iframe');
      if (checkForGatewayError().hasError) {
        reloadIframe();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[IframeCanvas] Tab activated, checking iframe');
        // Small delay to let network settle after tab switch
        setTimeout(() => {
          if (checkForGatewayError().hasError) {
            reloadIframe();
          }
        }, 500);
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkForGatewayError, reloadIframe]);

  // Inject/update dynamic styles based on mode
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !previewReady) return;

    try {
      const doc = iframe.contentDocument;
      if (!doc) {
        setError('Cannot access iframe content');
        return;
      }

      injectDesignStyles(doc, {
        mode: editorMode === 'interact' ? 'interact' : 'design',
        boardModeActive,
        canvasMode,
        transparentBackground: true,
      });
    } catch (err) {
      console.error('Failed to access iframe content:', err);
      setError('Failed to initialize canvas');
    }
  }, [previewReady, boardModeActive, editorMode, canvasMode]);

  // Apply instance sizes to DOM elements
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
  }, [instanceSizes, iframeLoadedCounter]);

  // Setup event handlers - re-runs when boardModeActive or activeInstanceId changes
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentDocument) return;

    const doc = iframe.contentDocument;

    // Dispatch contextmenuclose on mousedown (before click) so context menu can close
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-role="context-menu"]')) return;
      if (e.button !== 1) return;
      window.dispatchEvent(new CustomEvent('contextmenuclose'));
    };

    // Add event listeners to iframe content
    const handleClick = (e: MouseEvent) => {
      const mode = engine.getMode();
      // console.log('[IframeCanvas handleClick]', {
      // 	mode,
      // 	boardModeActive,
      // 	activeInstanceId,
      // 	isAddingComment,
      // 	target: (e.target as HTMLElement).tagName,
      // });

      // Handle adding comment mode - takes priority
      if (isAddingComment && onAddComment) {
        e.preventDefault();
        e.stopPropagation();

        const target = e.target as HTMLElement;
        const element = target.closest('[data-uniq-id]') as HTMLElement;
        const elementId = element?.dataset.uniqId || null;

        // Determine instanceId: from clicked element's instance, or activeInstanceId for empty space
        const instanceElement = target.closest('[data-canvas-instance-id]') as HTMLElement;
        const instanceId = instanceElement?.dataset.canvasInstanceId || activeInstanceId || null;

        // e.clientX/Y inside iframe document is relative to iframe viewport
        // In single mode: store content coords (viewport + scroll) so sticker scrolls with content
        // In board mode: store viewport coords (instances don't scroll traditionally)
        const doc = (e.target as HTMLElement).ownerDocument;
        const scrollX = doc.documentElement.scrollLeft || doc.body?.scrollLeft || 0;
        const scrollY = doc.documentElement.scrollTop || doc.body?.scrollTop || 0;
        const isSingleMode = canvasMode === 'single';

        console.log('[IframeCanvas] Adding comment click:', {
          clientX: e.clientX,
          clientY: e.clientY,
          scrollX,
          scrollY,
          canvasMode,
          elementId,
          instanceId,
        });

        const position = {
          x: isSingleMode ? e.clientX + scrollX : e.clientX,
          y: isSingleMode ? e.clientY + scrollY : e.clientY,
        };
        onAddComment(position, elementId, instanceId);
        return;
      }

      // In board mode: disable all component clicks (overlays handle interaction)
      if (boardModeActive) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // In design or interact mode: handle clicks
      if (mode === 'design' || mode === 'interact') {
        // In design mode prevent default behavior, in interact mode allow it
        if (mode === 'design') {
          e.preventDefault();
          e.stopPropagation();
        }

        const target = e.target as HTMLElement;

        // Find closest element with data-uniq-id
        const element = target.closest('[data-uniq-id]') as HTMLElement;

        // Check if click was on empty space (no element with data-uniq-id)
        if (!element) {
          // Click on empty space - exit to board mode
          if (onEmptyClick) {
            onEmptyClick();
          }
          return;
        }

        // In multi-instance mode: check if click is on different instance
        if (activeInstanceId) {
          const instanceElement = element.closest('[data-canvas-instance-id]') as HTMLElement;
          const clickedInstanceId = instanceElement?.dataset.canvasInstanceId;

          // Click on element in different instance - switch to that instance
          if (clickedInstanceId && clickedInstanceId !== activeInstanceId) {
            if (onOtherInstanceClick) {
              onOtherInstanceClick(clickedInstanceId);
            }
            return;
          }
        }

        // Normal element click handling (only in design mode)
        if (mode === 'design' && onElementClick) {
          const uniqId = element.dataset.uniqId;
          const itemIndex = uniqId ? getItemIndex(element, uniqId, doc, activeInstanceId) : null;

          onElementClick(element, e, itemIndex);
        }
      }
      // If not in design or interact mode: let events pass through naturally
    };

    // Prevent focus on inputs/textareas in design mode
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

      // Only apply hover effects in design mode
      if (mode === 'design') {
        const target = e.target as HTMLElement;
        const element = target.closest('[data-uniq-id]') as HTMLElement;

        if (element && onElementHover) {
          const uniqId = element.dataset.uniqId;
          const itemIndex = uniqId ? getItemIndex(element, uniqId, doc, activeInstanceId) : null;
          onElementHover(element, itemIndex);
        }
      }
    };

    const handleMouseOut = (e: MouseEvent) => {
      const mode = engine.getMode();

      // Only apply hover effects in design mode
      if (mode === 'design') {
        const target = e.target as HTMLElement;
        const element = target.closest('[data-uniq-id]') as HTMLElement;

        if (element && onElementHover) {
          onElementHover(null, null);
        }
      }
    };

    // Forward keyboard events from iframe to parent window
    // This allows hotkeys to work even when iframe is focused
    const handleKeyDown = (e: KeyboardEvent) => {
      console.log('[IframeCanvas] 🔍 Raw keydown:', {
        key: e.key,
        code: e.code,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        target: (e.target as HTMLElement)?.tagName,
      });

      // Skip if user is typing in an input/textarea inside iframe
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        console.log('[IframeCanvas] ⏭️ Skipping - user is typing in input');
        return;
      }

      // Don't forward modifier-only keys (Shift, Ctrl, Alt, Meta)
      // These should only be forwarded when combined with other keys
      const modifierOnlyKeys = ['Shift', 'Control', 'Alt', 'Meta'];
      if (modifierOnlyKeys.includes(e.key)) {
        console.log('[IframeCanvas] ⏭️ Skipping - modifier only key');
        return;
      }

      // Don't forward canvas hotkeys (mod+c/v/x/d) - they are handled by
      // CanvasEditor's handleIframeKeydown which listens on iframeDoc.
      // Since we're on iframeWindow (capture phase: window -> document -> target),
      // if we forward these, handleIframeKeydown never gets them.
      const isMod = e.metaKey || e.ctrlKey;
      const canvasHotkeys = ['c', 'v', 'x', 'd'];
      if (isMod && canvasHotkeys.includes(e.key.toLowerCase())) {
        console.log('[IframeCanvas] ⏭️ Skipping canvas hotkey, letting it reach handleIframeKeydown:', e.key);
        return;
      }

      console.log('[IframeCanvas] ✅ Forwarding keydown to parent window');

      // Forward the keyboard event to parent window
      // Create a new event with all necessary properties for react-hotkeys-hook
      const newEvent = new KeyboardEvent(e.type, {
        key: e.key,
        code: e.code,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        bubbles: true,
        cancelable: true,
        // Additional properties that might be needed
        repeat: e.repeat,
        location: e.location,
        // KeyboardEvent constructor doesn't accept keyCode/which
        // but they will be auto-generated from key/code
      });

      // Dispatch to parent document.body so event bubbles body → document.
      // react-hotkeys-hook listens on document in bubble phase; dispatching
      // directly on document puts it in target phase which may skip those listeners.
      document.body.dispatchEvent(newEvent);

      console.log(
        '[IframeCanvas] 📤 Event dispatched, defaultPrevented:',
        newEvent.defaultPrevented,
        iframeLoadedCounter,
      );

      // If parent handled the event, prevent default in iframe
      if (newEvent.defaultPrevented) {
        e.preventDefault();
      }
    };

    // Forward keyup so react-hotkeys-hook can clear its pressed-keys Set.
    // Without this, the Set grows endlessly and combo hotkeys break.
    const handleKeyUp = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const modifierOnlyKeys = ['Shift', 'Control', 'Alt', 'Meta'];
      if (modifierOnlyKeys.includes(e.key)) {
        return;
      }

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

    // Listen on iframe's window instead of document for keyboard events
    // because keydown doesn't always bubble to document in all browsers
    const iframeWindow = iframe.contentWindow;
    if (iframeWindow) {
      console.log('[IframeCanvas] ✅ Installing keyboard listeners on iframe window');
      iframeWindow.addEventListener('keydown', handleKeyDown, {
        capture: true,
      });
      iframeWindow.addEventListener('keyup', handleKeyUp, {
        capture: true,
      });
    } else {
      console.warn('[IframeCanvas] ⚠️ iframe.contentWindow is null, cannot install keyboard listeners');
    }

    // Cleanup
    return () => {
      window.removeEventListener('mousedown', handleMouseDown, {
        capture: true,
      });
      doc.removeEventListener('click', handleClick, { capture: true });
      doc.removeEventListener('mouseover', handleMouseOver, {
        capture: true,
      });
      doc.removeEventListener('mouseout', handleMouseOut, {
        capture: true,
      });
      doc.removeEventListener('focusin', handleFocusIn, {
        capture: true,
      });
      if (iframeWindow) {
        console.log('[IframeCanvas] Removing keyboard listeners from iframe window');
        iframeWindow.removeEventListener('keydown', handleKeyDown, {
          capture: true,
        });
        iframeWindow.removeEventListener('keyup', handleKeyUp, {
          capture: true,
        });
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
  ]);

  // Update opacity of instances based on activeInstanceId
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentDocument) return;

    const instances = iframe.contentDocument.querySelectorAll('[data-canvas-instance-id]');

    for (const instance of instances) {
      const instanceId = (instance as HTMLElement).dataset.canvasInstanceId;
      if (!instanceId) continue;

      // In board mode: all instances opacity 1
      // In design/interact mode: active opacity 1, inactive opacity 0.5
      const isActive = instanceId === activeInstanceId;
      const opacity = boardModeActive || isActive ? '1' : '0.5';
      (instance as HTMLElement).style.opacity = opacity;
    }
  }, [activeInstanceId, boardModeActive]);

  // Toggle design-mode class on iframe body based on editor mode
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- need to re-run after iframe reload
  }, [editorMode, iframeLoadedCounter]);

  // Poll iframe for runtime errors (Next.js, Vite, Bun error overlays)
  useEffect(() => {
    if (!onRuntimeError) return;

    const checkForRuntimeError = (): RuntimeError | null => {
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      if (!doc) {
        console.log('[IframeCanvas] Runtime error check: no contentDocument');
        return null;
      }

      // Check Next.js error overlay (Shadow DOM via <nextjs-portal>)
      const nextjsPortal = doc.querySelector('nextjs-portal');
      const nextjsShadow = nextjsPortal?.shadowRoot;
      const nextjsOverlay = nextjsShadow?.querySelector('[data-nextjs-dialog-overlay]');
      // console.log('[IframeCanvas] Runtime error check:', {
      // 	hasNextjsPortal: !!nextjsPortal,
      // 	hasNextjsOverlay: !!nextjsOverlay,
      // 	hasViteOverlay: !!doc.querySelector('vite-error-overlay'),
      // 	hasBunHmr: !!doc.querySelector('bun-hmr'),
      // });
      if (nextjsOverlay && nextjsShadow) {
        // Extract error type (Build Error, Runtime Error)
        const errorLabel = nextjsShadow.querySelector('#nextjs__container_errors_label');
        const errorType = errorLabel?.textContent?.trim() || 'Error';

        // Extract error message
        const errorDesc = nextjsShadow.querySelector('#nextjs__container_errors_desc');
        const errorMessage = errorDesc?.textContent?.trim() || 'Unknown error';

        // Extract file and line from codeframe
        const codeframeLink = nextjsShadow.querySelector('[data-nextjs-codeframe] [data-text]');
        const fileLine = codeframeLink?.textContent?.trim() || '';

        // Extract codeframe
        const codeframePre = nextjsShadow.querySelector('[data-nextjs-codeframe] pre');
        const codeframe = codeframePre?.textContent?.trim().slice(0, 500) || '';

        // Parse file and line from fileLine (format: "./file.tsx (8:1)")
        const fileMatch = fileLine.match(/^(.+?)\s*\((\d+)/);
        const file = fileMatch?.[1] || fileLine || undefined;
        const line = fileMatch?.[2] ? Number.parseInt(fileMatch[2], 10) : undefined;

        const fullText = `${errorType}: ${errorMessage}\n\nFile: ${fileLine}\n\n${codeframe}`;

        return {
          framework: 'nextjs',
          type: errorType,
          message: errorMessage,
          file,
          line,
          codeframe: codeframe || undefined,
          fullText,
        };
      }

      // Check Vite error overlay (Shadow DOM)
      const viteOverlay = doc.querySelector('vite-error-overlay');
      if (viteOverlay?.shadowRoot) {
        const shadowRoot = viteOverlay.shadowRoot;

        // Extract error message
        const messageEl = shadowRoot.querySelector('.message-body');
        const errorMessage = messageEl?.textContent?.trim() || 'Unknown error';

        // Extract file info
        const fileEl = shadowRoot.querySelector('.file');
        const file = fileEl?.textContent?.trim() || undefined;

        // Extract frame/stack
        const frameEl = shadowRoot.querySelector('.frame');
        const codeframe = frameEl?.textContent?.trim().slice(0, 500) || undefined;

        const fullText = `Vite Error: ${errorMessage}\n\nFile: ${file || 'unknown'}\n\n${codeframe || ''}`;

        return {
          framework: 'vite',
          type: 'Build Error',
          message: errorMessage,
          file,
          codeframe,
          fullText,
        };
      }

      // Check Bun HMR overlay (Shadow DOM)
      const bunHmr = doc.querySelector('bun-hmr');
      if (bunHmr?.shadowRoot) {
        const shadowRoot = bunHmr.shadowRoot;
        const errorContent = shadowRoot.querySelector('.error-content');

        if (errorContent) {
          // Extract error message from .message-desc
          const messageDesc = errorContent.querySelector('.message-desc');
          let errorType = 'Error';
          let errorMessage = 'Unknown error';

          if (messageDesc) {
            // Get error type (e.g., "error", "TypeError")
            const nameEl = messageDesc.querySelector('code.name');
            if (nameEl?.textContent) {
              errorType = nameEl.textContent;
            }

            // Get error message (the last <code> without special class)
            const codeElements = messageDesc.querySelectorAll('code');
            for (const code of codeElements) {
              if (!code.classList.contains('name') && !code.classList.contains('muted') && code.textContent) {
                errorMessage = code.textContent;
              }
            }
          }

          // Try to get stack trace for more context
          const stackTrace = errorContent.querySelector('.r-error-trace');
          const codeframe = stackTrace?.textContent?.trim().slice(0, 500) || undefined;

          const fullText = `${errorType}: ${errorMessage}\n\n${codeframe || ''}`;

          return {
            framework: 'bun',
            type: errorType,
            message: errorMessage,
            codeframe,
            fullText,
          };
        }
      }

      return null;
    };

    // Initial check (with small delay to let iframe settle after load)
    const timeoutId = setTimeout(() => {
      const initialError = checkForRuntimeError();
      console.log('[IframeCanvas] Initial runtime error check:', initialError);
      onRuntimeError(initialError);
    }, 500);

    // Poll every 2 seconds
    const intervalId = setInterval(() => {
      const error = checkForRuntimeError();
      onRuntimeError(error);
    }, 2000);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, [onRuntimeError, iframeLoadedCounter]);

  // Calculate iframe size for multi mode: quantized to 10000, min padding 5000
  const iframeSize = useMemo(() => {
    console.log('[IframeCanvas] iframeSize calc:', {
      canvasMode,
      hasInstances: !!canvasComposition?.instances,
      instanceCount: canvasComposition?.instances ? Object.keys(canvasComposition.instances).length : 0,
    });

    // Single mode - use 100%
    if (canvasMode !== 'multi') {
      console.log('[IframeCanvas] iframeSize: single mode, returning null');
      return null;
    }

    // Multi mode without instances - use default 10000x10000
    if (!canvasComposition?.instances || Object.keys(canvasComposition.instances).length === 0) {
      console.log('[IframeCanvas] iframeSize: no instances, returning default 10000x10000');
      return { width: '10000px', height: '10000px' };
    }

    const MIN_PADDING = 5000;
    const QUANTUM = 10000;
    const DEFAULT_SIZE = 500;

    let maxRight = 0;
    let maxBottom = 0;

    for (const instance of Object.values(canvasComposition.instances)) {
      const right = (instance.x ?? 0) + (instance.width ?? DEFAULT_SIZE);
      const bottom = (instance.y ?? 0) + (instance.height ?? DEFAULT_SIZE);
      maxRight = Math.max(maxRight, right);
      maxBottom = Math.max(maxBottom, bottom);
    }

    // Add padding, then round UP to nearest quantum (10000)
    const rawWidth = maxRight + MIN_PADDING;
    const rawHeight = maxBottom + MIN_PADDING;

    const width = Math.ceil(rawWidth / QUANTUM) * QUANTUM;
    const height = Math.ceil(rawHeight / QUANTUM) * QUANTUM;

    // Ensure minimum of 10000
    const finalWidth = Math.max(width, QUANTUM);
    const finalHeight = Math.max(height, QUANTUM);

    console.log('[IframeCanvas] iframeSize:', {
      maxRight,
      maxBottom,
      finalWidth,
      finalHeight,
    });

    return {
      width: `${finalWidth}px`,
      height: `${finalHeight}px`,
    };
  }, [canvasMode, canvasComposition]);

  // Sync iframe body dimensions with iframe element size
  useEffect(() => {
    const body = iframeRef.current?.contentDocument?.body;
    if (!body) return;

    if (iframeSize) {
      body.style.width = iframeSize.width;
      body.style.minHeight = iframeSize.height;
    } else {
      body.style.width = '';
      body.style.minHeight = '';
    }
  }, [iframeSize, iframeLoadedCounter]);

  // Require projectId - don't render iframe without it
  if (!meta?.projectId) {
    return (
      <div className="relative w-full h-full bg-white dark:bg-slate-950">
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-900">
          <div className="text-center">
            <p className="text-destructive mb-2">No active project</p>
            <p className="text-sm text-muted-foreground">Please select a project first</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative"
      style={{
        overflow: 'visible',
        background: 'transparent',
        pointerEvents: boardModeActive ? 'none' : 'auto',
        width: canvasMode === 'multi' ? 'fit-content' : '100%',
        height: canvasMode === 'multi' ? 'fit-content' : '100%',
      }}
    >
      <iframe
        id="preview-iframe"
        ref={iframeRef}
        src={
          previewReady
            ? (() => {
                const baseUrl = `/project-preview/${meta.projectId}/test-preview`;
                const params = new URLSearchParams();
                params.set('component', componentPath);

                // Add mode parameter (instances are read from window.parent.__CANVAS_INSTANCES__)
                if (canvasMode === 'multi') {
                  params.set('mode', 'multi');
                }

                return `${baseUrl}?${params.toString()}`;
              })()
            : 'about:blank'
        }
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
        // @ts-expect-error allowtransparency is non-standard but needed for transparent background
        allowtransparency="true"
        className={iframeSize ? 'border-0' : 'w-full h-full border-0'}
        style={{
          width: iframeSize?.width,
          height: iframeSize?.height,
          overflow: 'visible',
          pointerEvents: boardModeActive ? 'none' : 'auto',
          background: 'transparent',
          colorScheme: 'normal',
        }}
        title="Component Preview"
      />
    </div>
  );
}

/**
 * Utility: Get element properties from iframe DOM
 */
export function getElementFromIframe(
  iframeRef: React.RefObject<HTMLIFrameElement>,
  elementId: string,
  instanceId?: string | null,
): HTMLElement | null {
  const iframe = iframeRef.current;
  if (!iframe) return null;

  const doc = iframe.contentDocument;
  if (!doc) return null;

  // Build selector with optional instance scope
  const selector = instanceId
    ? `[data-canvas-instance-id="${instanceId}"] [data-uniq-id="${elementId}"]`
    : `[data-uniq-id="${elementId}"]`;

  return doc.querySelector(selector);
}

/**
 * Utility: Update element styles in iframe
 */
export function updateElementStyles(
  iframeRef: React.RefObject<HTMLIFrameElement>,
  elementId: string,
  styles: Partial<CSSStyleDeclaration>,
  instanceId?: string | null,
): void {
  const element = getElementFromIframe(iframeRef, elementId, instanceId);
  if (!element) return;

  Object.assign(element.style, styles);
}

/**
 * Utility: Get computed styles from element in iframe
 */
export function getComputedStylesFromIframe(
  iframeRef: React.RefObject<HTMLIFrameElement>,
  elementId: string,
  instanceId?: string | null,
): CSSStyleDeclaration | null {
  const iframe = iframeRef.current;
  if (!iframe) return null;

  const element = getElementFromIframe(iframeRef, elementId, instanceId);
  if (!element) return null;

  const doc = iframe.contentDocument;
  if (!doc || !doc.defaultView) return null;

  return doc.defaultView.getComputedStyle(element);
}
