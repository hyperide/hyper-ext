import { TID } from '@shared/data-testid-map';
import { IconCode, IconComponents, IconPointer } from '@tabler/icons-react';
import cn from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { useCanvasEngineOptional } from '@/lib/canvas-engine';
import type { StyleAdapter } from '@/lib/canvas-engine/adapters/StyleAdapter';
import { TailwindAdapter } from '@/lib/canvas-engine/adapters/TailwindAdapter';
import { TamaguiAdapter } from '@/lib/canvas-engine/adapters/TamaguiAdapter';
import type { ParsedStyles } from '@/lib/canvas-engine/adapters/types';
import {
  useElementStyleData,
  useGoToCode,
  useOpenAIChat,
  usePlatformAst,
  usePlatformCanvas,
  usePlatformContext,
} from '@/lib/platform';
import { createSharedDispatch, useSharedEditorState } from '@/lib/platform/shared-editor-state';
import type { StyleNotAppliedContext } from '@/lib/style-change-detector';
import { useEditorStore } from '@/stores/editorStore';

import { useElementSelection } from '../LeftSidebar/hooks/useElementSelection';
import { useElementsTree } from '../LeftSidebar/hooks/useElementsTree';
import { useFunctionNavigate } from '../LeftSidebar/hooks/useFunctionNavigate';
import { ElementsTreeSection } from '../LeftSidebar/sections/ElementsTreeSection';
import { SetupTailwindButton } from '../SetupTailwindButton';
import type { FillMode } from '../ui/fill-picker';
import { Input } from '../ui/input';
import { ToastAction } from '../ui/toast';
import { ComponentQuickList } from './ComponentQuickList';
import { useComponentPathCompat, useSelectionCompat } from './hooks/useSelectionCompat';
import { useNavigationHandlers } from './hooks/useNavigationHandlers';
import { usePopulateStyleState } from './hooks/usePopulateStyleState';
import { useStyleHandlers } from './hooks/useStyleHandlers';
import { useStyleSync } from './hooks/useStyleSync';
import {
  AppearanceSection,
  CommentsSectionContainer,
  EffectsSection,
  FillSection,
  HeaderSection,
  I18nTextInspector,
  LayoutSection,
  MarginSection,
  PositionSection,
  PropsSection,
  StateSelectorSection,
  StrokeSection,
  StyleSourceTabsSection,
  ViewControlsSection,
} from './sections';
import { getExplicitStyleSourceTabId, resolveInspectorStyleSourceTabs } from './source-tabs';
import type { EffectItem, LayoutType, PositionType, RightSidebarProps, StrokeItem } from './types';
import { findNodeById } from './utils';

