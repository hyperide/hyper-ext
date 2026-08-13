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
  readBrowserElementStyle,
  useElementStyleData,
  useGoToCode,
  useOpenAIChat,
  usePlatformAst,
  usePlatformCanvas,
  usePlatformContext,
} from '@/lib/platform';
import { composeBrowserI18nText } from '@/lib/platform/hooks/composeBrowserI18nText';
import { getSelectedElementRange } from '@/lib/platform/hooks/getSelectedElementRange';
import { useBrowserI18nText } from '@/lib/platform/hooks/useBrowserI18nText';
import { useNodePodLocaleKeys } from '@/lib/platform/hooks/useNodePodLocaleKeys';
import { useNodePodRuntimeStore } from '@/lib/platform/nodepod/nodepodRuntimeStore';
import { createSharedDispatch, useSharedEditorState } from '@/lib/platform/shared-editor-state';
import type { StyleNotAppliedContext } from '@/lib/style-change-detector';
import type { StyleSourceTab } from '@lib/style-read/types';
import {
  describeLandedReason,
  describeLandedSystem,
  describeSkipReason,
  type SkipReasonCode,
} from '@lib/style-write/skip-reason-codes';
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
import { MIXED, mergeStyleData } from './hooks/useBatchStyleData';
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
import {
  AUTO_SOURCE_TAB_ID,
  getExplicitStyleSourceTabId,
  mergeForMultiSelect,
  resolveInspectorStyleSourceTabs,
} from './source-tabs';
import type { EffectItem, LayoutType, PositionType, RightSidebarProps, StrokeItem } from './types';
import { cssToPosition, findNodeById, mapShadowSizeToValues, parseHexWithAlpha } from './utils';

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
  const [i18nRollbackSignal, setI18nRollbackSignal] = useState<{
    bindingId: string;
    counter: number;
  } | null>(null);
  // Keeps keyBusy=true until i18nText.key confirms the new key after a write.
  // Unlike pendingTextKeyRef (a ref used by debounced text-write), this is React state so it
  // triggers re-renders and keeps the combobox disabled during the i18nText re-read window.
  const [pendingKeyWrite, setPendingKeyWrite] = useState<{
    key: string;
    elementId: string;
  } | null>(null);
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
    // Canvas/VS-Code path values (RPC). The browser path merges its own source in below WITHOUT
    // touching useElementStyleData, so the canvas data flow stays byte-identical (HYP-372 M3 P1).
    i18nText: canvasI18nText,
    availableKeys: canvasAvailableI18nKeys,
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

  // ── Browser-mode i18n READ (HYP-372 M3 P1) ──────────────────────────────────────────────────
  // VS Code mode owns i18nText via the styles:response RPC (above). In SaaS browser mode there is
  // no host RPC, so the binding is read from the server scan route and folded in here — keeping
  // useElementStyleData's effects untouched (the byte-identical-canvas-path requirement).
  // The selected element's loc range comes from the engine AST node (the wrapping JSXElement); the
  // scan returns each t(...) call's own loc, and composeBrowserI18nText matches by range containment.
  // getSelectedElementRange handles both selection paths (AST UUID and canvas-click nodeRef) and
  // returns direct-child ranges for the descendant-exclusion. The element's source range is stable
  // across a retarget (same JSXElement) — the post-write re-scan is driven by the hook's refreshKey,
  // so this memo only depends on the selection.
  const selectedElementRange = useMemo(() => getSelectedElementRange(engine, selectedId), [engine, selectedId]);
  // Active runtime: NodePod (serverless) routes i18n retarget/scan to the in-browser OPFS tree and
  // supports brand-new key creation; Docker keeps the server-route behavior (HYP-746).
  const nodePodRuntimeMode = useNodePodRuntimeStore((s) => s.mode);

  const browserI18n = useBrowserI18nText({
    // Pass null (= browser mode, hook activates) only when the engine is present; otherwise pass the
    // canvas adapter so the hook NO-OPS in VS Code mode (usePlatformCanvas is non-null in both modes).
    canvas: engine ? null : canvas,
    filePath: componentPath,
    // The element start loc drives the scan fetch + re-fetch on selection change. We don't rely on
    // the hook's exact-loc `binding` (the element loc != the inner t() call loc); composeBrowserI18nText
    // resolves the active binding by range containment instead.
    sourceLocation: selectedElementRange?.start ?? null,
    library: null,
    // Re-scan after a retarget (source changed, element loc unchanged) and on external refreshes.
    refreshKey: styleRefreshKey + styleVersion,
  });
  const browserI18nText = useMemo(
    () =>
      composeBrowserI18nText({
        result: browserI18n,
        filePath: componentPath,
        elementRange: selectedElementRange,
        activeLocale: i18nActiveLocale ?? 'en',
      }),
    [browserI18n, componentPath, selectedElementRange, i18nActiveLocale],
  );

  // VS Code (no engine) keeps the canvas RPC values verbatim — byte-identical to before this hook
  // existed. Browser/SaaS (engine present) uses the scan-derived source. Discriminating on `engine`
  // (not on canvasI18nText) guarantees the VS Code branch is untouched even when no binding exists.
  const i18nText = engine ? (canvasI18nText ?? browserI18nText) : canvasI18nText;

  // Full locale dictionary keys for the combobox in NodePod mode (HYP-746 item 4) — every key in
  // the active locale, not just the in-file retargetable ones. NO-OPS ([]) outside NodePod, so the
  // Docker/VS-Code candidate sets are untouched.
  const browserI18nBinding = browserI18nText?.kind === 'i18n' ? browserI18nText : null;
  const nodePodLocaleKeys = useNodePodLocaleKeys({
    enabled: !!engine && !!browserI18nBinding,
    library: browserI18nBinding?.library ?? null,
    namespace: browserI18nBinding?.namespace,
    activeLocale: i18nActiveLocale ?? 'en',
    refreshKey: styleRefreshKey + styleVersion,
  });
  // Browser candidate set: prefer the full dictionary (NodePod) when available; always union the
  // in-file retargetable keys so the current binding is offered even if the dict read lags/fails.
  // Memoized so a fresh array identity each render doesn't churn the hooks that depend on it.
  const browserRetargetableKeys = browserI18n.retargetableKeys;
  const availableI18nKeys = useMemo(
    () => (engine ? [...new Set([...nodePodLocaleKeys, ...browserRetargetableKeys])] : canvasAvailableI18nKeys),
    [engine, nodePodLocaleKeys, browserRetargetableKeys, canvasAvailableI18nKeys],
  );
  // NodePod (serverless) supports brand-new key creation end-to-end; gate the create affordance +
  // the createIfMissing flag in the write call on it (HYP-746 item 3).
  const nodePodCanCreate = !!engine && nodePodRuntimeMode === 'nodepod';

  const isMultiSelect = selectedIds.length > 1;
  // UIKit-derived project default for the surfaceless Auto floor (D2 §4.3). Threaded to the batch
  // RPC so a surfaceless element floors to the project system, never a silent inline fallback.
  const projectDefaultCssSystem = useMemo(() => {
    if (inspectorUIKit === 'tailwind') return 'tailwind-v4';
    if (inspectorUIKit === 'tamagui') return 'tamagui';
    return undefined;
  }, [inspectorUIKit]);
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

  // Multi-select source-tab row (D2 §3): an Auto intent chip, plus a concrete override ONLY when
  // every selected element provably shares exactly one concrete system.
  //
  // HONESTY GATE (codex finding): the SaaS browser read does NOT yet expose each element's actual
  // concrete system per element (surfaceDecision/source-owner facts are host-side only — the
  // cross-realm gap tracked in HYP-664). Fabricating a per-element tab set from the project-level
  // UIKit would make EVERY selection look homogeneous and could offer an override that mis-routes
  // for a genuinely heterogeneous selection — the exact "never silently wrong" footgun the design
  // refuses. Until per-element reads land, the multi-select row is Auto-only (D2 §2's explicit
  // fallback). Auto routes per-element edit-in-place and is correct regardless; only the override
  // affordance is withheld. mergeForMultiSelect still gates the override structurally, so when
  // per-element tabs become available this collapses back to the full [Auto, <System>] row.
  const multiSelectSourceTabs = useMemo(() => {
    if (!isMultiSelect) return [] as StyleSourceTab[];
    // No reliable per-element concrete systems in the browser path → feed empty sets → Auto only.
    const perElementTabs = selectedIds.map(() => [] as StyleSourceTab[]);
    return mergeForMultiSelect(perElementTabs);
  }, [isMultiSelect, selectedIds]);

  // Only show the tab row when there's more than one real CSS approach to choose from.
  // Under multi-select the merged row already encodes the hide rule (Auto-only collapses to no row).
  const visibleSourceTabs = useMemo(() => {
    if (isMultiSelect) {
      const hasOverride = multiSelectSourceTabs.some((tab) => tab.id !== AUTO_SOURCE_TAB_ID);
      return hasOverride ? multiSelectSourceTabs : [];
    }
    const nonComputed = sourceTabs.filter((tab) => tab.confidence !== 'computed-only');
    return nonComputed.length <= 1 ? [] : sourceTabs;
  }, [isMultiSelect, multiSelectSourceTabs, sourceTabs]);
  const explicitSourceTabId = useMemo(() => {
    // Under multi-select, the routing target comes from the merged Auto row. Auto carries no
    // explicit target (per-element edit-in-place); a concrete override carries its system-level id.
    if (isMultiSelect) {
      if (selectedSourceTabId === AUTO_SOURCE_TAB_ID) return undefined;
      return multiSelectSourceTabs.some((tab) => tab.id === selectedSourceTabId) ? selectedSourceTabId : undefined;
    }
    if (!sourceTabs.some((tab) => tab.id === selectedSourceTabId)) {
      return undefined;
    }
    return getExplicitStyleSourceTabId(selectedSourceTabId);
  }, [isMultiSelect, multiSelectSourceTabs, sourceTabs, selectedSourceTabId]);

  // Multi-select: default the routing target to the Auto intent chip (D2 §3). Reset to Auto when a
  // stale concrete id from a previous selection no longer exists in the merged row.
  useEffect(() => {
    if (!isMultiSelect) return;
    if (!multiSelectSourceTabs.some((tab) => tab.id === selectedSourceTabId)) {
      setSelectedSourceTabId(AUTO_SOURCE_TAB_ID);
    }
  }, [isMultiSelect, multiSelectSourceTabs, selectedSourceTabId]);

  // Single-select only (gated): when the project has exactly one concrete CSS approach, auto-select
  // it so the user doesn't have to switch away from "Computed". MUST NOT fire under multi-select —
  // that path owns its own 'auto' default above (D2 §3).
  useEffect(() => {
    if (isMultiSelect) return;
    if (!sourceTabs.some((tab) => tab.id === selectedSourceTabId)) {
      setSelectedSourceTabId('computed');
      return;
    }
    const nonComputedTabs = sourceTabs.filter((tab) => tab.confidence !== 'computed-only');
    if (nonComputedTabs.length === 1 && selectedSourceTabId === 'computed') {
      setSelectedSourceTabId(nonComputedTabs[0].id);
    }
  }, [isMultiSelect, sourceTabs, selectedSourceTabId]);

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

  // Effective painted background behind the selected element — the correct contrast pair
  // for its text color. A transparent/unset background resolves up the ancestor chain to
  // the real page color, so contrast is judged against what's actually painted (not the
  // literal `transparent`, which falsely reads as "Bad").
  //
  // State-aware: the resolved effective bg is a base-state snapshot. When a pseudo-state
  // (hover/focus/…) overrides the background, judge the (also state-filtered) text color
  // against THAT variant's background instead — otherwise `hover:bg-white hover:text-white`
  // would be checked against the base bg and falsely pass. Skipped for multi-select.
  const variantBackground = currentState ? effectiveParsed.backgroundColor : undefined;
  const textContrastBackgroundHex = isMultiSelect
    ? undefined
    : (variantBackground ?? parsedStyles?.effectiveBackgroundColor);

  // Multi-select: read each selected element's styles and merge, marking divergent values MIXED.
  // Browser/SaaS only — VS Code multi-select inspector is not wired (no synchronous engine read).
  // styleVersion/styleRefreshKey are intentional re-read triggers: a batch write bumps them so the
  // merged snapshot refreshes from the post-write DOM/AST (mirrors the single-select read path).
  const multiSelectReadTrigger = styleRefreshKey + styleVersion;
  const multiSelectData = useMemo(() => {
    // multiSelectReadTrigger participates only as a re-read signal — voided so it stays in deps.
    void multiSelectReadTrigger;
    if (selectedIds.length <= 1 || !engine || !styleAdapter) return null;

    const allStyles: Partial<ParsedStyles>[] = [];
    const allTexts: string[] = [];
    for (const id of selectedIds) {
      const data = readBrowserElementStyle(id, engine, styleAdapter);
      if (!data?.parsedStyles) continue;
      allTexts.push(data.textContent);

      // Filter by current state variant (same as effectiveParsed for single select)
      if (currentState) {
        const stateKey = currentState.replace(/-([a-z])/g, (_, letter: string) =>
          letter.toUpperCase(),
        ) as keyof ParsedStyles;
        allStyles.push((data.parsedStyles[stateKey] as Partial<ParsedStyles>) || {});
      } else {
        allStyles.push(data.parsedStyles);
      }
    }

    if (allStyles.length === 0) return null;

    const mergedText = allTexts.every((tx) => tx === allTexts[0]) ? allTexts[0] : MIXED;
    return { styles: mergeStyleData(allStyles), mergedText };
  }, [selectedIds, engine, styleAdapter, currentState, multiSelectReadTrigger]);

  const multiSelectMerged = multiSelectData?.styles ?? null;

  // D3 §5 honest skip-banner: authoritative per-element results from the last batch write. Held by
  // element id so the banner names the excluded elements and shows the machine reason.
  const [batchSkips, setBatchSkips] = useState<Array<{ nodeRef: string; reason?: string }>>([]);
  // D2 cascade transparency (CTO 2026-06-11): properties that landed on a lower-priority system than
  // the element's primary one (e.g. an inexpressible prop fell to inline). Drives the "where it
  // landed" badge — these elements were APPLIED, not skipped. The hazard was SILENT inline over a
  // class (two sources of truth), so we surface it. Deduped across elements by property+system+reason.
  const [batchLanded, setBatchLanded] = useState<Array<{ property: string; system: string; reason: string }>>([]);
  const handleBatchResults = useCallback(
    (
      results: Array<{
        nodeRef: string;
        success: boolean;
        status?: string;
        reason?: string;
        landedOn?: Array<{ property: string; system: string; reason: string }>;
      }>,
    ) => {
      // Post-authoritative (D3 §5.1): render the host's returned status, never infer from HTTP 200.
      setBatchSkips(
        results
          .filter((r) => r.status === 'skipped' || r.status === 'failed')
          .map((r) => ({ nodeRef: r.nodeRef, reason: r.reason })),
      );
      const landed = new Map<string, { property: string; system: string; reason: string }>();
      for (const r of results) {
        for (const l of r.landedOn ?? []) {
          landed.set(`${l.property}\0${l.system}\0${l.reason}`, l);
        }
      }
      setBatchLanded([...landed.values()]);
    },
    [],
  );
  // Invalidation (D3 §5.4): a selection change drops a stale banner — its remediation no longer
  // applies to the new selection. Keyed on the selection identity, not length.
  const selectionKey = selectedIds.join('\0');
  // biome-ignore lint/correctness/useExhaustiveDependencies: invalidate strictly on selection change
  useEffect(() => {
    setBatchSkips([]);
    setBatchLanded([]);
  }, [selectionKey]);

  // AI error fallback: when style sync fails, open AI chat with error context
  const handleSyncError = useCallback(
    (styles: Record<string, string>, error: string) => {
      // HYP-301: a failed (transport-error) write leaves the inputs showing values that were
      // never written. Re-read from the source of truth so both populate effects (single-select
      // useElementStyleData and the multi-select merge) revert inputs to the actual baseline —
      // same "always re-read to sync inspector with file state" idiom as the i18n error path.
      setStyleRefreshKey((k) => k + 1);
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
    // Same .map() item index the read path uses — the fast patch must land on
    // the selected item, not the first rendered one (HYP-651).
    itemIndex: selectedItemIndex,
    selectedSourceTabId: explicitSourceTabId,
    projectDefaultCssSystem,
    onBatchResults: handleBatchResults,
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
  const lastI18nElementRef = useRef<{
    elementId: string;
    path: string | null;
  } | null>(null);
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
      // 'mixed' is a multi-select display marker only — never write it as a real layout.
      if (layoutType === 'mixed') {
        return;
      }

      if (!componentPath) {
        console.error('[RightSidebar] No file path found');
        return;
      }

      try {
        setSelectedLayout(layoutType);
        // Layout uses the adapter's dedicated changeLayout path (display + flex-direction
        // together), not the style-key batch endpoint. Apply to every selected element so
        // multi-select isn't silently partial — same file, written sequentially.
        for (const id of selectedIds) {
          await styleAdapter.changeLayout(id, componentPath, layoutType);
        }
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
      pendingTextKeyRef.current = {
        key: newKey,
        elementId: effectiveSelectedId,
      };
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
            // NodePod (serverless) handles a NEW key end-to-end through the retarget transport
            // (locale-JSON-first create THEN JSX), so it stays on the retarget path
            // (skipResourceWrite:true) and signals create via createIfMissing. Other runtimes keep
            // the existing behavior: a new key takes the locale-write path (skipResourceWrite:false).
            skipResourceWrite: nodePodCanCreate ? true : !isNewKey,
            createIfMissing: nodePodCanCreate ? isNewKey : false,
            // Drives the browser-mode retarget's server-side locate (HYP-372); VS Code RPC ignores it.
            bindingLoc: { line: i18nText.sourceLocation.line, column: i18nText.sourceLocation.column },
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
          setI18nRollbackSignal((prev) => ({
            bindingId,
            counter: (prev?.counter ?? 0) + 1,
          }));
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
    [i18nText, astOps, selectedId, i18nDispatch, availableI18nKeys, canvas, nodePodCanCreate],
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
            setI18nRollbackSignal((prev) => ({
              bindingId,
              counter: (prev?.counter ?? 0) + 1,
            }));
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

  // Populate UI state from multi-select merged styles (browser mode). Separate from the
  // single-select effect above (which early-returns when selectedId is null) so the
  // single-select path stays untouched. MIXED values resolve to empty inputs / 'mixed' markers.
  useEffect(() => {
    if (!multiSelectMerged) return;

    /** Resolve MIXED to empty string for display */
    const v = (val: string | undefined | typeof MIXED): string => {
      if (val === MIXED || val === undefined) return '';
      return val;
    };

    setSelectedPosition(
      multiSelectMerged.position === MIXED ? 'mixed' : cssToPosition(v(multiSelectMerged.position) || 'static'),
    );
    setPosTop(v(multiSelectMerged.top));
    setPosRight(v(multiSelectMerged.right));
    setPosBottom(v(multiSelectMerged.bottom));
    setPosLeft(v(multiSelectMerged.left));
    setWidth(v(multiSelectMerged.width));
    setHeight(v(multiSelectMerged.height));
    setMarginTop(v(multiSelectMerged.marginTop));
    setMarginRight(v(multiSelectMerged.marginRight));
    setMarginBottom(v(multiSelectMerged.marginBottom));
    setMarginLeft(v(multiSelectMerged.marginLeft));
    setPaddingTop(v(multiSelectMerged.paddingTop));
    setPaddingRight(v(multiSelectMerged.paddingRight));
    setPaddingBottom(v(multiSelectMerged.paddingBottom));
    setPaddingLeft(v(multiSelectMerged.paddingLeft));
    setGap(v(multiSelectMerged.gap));
    setJustifyContent(v(multiSelectMerged.justifyContent));
    setAlignItems(v(multiSelectMerged.alignItems));
    setColumnGap(v(multiSelectMerged.columnGap));
    setRowGap(v(multiSelectMerged.rowGap));
    setGridJustifyItems(v(multiSelectMerged.justifyItems));
    setGridAlignItems(v(multiSelectMerged.alignItems));
    setGridCols(v(multiSelectMerged.gridTemplateColumns));
    setGridRows(v(multiSelectMerged.gridTemplateRows));
    setOpacity(v(multiSelectMerged.opacity));
    setBorderRadius(v(multiSelectMerged.borderRadius));
    setSelectedLayout(multiSelectMerged.layoutType === MIXED ? 'mixed' : multiSelectMerged.layoutType || 'layout');

    const bgColor = multiSelectMerged.backgroundColor;
    if (bgColor && bgColor !== MIXED) {
      const { color, opacity: parsedFillOpacity } = parseHexWithAlpha(bgColor);
      setBackgroundColor(color);
      setFillOpacity(parsedFillOpacity ?? '100');
    } else {
      setBackgroundColor('');
      setFillOpacity('');
    }

    const txtColor = multiSelectMerged.color;
    if (txtColor && txtColor !== MIXED) {
      const { color } = parseHexWithAlpha(txtColor);
      setTextColor(color);
    } else {
      setTextColor('');
    }

    setBackgroundImage(
      multiSelectMerged.backgroundImage && multiSelectMerged.backgroundImage !== MIXED
        ? multiSelectMerged.backgroundImage
        : null,
    );
    // clipContent is a boolean control — mixed overflow shows as unclipped (false).
    setClipContent(
      multiSelectMerged.overflow !== MIXED &&
        (multiSelectMerged.overflow === 'hidden' ||
          multiSelectMerged.overflow === 'scroll' ||
          multiSelectMerged.overflow === 'auto'),
    );

    // Update strokes from merged styles — MIXED means "border exists but differs"
    const rawBw = multiSelectMerged.borderWidth;
    const rawBtw = multiSelectMerged.borderTopWidth;
    const rawBrw = multiSelectMerged.borderRightWidth;
    const rawBbw = multiSelectMerged.borderBottomWidth;
    const rawBlw = multiSelectMerged.borderLeftWidth;

    const hasBorder = (val: string | undefined | typeof MIXED) =>
      val === MIXED || (val !== undefined && val !== '0' && val !== '0px' && val !== '');

    const hasAnyBorder =
      hasBorder(rawBw) || hasBorder(rawBtw) || hasBorder(rawBrw) || hasBorder(rawBbw) || hasBorder(rawBlw);

    if (hasAnyBorder) {
      const bw = v(rawBw);
      const btw = v(rawBtw);
      const brw = v(rawBrw);
      const bbw = v(rawBbw);
      const blw = v(rawBlw);
      const borderWidth = bw || btw || brw || bbw || blw || '1px';
      setStrokes([
        {
          id: '1',
          visible: true,
          color: v(multiSelectMerged.borderColor) || '#000000',
          opacity: '100',
          width: borderWidth.replace('px', ''),
          style: (v(multiSelectMerged.borderStyle) as StrokeItem['style']) || 'solid',
          sides: {
            top: !!rawBw || !!rawBtw,
            right: !!rawBw || !!rawBrw,
            bottom: !!rawBw || !!rawBbw,
            left: !!rawBw || !!rawBlw,
          },
        },
      ]);
    } else {
      setStrokes([]);
    }

    // Update effects from merged styles
    const mergedEffects: EffectItem[] = [];
    const shadowVal = v(multiSelectMerged.shadow);
    if (shadowVal && shadowVal !== 'none') {
      const hasArbitraryValues =
        multiSelectMerged.shadowX ||
        multiSelectMerged.shadowY ||
        multiSelectMerged.shadowBlur ||
        multiSelectMerged.shadowSpread;
      const isPreset = !hasArbitraryValues && ['sm', 'default', 'md', 'lg', 'xl', '2xl', 'inner'].includes(shadowVal);

      const values = hasArbitraryValues
        ? {
            x: v(multiSelectMerged.shadowX),
            y: v(multiSelectMerged.shadowY),
            blur: v(multiSelectMerged.shadowBlur),
            spread: v(multiSelectMerged.shadowSpread),
          }
        : mapShadowSizeToValues(
            shadowVal === 'inner' ? 'default' : shadowVal,
            shadowVal === 'inner' ? 'inner-shadow' : 'drop-shadow',
          );

      let shadowColor = '#000000';
      let shadowOpacity = '100';
      const sc = v(multiSelectMerged.shadowColor);
      if (sc?.match(/^#[0-9a-fA-F]{8}$/)) {
        shadowColor = sc.slice(0, 7);
        const alpha = Number.parseInt(sc.slice(7, 9), 16);
        shadowOpacity = Math.round((alpha / 255) * 100).toString();
      } else if (sc) {
        shadowColor = sc;
        shadowOpacity = v(multiSelectMerged.shadowOpacity) || '100';
      }

      mergedEffects.push({
        id: '1',
        visible: true,
        type: shadowVal === 'inner' ? 'inner-shadow' : 'drop-shadow',
        x: values.x,
        y: values.y,
        blur: values.blur,
        spread: values.spread,
        color: shadowColor,
        opacity: shadowOpacity,
        preset: isPreset ? shadowVal : undefined,
      });
    }
    const blurVal = v(multiSelectMerged.blur);
    if (blurVal && blurVal !== 'none') {
      mergedEffects.push({
        id: '2',
        visible: true,
        type: 'blur',
        value: blurVal,
        color: '#000000',
        opacity: '100',
      });
    }
    setEffects(mergedEffects);

    const mergedText = multiSelectData?.mergedText;
    setTextContent(mergedText === MIXED ? '' : mergedText || '');
    setIsTextFromProps(false);
  }, [multiSelectMerged, multiSelectData]);

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
        (componentGroups.atomGroups.length > 0 ||
          componentGroups.compositeGroups.length > 0 ||
          componentGroups.pageGroups.length > 0) && (
          <ComponentQuickList
            atomGroups={componentGroups.atomGroups}
            compositeGroups={componentGroups.compositeGroups}
            pageGroups={componentGroups.pageGroups}
            onComponentClick={onComponentClick}
          />
        )}

      {/* Multi-select with no readable styles (e.g. VS Code mode, or nothing resolved) */}
      {selectedIds.length > 1 && !multiSelectMerged && (
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground mb-2">{selectedIds.length} elements selected</p>
          <p className="text-xs text-muted-foreground">Multi-select editing is unavailable for this selection</p>
        </div>
      )}

      {/* Loading (VS Code RPC) — only on first load, not on element switch */}
      {selectedIds.length === 1 && loading && !parsedStyles && (
        <div className="px-4 py-8 text-center">
          <p className="text-xs text-muted-foreground">Reading styles...</p>
        </div>
      )}

      {((selectedIds.length === 1 && parsedStyles && (canvasMode !== 'multi' || activeInstanceId)) ||
        (selectedIds.length > 1 && multiSelectMerged)) && (
        <>
          {/* Frame type + "Go to main component" (HYP-563, Figma-style affordance) */}
          <div className="w-full px-4 py-3 border-b border-border overflow-hidden flex items-center gap-2">
            <span
              data-testid={TID.inspector.componentName}
              className="text-sm font-semibold text-foreground truncate flex-1 min-w-0"
            >
              {selectedIds.length > 1 ? `${selectedIds.length} elements selected` : getFrameType()}
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
                    disabled={isReadonly || selectedIds.length > 1}
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
                  {activeInstanceId ? ' To edit instance props click the badge.' : ' Editing may break jsx'}
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
                  // NodePod (serverless) can create a brand-new key end-to-end (locale-JSON-first
                  // then JSX) via the retarget transport — so the combobox offers a create path
                  // there. Other runtimes keep the binding's own writable flag (HYP-746 item 3).
                  canCreateKeys={i18nText.writable || nodePodCanCreate}
                  keyBusy={
                    loading ||
                    (!!i18nDispatch && !!writeInProgress) ||
                    (pendingKeyWrite !== null && pendingKeyWrite.elementId === selectedId)
                  }
                />
              );
            })()}
          {/* D3 §5 honest skip-banner: muted, persistent, names the excluded elements + reason.
              Post-authoritative — driven by the host's per-element batch results, not a client guess. */}
          {isMultiSelect && batchSkips.length > 0 && (
            <div
              data-testid="inspector-multiselect-skip-banner"
              className="w-full px-4 py-2 border-b border-border bg-muted/50 text-[11px] text-muted-foreground"
              role="status"
            >
              <span className="font-medium text-foreground">
                {batchSkips.length} of {selectedIds.length} selected {selectedIds.length === 1 ? 'element' : 'elements'}{' '}
                couldn't be styled here
              </span>
              {' — '}
              {[
                ...new Set(
                  batchSkips.map((s) => describeSkipReason((s.reason as SkipReasonCode) ?? 'NO_WRITABLE_TARGET')),
                ),
              ].join('; ')}
              {'.'}
            </div>
          )}

          {/* D2 cascade "where it landed" badge (CTO 2026-06-11): the write SUCCEEDED, but one or more
              properties landed on a lower-priority system than the element's primary one — surfaced so
              an inline-over-a-class never lands silently (two sources of truth). Transparency, not a skip. */}
          {batchLanded.length > 0 && (
            <div
              data-testid="inspector-style-landed-badge"
              className="w-full px-4 py-2 border-b border-border bg-muted/30 text-[11px] text-muted-foreground"
              role="status"
            >
              {batchLanded
                .map((l) => `${l.property} → ${describeLandedSystem(l.system)}${describeLandedReason(l.reason)}`)
                .join('; ')}
              {'.'}
            </div>
          )}

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
                textContrastBackgroundHex={textContrastBackgroundHex}
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
            <PropsSection projectUIKit={inspectorUIKit} componentPath={componentPath} />
          </div>
        )}
    </div>
  );
}