export default function RightSidebar({
  onOpenSettings,
  viewport,
  onZoomChange,
  onFitToContent,
  activeInstanceId = null,
  canvasMode = 'single',
  instanceSize,
  onInstanceSizeChange,
  // Project UI kit data (passed from CanvasEditor)
  projectUIKit = 'none',
  activeProjectId = null,
  activeProjectName = null,
  publicDirExists = false,
  componentGroups,
  explorerVisible,
  onComponentClick,
  readonly: readonlyProp = false,
}: RightSidebarProps) {
  const engine = useCanvasEngineOptional();
  const canvas = usePlatformCanvas();
  const platformContext = usePlatformContext();
  const isVSCode = platformContext === 'vscode-webview';

  const selectedIds = useSelectionCompat(engine);
  const componentPath = useComponentPathCompat(engine);

  const { openFile, showComments, setShowComments, isReadonly: editorStoreReadonly } = useEditorStore();
  const isReadonly = isVSCode ? readonlyProp : editorStoreReadonly;
  const inspectorUIKit = projectUIKit === 'none' && isVSCode ? 'tailwind' : projectUIKit;
  const canInspectStyles = inspectorUIKit !== 'none';

  // Elements tree for Inspector (VS Code only, when Explorer is hidden)
  const showTreeInInspector = isVSCode && explorerVisible !== true && !!componentPath;
  const elementsTree = useElementsTree();
  const elementSelection = useElementSelection(elementsTree);
  const handleFunctionNavigate = useFunctionNavigate(componentPath ?? undefined);
  const [elementsTreeCollapsed, setElementsTreeCollapsed] = useState(false);

  // AST operations (platform-aware: authFetch in browser, canvasRPC in VS Code)
  const astOps = usePlatformAst();
  const goToCode = useGoToCode();
  const openAIChat = useOpenAIChat();

  // Create style adapter based on UI kit
  const styleAdapter: StyleAdapter = useMemo(() => {
    return projectUIKit === 'tamagui' ? new TamaguiAdapter(astOps) : new TailwindAdapter(astOps);
  }, [projectUIKit, astOps]);

  // Current state modifier for Tailwind (hover, focus, etc.)
  const [currentState, setCurrentState] = useState<string | undefined>(undefined);
  const [selectedSourceTabId, setSelectedSourceTabId] = useState('computed');

  // Read element style data (browser: engine+DOM, VS Code: RPC)
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const sharedItemIndices = useSharedEditorState((s) => s.selectedItemIndices);
  const selectedItemIndex =
    selectedId && engine
      ? (engine.getSelection().selectedItemIndices.get(selectedId) ?? null)
      : selectedId
        ? (sharedItemIndices?.[selectedId] ?? null)
        : null;
  const [styleRefreshKey, setStyleRefreshKey] = useState(0);
  // Tracks write failures: bindingId scopes the rollback to the exact binding that failed.
  // Without bindingId, a failure on binding A would trigger rollback in the currently-visible binding B.
  const [i18nRollbackSignal, setI18nRollbackSignal] = useState<{ bindingId: string; counter: number } | null>(null);
  // Keeps keyBusy=true until i18nText.key confirms the new key after a write.
  // Unlike pendingTextKeyRef (a ref used by debounced text-write), this is React state so it
  // triggers re-renders and keeps the combobox disabled during the i18nText re-read window.
  const [pendingKeyWrite, setPendingKeyWrite] = useState<{ key: string; elementId: string } | null>(null);
  // Locale selected by the user in the i18n inspector. Resets when element/binding changes.
  const [i18nActiveLocale, setI18nActiveLocale] = useState<string | undefined>(undefined);
  // External refresh trigger (e.g. undo/redo from extension host)
  const styleVersion = useSharedEditorState((s) => s.styleVersion) ?? 0;
  const runtimeStyle = useSharedEditorState((s) => s.selectedElementRuntimeStyle);
  const writeInProgress = useSharedEditorState((s) => s.writeInProgress);
  const selectedElementDomText = useSharedEditorState((s) => s.selectedElementDomText);
  const {
    parsedStyles,
    childrenType,
    textContent: dataTextContent,
    tagType,
    loading,
    childrenLocation,
    styleReadResult,
    i18nText,
    availableKeys: availableI18nKeys,
  } = useElementStyleData({
    elementId: selectedId,
    componentPath,
    canvas,
    engine,
    styleAdapter,
    activeInstanceId,
    itemIndex: selectedItemIndex,
    refreshKey: styleRefreshKey + styleVersion,
    runtimeStyle,
    domTextContent: selectedElementDomText ?? undefined,
    activeLocale: i18nActiveLocale,
  });
  const sourceTabs = useMemo(
    () =>
      resolveInspectorStyleSourceTabs({
        inspectorUIKit,
        componentPath,
        canInspectStyles,
        styleReadResult,
      }),
    [inspectorUIKit, componentPath, canInspectStyles, styleReadResult],
  );
  // Only show the tab row when there's more than one real CSS approach to choose from.
  const visibleSourceTabs = useMemo(() => {
    const nonComputed = sourceTabs.filter((tab) => tab.confidence !== 'computed-only');
    return nonComputed.length <= 1 ? [] : sourceTabs;
  }, [sourceTabs]);
  const explicitSourceTabId = useMemo(() => {
    if (!sourceTabs.some((tab) => tab.id === selectedSourceTabId)) {
      return undefined;
    }
    return getExplicitStyleSourceTabId(selectedSourceTabId);
  }, [sourceTabs, selectedSourceTabId]);

  useEffect(() => {
    if (!sourceTabs.some((tab) => tab.id === selectedSourceTabId)) {
      setSelectedSourceTabId('computed');
      return;
    }
    // When the project has exactly one concrete CSS approach, auto-select it so the user
    // doesn't have to manually switch away from "Computed" every time.
    const nonComputedTabs = sourceTabs.filter((tab) => tab.confidence !== 'computed-only');
    if (nonComputedTabs.length === 1 && selectedSourceTabId === 'computed') {
      setSelectedSourceTabId(nonComputedTabs[0].id);
    }
  }, [sourceTabs, selectedSourceTabId]);

  // Reset i18n locale selection and last-written key when the selected element changes.
  // This prevents a stale locale or stale previousKey from carrying over to a different element.
  // Note: pendingKeyWrite is NOT cleared here — HMR transiently sets selectedId to null, which
  // would prematurely drop the pending guard. The pendingKeyWrite useEffect handles cleanup when
  // selectedId is non-null and different from pendingKeyWrite.elementId.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on element change only
  useEffect(() => {
    setI18nActiveLocale(undefined);
    lastWrittenI18nKeyRef.current = null;
  }, [selectedId]);

  // Apply state filter to parsedStyles
  const effectiveParsed: Partial<ParsedStyles> = useMemo(() => {
    if (!parsedStyles) return {};
    if (!currentState) return parsedStyles;

    const stateKey = currentState.replace(/-([a-z])/g, (_, letter: string) =>
      letter.toUpperCase(),
    ) as keyof ParsedStyles;
    return (parsedStyles[stateKey] as Partial<ParsedStyles>) || {};
  }, [parsedStyles, currentState]);

  // AI error fallback: when style sync fails, open AI chat with error context
  const handleSyncError = useCallback(
    (styles: Record<string, string>, error: string) => {
      const styleDesc = Object.entries(styles)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      openAIChat({
        prompt: `Style update failed for element "${selectedIds[0] ?? 'unknown'}" in ${componentPath ?? 'unknown file'}.\n\nAttempted styles: ${styleDesc}\nError: ${error}\n\nPlease fix the issue or apply these styles manually.`,
        forceNewChat: true,
      });
    },
    [openAIChat, selectedIds, componentPath],
  );

  // Sync toast lifecycle — show "Applying styles..." only if sync takes >600ms
  const syncToastRef = useRef<{ dismiss: () => void } | null>(null);
  const syncToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSyncStart = useCallback(() => {
    // Timer already running — don't duplicate
    if (syncToastTimerRef.current) return;
    // Dismiss any stale toast (e.g. "Style may not have taken effect") before scheduling new one
    syncToastRef.current?.dismiss();
    syncToastRef.current = null;
    // Delay toast — if sync completes within 600ms, no toast shown
    syncToastTimerRef.current = setTimeout(() => {
      syncToastTimerRef.current = null;
      syncToastRef.current = toast({ title: 'Applying styles...' });
    }, 600);
  }, []);

  const handleSyncEnd = useCallback(() => {
    if (syncToastTimerRef.current) {
      clearTimeout(syncToastTimerRef.current);
      syncToastTimerRef.current = null;
    }
    syncToastRef.current?.dismiss();
    syncToastRef.current = null;
  }, []);

  const handleStyleNotApplied = useCallback(
    (context: StyleNotAppliedContext) => {
      syncToastRef.current?.dismiss();
      const styleDesc = context.unchangedProperties.map((key) => `${key}: ${context.styles[key] ?? '?'}`).join(', ');

      syncToastRef.current = toast({
        title: 'Style may not have taken effect',
        description: `${context.unchangedProperties.length} property unchanged`,
        action: (
          <ToastAction
            altText="Ask AI for help"
            onClick={() =>
              openAIChat({
                prompt: `I changed styles on element "${context.elementId}" in ${context.filePath}, but the visual result didn't change.\n\nAttempted: ${styleDesc}\nUnchanged: ${context.unchangedProperties.join(', ')}\n\nThis is likely CSS specificity — the component may use variants/cva that override className.\nPlease check the component source and suggest the correct way to apply these styles.`,
                forceNewChat: true,
              })
            }
          >
            Ask AI
          </ToastAction>
        ),
      });
    },
    [openAIChat],
  );

  // Style sync hook
  const { syncStyleChange, syncTextChange, isStyleSyncing } = useStyleSync({
    selectedIds,
    filePath: componentPath,
    styleAdapter,
    astOps,
    currentState,
    engine,
    selectedSourceTabId: explicitSourceTabId,
    onSyncError: handleSyncError,
    onSyncStart: handleSyncStart,
    onSyncEnd: handleSyncEnd,
    onStyleNotApplied: handleStyleNotApplied,
  });

  // Position state
  const [selectedPosition, setSelectedPosition] = useState<PositionType>('static');
  const [posTop, setPosTop] = useState('');
  const [posRight, setPosRight] = useState('');
  const [posBottom, setPosBottom] = useState('');
  const [posLeft, setPosLeft] = useState('');

  // Margin state
  const [marginTop, setMarginTop] = useState('');
  const [marginRight, setMarginRight] = useState('');
  const [marginBottom, setMarginBottom] = useState('');
  const [marginLeft, setMarginLeft] = useState('');
  const [marginLinked, setMarginLinked] = useState(false);

  // Layout state
  const [selectedLayout, setSelectedLayout] = useState<LayoutType>('layout');
  const [clipContent, setClipContent] = useState(true);
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');

  // Padding state
  const [paddingTop, setPaddingTop] = useState('');
  const [paddingRight, setPaddingRight] = useState('');
  const [paddingBottom, setPaddingBottom] = useState('');
  const [paddingLeft, setPaddingLeft] = useState('');

  // Flex/Grid layout state
  const [gap, setGap] = useState('');
  const [justifyContent, setJustifyContent] = useState('');
  const [alignItems, setAlignItems] = useState('');

  // Grid-specific layout state
  const [columnGap, setColumnGap] = useState('');
  const [rowGap, setRowGap] = useState('');
  const [gridJustifyItems, setGridJustifyItems] = useState('');
  const [gridAlignItems, setGridAlignItems] = useState('');
  const [gridCols, setGridCols] = useState('');
  const [gridRows, setGridRows] = useState('');

  // Color state
  const [backgroundColor, setBackgroundColor] = useState('');
  const [textColor, setTextColor] = useState('');
  const [fontSize, setFontSize] = useState('');
  const [fillOpacity, setFillOpacity] = useState('');
  const [textOpacity, setTextOpacity] = useState('');
  const [opacity, setOpacity] = useState('');
  const [fillMode, setFillMode] = useState<FillMode>('color');
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);

  // Border radius state
  const [borderRadius, setBorderRadius] = useState('');

  // Stroke state
  const [strokes, setStrokes] = useState<StrokeItem[]>([]);

  // Effects state
  const [effects, setEffects] = useState<EffectItem[]>([]);

  // Text content state
  const [textContent, setTextContent] = useState('');
  const [isTextFromProps, setIsTextFromProps] = useState(false);
  const debouncedTextSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedI18nWriteRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set to true on unmount so any in-flight i18n write callbacks bail out instead of
  // dispatching selection / writeInProgress updates to a detached component.
  const i18nWriteAbortedRef = useRef(false);
  // Stores the last selectedId + componentPath when i18nText was valid. Used as fallback in
  // handleI18nKeyChange: HMR transiently clears selectedIds, but we still need to send the
  // second write to the correct element if the inspector panel is still showing (via ?? prev.i18nText).
  const lastI18nElementRef = useRef<{ elementId: string; path: string | null } | null>(null);
  // Tracks the last successfully written i18n key. Prevents stale previousKey when a second
  // key change arrives before the useElementStyleData re-fetch returns the new i18nText.
  const lastWrittenI18nKeyRef = useRef<string | null>(null);
  // Tracks pending key after commitKey — stays set until i18nText.key catches up or element changes.
  // Prevents handleI18nResolvedTextChange from writing to the stale key during the RPC round-trip.
  const pendingTextKeyRef = useRef<{ key: string; elementId: string } | null>(null);
  // Guard: prevent external data refresh from overriding text the user is actively typing
  const isEditingTextRef = useRef(false);
  const editingTextResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Root ref for wheel event handling
  const rootRef = useRef<HTMLDivElement>(null);

  const {
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
  } = useStyleHandlers({
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
  });

  // Layout change handler
  const handleLayoutChange = useCallback(
    async (layoutType: LayoutType) => {
      if (selectedIds.length === 0 || !selectedIds[0]) {
        return;
      }

      const selectedElementId = selectedIds[0];

      if (!componentPath) {
        console.error('[RightSidebar] No file path found');
        return;
      }

      try {
        setSelectedLayout(layoutType);
        await styleAdapter.changeLayout(selectedElementId, componentPath, layoutType);
        setStyleRefreshKey((k) => k + 1);
      } catch (error) {
        console.error('[RightSidebar] Failed to change layout:', error);
      }
    },
    [selectedIds, componentPath, styleAdapter],
  );

  // Text content handler
  const handleTextContentChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setTextContent(value);

      // Prevent external data refresh from overriding user input while typing
      isEditingTextRef.current = true;
      if (editingTextResetRef.current) clearTimeout(editingTextResetRef.current);
      // Reset after 2s — covers debounce 300ms + sync roundtrip + file-watch latency
      editingTextResetRef.current = setTimeout(() => {
        isEditingTextRef.current = false;
      }, 2000);

      if (debouncedTextSyncRef.current) {
        clearTimeout(debouncedTextSyncRef.current);
      }

      debouncedTextSyncRef.current = setTimeout(() => {
        syncTextChange(value);
      }, 300);
    },
    [syncTextChange],
  );

  const { handleGoToTextCode, handleGoToTextCodeVSCode } = useNavigationHandlers({
    selectedIds,
    componentPath,
    engine,
    openFile,
    goToCode,
    childrenLocation,
  });

  // "Go to main component" (HYP-563): jump from the selected instance to its
  // master component definition. The extension resolves the JSX tag's import to a
  // definition file and opens it. Gated to component references (uppercase tag)
  // in VS Code, where the resolver/RPC lives — see isMasterComponentNavigable.
  const handleGoToMasterComponent = useCallback(() => {
    if (!selectedId || !componentPath) return;
    canvas.sendEvent({
      type: 'master:goToComponent',
      elementId: selectedId,
      nodeRef: selectedId,
      componentPath,
      componentName: tagType,
    });
  }, [selectedId, componentPath, tagType, canvas]);

  // A selected element points at a master component when its tag is a component
  // reference (PascalCase), not a host element (`div`). Only surfaced in VS Code,
  // which owns the AST resolver + editor-open plumbing.
  const isMasterComponentNavigable = isVSCode && !!selectedId && /^[A-Z]/.test(tagType ?? '');

  const handleI18nLocaleChange = useCallback((locale: string) => {
    setI18nActiveLocale(locale);
    // Re-read is triggered automatically via activeLocale in useElementStyleData deps
  }, []);

  // Dispatcher to re-broadcast selection after AST mutations that trigger HMR reload.
  // Without this, rewriting JSX (e.g. i18n key change) causes the iframe to lose
  // selection because the React fiber tree is rebuilt and the previous data-uniq-id
  // is no longer attached to the same DOM node.
  const i18nDispatch = useMemo(() => (engine ? null : createSharedDispatch(canvas)), [engine, canvas]);

  // Capture last-known element identity while i18nText is valid. HMR may transiently
  // clear selectedIds after a write; this ref lets the second write still go through.
  if (i18nText && selectedId) {
    lastI18nElementRef.current = { elementId: selectedId, path: componentPath };
  }
  // Clear pendingTextKeyRef when element changes or when i18nText.key has caught up.
  if (pendingTextKeyRef.current !== null) {
    if (pendingTextKeyRef.current.elementId !== selectedId) {
      pendingTextKeyRef.current = null;
    } else if (i18nText?.kind === 'i18n' && i18nText.key === pendingTextKeyRef.current.key) {
      pendingTextKeyRef.current = null;
    }
  }

  // Clear pendingKeyWrite (React state) when i18nText.key confirms the written key or element changes.
  // This is the state-based counterpart to pendingTextKeyRef: drives re-renders so keyBusy updates.
  // Guard: only clear on genuine element switch (non-null selectedId), not on HMR-induced transient
  // selectedId=null. A null selectedId during HMR would otherwise drop the pending guard early,
  // letting the inspector show a stale realKey and causing commitKey to abort the second write.
  useEffect(() => {
    if (pendingKeyWrite === null) return;
    if (selectedId != null && pendingKeyWrite.elementId !== selectedId) {
      setPendingKeyWrite(null);
      return;
    }
    if (i18nText?.kind === 'i18n' && i18nText.key === pendingKeyWrite.key) {
      setPendingKeyWrite(null);
    }
  }, [i18nText, selectedId, pendingKeyWrite]);

  const handleI18nKeyChange = useCallback(
    (newKey: string) => {
      if (!i18nText || i18nText.kind !== 'i18n') return;
      const effectiveSelectedId = selectedId ?? lastI18nElementRef.current?.elementId ?? null;
      if (!effectiveSelectedId) return;
      // Set before the async IIFE so debounced text writes use the new key
      // during the RPC round-trip window (i18nText.key still stale until re-read).
      pendingTextKeyRef.current = { key: newKey, elementId: effectiveSelectedId };
      // Also set React state so keyBusy stays true until i18nText.key confirms the write.
      // pendingTextKeyRef alone doesn't trigger re-renders — this state does.
      setPendingKeyWrite({ key: newKey, elementId: effectiveSelectedId });
      const previousSelectedId = effectiveSelectedId;
      // If the user typed a key that doesn't yet exist in the locale, treat this
      // as "create new key" — also write the JSON resource so the next re-read
      // returns editable=true and the user can immediately type the translation.
      // Otherwise (existing key) skip the JSON write and only retarget JSX.
      const isNewKey = !(availableI18nKeys ?? []).includes(newKey);
      // Diagnostic timeline: gated on window.__HC_DEBUG_SELECTION so it doesn't
      // pollute prod consoles. Tracks the i18n-key-change flicker window
      // (Task 1 of selection-survives-i18n-write).
      const dbg = (label: string, extra?: unknown): void => {
        const w = window as unknown as Record<string, unknown>;
        if (!w.__HC_DEBUG_SELECTION) return;
        // eslint-disable-next-line no-console
        console.warn(`[HC i18n-key-change ${label}] t+${Math.round(performance.now() - t0)}ms`, extra ?? '');
      };
      const t0 = performance.now();
      dbg('start', { previousSelectedId, newKey, isNewKey });
      void (async () => {
        const writeId = crypto.randomUUID();
        if (i18nDispatch) i18nDispatch({ writeInProgress: { writeId, startedAt: Date.now() } });
        // Path B: freeze selection rect during JSX rewrite — HMR gap would otherwise
        // flicker the outline off until the new fiber settles.
        canvas.sendEvent({ type: 'iframe:writeI18nResource', phase: 'start' });
        try {
          const writeResult = await astOps.writeI18nResource({
            library: i18nText.library,
            key: newKey,
            namespace: i18nText.namespace,
            activeLocale: i18nText.activeLocale,
            newText: i18nText.resolvedText ?? '',
            // Use lastWrittenI18nKeyRef when available: i18nText.key may be stale if a
            // second key change arrives before the useElementStyleData re-fetch completes.
            previousKey: lastWrittenI18nKeyRef.current ?? i18nText.key,
            filePath: i18nText.sourceLocation.filePath,
            elementId: effectiveSelectedId,
            skipResourceWrite: !isNewKey,
          });
          lastWrittenI18nKeyRef.current = newKey;
          dbg('writeI18nResource resolved', writeResult);
          // Path A: bridge returns post-write canonical ID, single dispatch re-attaches
          // selection without timeout chains. Falls back to previousSelectedId.
          if (i18nDispatch) {
            const targetId = writeResult.newElementId ?? previousSelectedId;
            i18nDispatch({ selectedIds: [targetId] });
            dbg('dispatch sent', { selectedIds: [targetId] });
          }
        } catch {
          // Restore selection on partial write (JSON wrote but JSX update failed).
          if (i18nDispatch) {
            i18nDispatch({ selectedIds: [previousSelectedId] });
          }
          pendingTextKeyRef.current = null;
          // Roll back optimisticKey in the inspector — same signal used by text-write rollback.
          // Without this, optimisticKey stays on the new (failed) key permanently because
          // realKey doesn't change (file unchanged), so the safety-net useEffect never fires.
          const bindingId = `${i18nText.library}|${i18nText.key}`;
          setI18nRollbackSignal((prev) => ({ bindingId, counter: (prev?.counter ?? 0) + 1 }));
        } finally {
          // Always release the freeze, even on throw.
          canvas.sendEvent({ type: 'iframe:writeI18nResource', phase: 'done' });
          // Clear writeInProgress so keyBusy disabling is released.
          if (i18nDispatch && useSharedEditorState.getState().writeInProgress?.writeId === writeId) {
            i18nDispatch({ writeInProgress: null });
          }
          // Release keyBusy on both success and failure — clearing here rather than only
          // in catch avoids the case where newElementId === elementId (selectedId unchanged)
          // which would otherwise keep keyBusy=true for the full NodeMapService rebuild (~20s).
          setPendingKeyWrite(null);
          setStyleRefreshKey((k) => k + 1);
        }
      })();
    },
    [i18nText, astOps, selectedId, i18nDispatch, availableI18nKeys, canvas],
  );

  const handleI18nResolvedTextChange = useCallback(
    (newText: string) => {
      if (!i18nText || i18nText.kind !== 'i18n' || !selectedId) return;
      const previousSelectedId = selectedId;
      if (debouncedI18nWriteRef.current) clearTimeout(debouncedI18nWriteRef.current);
      debouncedI18nWriteRef.current = setTimeout(() => {
        const writeId = crypto.randomUUID();
        if (i18nDispatch) i18nDispatch({ writeInProgress: { writeId, startedAt: Date.now() } });
        void (async () => {
          // Only track navigation in VS Code mode (where i18nDispatch is available and HMR fires).
          let navigationAway = false;
          let unsubscribeNavigation: (() => void) | undefined;
          if (i18nDispatch) {
            // Detect if user navigates to a different element during the write window.
            // Fires on non-empty selection only (ignores HMR-induced transient selectedIds:[]).
            unsubscribeNavigation = useSharedEditorState.subscribe((s) => {
              if (i18nWriteAbortedRef.current) {
                unsubscribeNavigation?.();
                return;
              }
              if (s.selectedIds.length > 0 && s.selectedIds[0] !== previousSelectedId) {
                navigationAway = true;
                unsubscribeNavigation?.();
              }
            });
          }
          // Guard: only restore selection if user hasn't navigated away mid-write and
          // the component is still mounted. Defined before try so catch can call it too
          // (partial write may have triggered HMR even when writeI18nResource throws,
          // e.g. JSON wrote → JSX update failed).
          const restoreIfCurrent = () => {
            if (!i18nDispatch || navigationAway || i18nWriteAbortedRef.current) return;
            const cur = useSharedEditorState.getState().selectedIds;
            if (cur.length === 0 || cur[0] === previousSelectedId) {
              i18nDispatch({ selectedIds: [previousSelectedId] });
            }
          };
          try {
            await astOps.writeI18nResource({
              library: i18nText.library,
              key:
                pendingTextKeyRef.current?.elementId === previousSelectedId
                  ? pendingTextKeyRef.current.key
                  : i18nText.key,
              namespace: i18nText.namespace,
              activeLocale: i18nText.activeLocale,
              newText,
            });
            // Restore selection — locale JSON rewrite triggers HMR which rebuilds the
            // fiber tree, dropping the iframe selection. Mirror key-change pattern.
            if (i18nDispatch) {
              restoreIfCurrent();
              setTimeout(restoreIfCurrent, 250);
              setTimeout(() => {
                restoreIfCurrent();
                unsubscribeNavigation?.();
                if (useSharedEditorState.getState().writeInProgress?.writeId === writeId) {
                  i18nDispatch({ writeInProgress: null });
                }
              }, 800);
            }
          } catch {
            // Restore selection in case the write partially succeeded (e.g., JSON wrote and
            // triggered HMR, but something else then threw). Harmless if HMR never fired.
            restoreIfCurrent();
            unsubscribeNavigation?.();
            if (i18nDispatch && useSharedEditorState.getState().writeInProgress?.writeId === writeId) {
              i18nDispatch({ writeInProgress: null });
            }
            // write failed — rollback scoped to this binding so other visible bindings are not affected
            const bindingId = `${i18nText.library}|${i18nText.key}`;
            setI18nRollbackSignal((prev) => ({ bindingId, counter: (prev?.counter ?? 0) + 1 }));
          } finally {
            // always re-read to sync inspector with file state
            setStyleRefreshKey((k) => k + 1);
          }
        })();
      }, 300);
    },
    [i18nText, astOps, selectedId, i18nDispatch],
  );

  // ========================================================================
  // Populate UI state from parsedStyles
  // ========================================================================

  usePopulateStyleState({
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
  });

  // Auto-reset unsupported values when UI kit is Tamagui
  useEffect(() => {
    if (projectUIKit !== 'tamagui') return;

    if (selectedPosition === 'sticky') {
      setSelectedPosition('static');
    }
    if (selectedLayout === 'grid') {
      setSelectedLayout('row');
    }
    setEffects((prev) => prev.filter((e) => e.type !== 'inner-shadow' && e.type !== 'blur'));
  }, [projectUIKit, selectedPosition, selectedLayout]);

  // Prevent scroll propagation
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.stopPropagation();
    };

    el.addEventListener('wheel', handleWheel, { passive: true });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debouncedTextSyncRef.current) {
        clearTimeout(debouncedTextSyncRef.current);
      }
      if (syncToastTimerRef.current) {
        clearTimeout(syncToastTimerRef.current);
      }
      if (debouncedI18nWriteRef.current) {
        clearTimeout(debouncedI18nWriteRef.current);
      }
      if (editingTextResetRef.current) {
        clearTimeout(editingTextResetRef.current);
      }
    };
  }, []);

  // Clear writeInProgress if component unmounts while a write is in flight.
  // Without this the iframe stays frozen and Zustand retains stale writeInProgress state.
  // Also set the abort flag so any pending post-write callbacks (restoreIfCurrent,
  // navigation subscriptions) bail out instead of dispatching to a detached component.
  useEffect(() => {
    return () => {
      i18nWriteAbortedRef.current = true;
      if (i18nDispatch && useSharedEditorState.getState().writeInProgress) {
        i18nDispatch({ writeInProgress: null });
      }
    };
  }, [i18nDispatch]);

  // Cancel pending i18n text write when selection changes — prevents a stale write
  // from element A firing (and setting writeInProgress) after user has moved to element B.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional cancel on element change only
  useEffect(() => {
    if (debouncedI18nWriteRef.current) {
      clearTimeout(debouncedI18nWriteRef.current);
      debouncedI18nWriteRef.current = null;
    }
  }, [selectedId]);

  // Get frame type for display
  const getFrameType = useCallback(() => {
    // VS Code mode: use tagType from style data
    if (!engine) {
      return tagType === 'div' ? 'Frame (div)' : tagType || 'Frame';
    }

    // SaaS mode: look up in engine AST/registry
    const ids = engine.getSelection().selectedIds;
    const instance = ids.length > 0 ? (engine.getInstance(ids[0]) ?? null) : null;

    if (ids.length > 0 && !instance) {
      const lookupId = ids[0];
      const root = engine.getRoot();

      const rootAst = root.metadata?.astStructure;
      if (Array.isArray(rootAst)) {
        const foundNode = findNodeById(rootAst, lookupId);
        if (foundNode) {
          return foundNode.type === 'div' ? 'Frame (div)' : foundNode.type;
        }
      }

      const rootChildren = root.children || [];
      for (const childId of rootChildren) {
        const inst = engine.getInstance(childId);
        const childAst = inst?.metadata?.astStructure;
        if (Array.isArray(childAst)) {
          const foundNode = findNodeById(childAst, lookupId);
          if (foundNode) {
            return foundNode.type === 'div' ? 'Frame (div)' : foundNode.type;
          }
        }
      }

      return 'Frame';
    }

    if (!instance) {
      return 'Frame';
    }

    const componentDef = engine.registry.get(instance.type);
    if (componentDef) {
      return componentDef.label;
    }

    return instance.type;
  }, [engine, tagType]);

  return (
    <div
      data-testid="RightSidebar"
      ref={rootRef}
      className="h-full w-full border-l border-border bg-background overflow-y-auto overflow-x-hidden relative z-20"
    >
      {/* SaaS-only sections */}
      {!isVSCode && (
        <HeaderSection onOpenSettings={onOpenSettings} projectId={activeProjectId} projectName={activeProjectName} />
      )}
      {!isVSCode && (
        <ViewControlsSection
          viewport={canvasMode === 'multi' ? viewport : undefined}
          onZoomChange={canvasMode === 'multi' ? onZoomChange : undefined}
          onFitToContent={canvasMode === 'multi' ? onFitToContent : undefined}
          instanceSize={instanceSize}
          onInstanceSizeChange={onInstanceSizeChange}
        />
      )}
      {!isVSCode && showComments && (
        <CommentsSectionContainer
          projectId={activeProjectId ?? undefined}
          componentPath={componentPath ?? undefined}
          onClose={() => setShowComments(false)}
        />
      )}

      {/* No selection */}
      {selectedIds.length === 0 && (
        <div className="px-4 py-8 text-center flex flex-col items-center gap-3">
          <IconPointer className="w-8 h-8 text-muted-foreground/50" stroke={1.5} />
          <p className="text-sm font-medium text-foreground">
            {componentPath ? 'No element selected' : 'No component open'}
          </p>
          <p className="text-xs text-muted-foreground">
            {componentPath
              ? 'Click an element in the tree to inspect its styles'
              : 'Open a component from the Explorer panel'}
          </p>
        </div>
      )}

      {/* Elements tree — shown when component is open, nothing selected, Explorer hidden */}
      {showTreeInInspector && selectedIds.length === 0 && elementsTree.length > 0 && (
        <ElementsTreeSection
          collapsed={elementsTreeCollapsed}
          hasContent={elementsTree.length > 0}
          tree={elementsTree}
          selectedIds={elementSelection.selectedIds}
          hoveredId={elementSelection.hoveredId}
          onSelectElement={elementSelection.handleSelect}
          onHoverElement={elementSelection.handleHover}
          onFunctionNavigate={handleFunctionNavigate}
          onToggle={() => setElementsTreeCollapsed((v) => !v)}
        />
      )}

      {/* Component list — shown when no component is open and Explorer is hidden */}
      {selectedIds.length === 0 &&
        !componentPath &&
        explorerVisible !== true &&
        componentGroups &&
        (componentGroups.atomGroups.length > 0 || componentGroups.compositeGroups.length > 0) && (
          <ComponentQuickList
            atomGroups={componentGroups.atomGroups}
            compositeGroups={componentGroups.compositeGroups}
            onComponentClick={onComponentClick}
          />
        )}

      {selectedIds.length > 1 && (
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground mb-2">Multiple elements selected</p>
          <p className="text-xs text-muted-foreground">Select a single element to edit its properties</p>
        </div>
      )}

      {/* Loading (VS Code RPC) — only on first load, not on element switch */}
      {selectedIds.length === 1 && loading && !parsedStyles && (
        <div className="px-4 py-8 text-center">
          <p className="text-xs text-muted-foreground">Reading styles...</p>
        </div>
      )}

      {selectedIds.length === 1 && parsedStyles && (canvasMode !== 'multi' || activeInstanceId) && (
        <>
          {/* Frame type + "Go to main component" (HYP-563, Figma-style affordance) */}
          <div className="w-full px-4 py-3 border-b border-border overflow-hidden flex items-center gap-2">
            <span
              data-testid={TID.inspector.componentName}
              className="text-sm font-semibold text-foreground truncate flex-1 min-w-0"
            >
              {getFrameType()}
            </span>
            {isMasterComponentNavigable && (
              <button
                type="button"
                data-testid={TID.inspector.goToMasterComponent}
                onClick={handleGoToMasterComponent}
                title={`Go to main component (${getFrameType()})`}
                aria-label={`Go to main component ${getFrameType()}`}
                className="group flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground bg-transparent transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              >
                <IconComponents
                  className="w-4 h-4 transition-transform duration-150 group-hover:-translate-y-px group-hover:translate-x-px"
                  stroke={1.75}
                />
              </button>
            )}
          </div>

          {/* Text Content */}
          {childrenType !== 'jsx' && i18nText?.kind !== 'i18n' && (
            <div
              className={`w-full px-4 py-3 border-b border-border overflow-hidden ${isReadonly ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <div className="flex items-center gap-1">
                <div className="flex-1 min-w-0 min-h-6 px-2 bg-muted rounded flex items-center gap-1">
                  {(childrenType === 'expression' || childrenType === 'expression-complex') && (
                    <span className="text-[11px] text-muted-foreground font-mono">{'{}'}</span>
                  )}
                  <Input
                    type="text"
                    value={textContent}
                    onChange={handleTextContentChange}
                    disabled={isReadonly}
                    className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1 font-mono"
                    placeholder={
                      childrenType === 'expression' || childrenType === 'expression-complex'
                        ? 'Expression'
                        : 'Text content'
                    }
                  />
                </div>
                {/* Go to code button */}
                {isVSCode ? (
                  childrenLocation && (
                    <button
                      type="button"
                      onClick={handleGoToTextCodeVSCode}
                      className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 bg-transparent"
                      title="Go to code"
                    >
                      <IconCode className="w-4 h-4 text-foreground" stroke={1.5} />
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={handleGoToTextCode}
                    className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 bg-transparent"
                    title="Go to code"
                  >
                    <IconCode className="w-4 h-4 text-foreground" stroke={1.5} />
                  </button>
                )}
              </div>
              {isTextFromProps && (
                <div className="w-sidebar-content mt-2 px-2 py-1.5 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded text-[10px] text-amber-800 dark:text-amber-400">
                  ⚠️ Text is passed dynamically.
                  {activeInstanceId ? ' To edit instance props click the badge.' : ' Editing may broke jsx'}
                </div>
              )}
            </div>
          )}

          {/* i18n Text Inspector */}
          {i18nText?.kind === 'i18n' &&
            (() => {
              // Key only changes on library/key identity change, NOT on locale change.
              // Locale change triggers a re-read via useElementStyleData deps; the component
              // stays mounted so localText is not reset.
              const bindingKey = `${i18nText.library}|${i18nText.key}`;
              return (
                <I18nTextInspector
                  key={bindingKey}
                  i18nBinding={i18nText}
                  onKeyChange={handleI18nKeyChange}
                  onResolvedTextChange={handleI18nResolvedTextChange}
                  onLocaleChange={handleI18nLocaleChange}
                  localeEditable={i18nText.availableLocales.length > 1}
                  rollbackKey={i18nRollbackSignal?.bindingId === bindingKey ? i18nRollbackSignal.counter : undefined}
                  availableKeys={availableI18nKeys}
                  keyEditable={availableI18nKeys !== undefined && availableI18nKeys.length > 0}
                  canCreateKeys={i18nText.writable}
                  keyBusy={
                    loading ||
                    (!!i18nDispatch && !!writeInProgress) ||
                    (pendingKeyWrite !== null && pendingKeyWrite.elementId === selectedId)
                  }
                />
              );
            })()}
          {/* Style Source Tabs */}
          {canInspectStyles && (
            <StyleSourceTabsSection
              tabs={visibleSourceTabs}
              selectedTabId={selectedSourceTabId}
              onSourceTabChange={setSelectedSourceTabId}
            />
          )}

          {/* State Selector */}
          {projectUIKit === 'tailwind' && (
            <StateSelectorSection currentState={currentState} onStateChange={setCurrentState} />
          )}

          {/* Editing sections - disabled for readonly or during style sync */}
          <div
            className={cn(
              isReadonly && 'opacity-50 pointer-events-none',
              isStyleSyncing && 'pointer-events-none opacity-60',
            )}
          >
            {/* Position Section */}
            {canInspectStyles && (
              <PositionSection
                selectedPosition={selectedPosition}
                posValues={{
                  top: posTop,
                  right: posRight,
                  bottom: posBottom,
                  left: posLeft,
                }}
                projectUIKit={inspectorUIKit}
                onPositionChange={handlePositionChange}
                onPositionValueChange={handlePositionValueChange}
                onPositionKeyDown={handleNumericKeyDown}
              />
            )}

            {projectUIKit === 'none' && !isVSCode && <SetupTailwindButton onSetupClick={handleSetupTailwind} />}

            {/* Margin Section */}
            {canInspectStyles && (
              <MarginSection
                marginTop={marginTop}
                marginRight={marginRight}
                marginBottom={marginBottom}
                marginLeft={marginLeft}
                marginLinked={marginLinked}
                onMarginChange={handleMarginChange}
                onMarginLinkedToggle={() => setMarginLinked(!marginLinked)}
                onNumericKeyDown={handleNumericKeyDown}
              />
            )}

            {/* Layout Section */}
            {canInspectStyles && (
              <LayoutSection
                selectedLayout={selectedLayout}
                width={width}
                height={height}
                gap={gap}
                justifyContent={justifyContent}
                alignItems={alignItems}
                columnGap={columnGap}
                rowGap={rowGap}
                gridJustifyItems={gridJustifyItems}
                gridAlignItems={gridAlignItems}
                gridCols={gridCols}
                gridRows={gridRows}
                paddingTop={paddingTop}
                paddingRight={paddingRight}
                paddingBottom={paddingBottom}
                paddingLeft={paddingLeft}
                clipContent={clipContent}
                projectUIKit={inspectorUIKit}
                isStyleSyncing={isStyleSyncing}
                onLayoutChange={handleLayoutChange}
                onWidthChange={handleWidthChange}
                onHeightChange={handleHeightChange}
                onWidthBlur={handleWidthBlur}
                onHeightBlur={handleHeightBlur}
                onGapChange={setGap}
                onJustifyContentChange={setJustifyContent}
                onAlignItemsChange={setAlignItems}
                onColumnGapChange={setColumnGap}
                onRowGapChange={setRowGap}
                onGridJustifyItemsChange={setGridJustifyItems}
                onGridAlignItemsChange={setGridAlignItems}
                onGridColsChange={setGridCols}
                onGridRowsChange={setGridRows}
                onPaddingChange={handlePaddingChange}
                onClipContentChange={setClipContent}
                onNumericKeyDown={handleNumericKeyDown}
                syncStyleChange={syncStyleChange}
              />
            )}

            {/* Appearance Section */}
            {canInspectStyles && (
              <AppearanceSection
                opacity={opacity}
                borderRadius={borderRadius}
                onOpacityChange={setOpacity}
                onBorderRadiusChange={setBorderRadius}
                onNumericKeyDown={handleNumericKeyDown}
                syncStyleChange={syncStyleChange}
              />
            )}

            {/* Fill Section */}
            {canInspectStyles && (
              <FillSection
                backgroundColor={backgroundColor}
                fillOpacity={fillOpacity}
                backgroundImage={backgroundImage}
                textColor={textColor}
                fontSize={fontSize}
                fillMode={fillMode}
                projectUIKit={inspectorUIKit}
                publicDirExists={publicDirExists}
                activeProjectId={activeProjectId}
                onBackgroundColorChange={setBackgroundColor}
                onFillOpacityChange={setFillOpacity}
                onBackgroundImageChange={setBackgroundImage}
                onTextColorChange={setTextColor}
                onFontSizeChange={setFontSize}
                onFillModeChange={setFillMode}
                syncStyleChange={syncStyleChange}
                onNumericKeyDown={handleNumericKeyDown}
                engine={engine}
                componentPath={componentPath}
                textOpacity={textOpacity}
                onTextOpacityChange={setTextOpacity}
              />
            )}

            {/* Stroke Section */}
            {canInspectStyles && (
              <StrokeSection strokes={strokes} onStrokesChange={setStrokes} syncStyleChange={syncStyleChange} />
            )}

            {/* Effects Section */}
            {projectUIKit === 'tailwind' && (
              <EffectsSection effects={effects} onEffectsChange={setEffects} syncStyleChange={syncStyleChange} />
            )}
          </div>
        </>
      )}

      {/* Component Props — edits typed props of the selected source element via
          engine.updateASTProp (source-AST write path). Mounted as a sibling of the
          style-inspector fragment (gated on parsedStyles) so it still shows for
          component instances whose styles aren't inspectable — matching the original
          standalone <PropsEditor /> callsite (commit 869760ad^), which did NOT depend
          on parsedStyles and was NOT inside the readonly/style-sync wrapper.
          Gated on `engine` presence: PropsEditor calls the throwing useCanvasEngine()
          hook, which requires a CanvasEngineProvider. That provider exists only on the
          SaaS path; the VS Code webview renders RightSidebar without it (hence the
          useCanvasEngineOptional above), so mounting unguarded would crash the sidebar.
          The original monolithic callsite was SaaS-only for the same reason.
          Self-gates further: renders nothing unless the selection has a file path +
          a typed props schema. */}
      {engine &&
        selectedIds.length === 1 &&
        (canvasMode !== 'multi' || activeInstanceId) && (
          // Readonly guard mirrors the style sections (isReadonly → no edits). Unlike
          // them it is NOT blocked during style-sync: prop edits go through a separate
          // AST path and the original standalone callsite was never style-sync-gated.
          <div className={cn(isReadonly && 'opacity-50 pointer-events-none')}>
            <PropsSection />
          </div>
        )}
    </div>
  );
}
