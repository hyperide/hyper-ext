/**
 * Right Panel App — thin wrapper for VS Code Secondary Side Bar.
 *
 * Sets up PlatformProvider + SharedEditorState sync,
 * then renders the shared RightSidebar component.
 * Handles component insertion UI entirely on the ext side.
 *
 * NudgeHUD (D1-A): the inspector is the realm that owns the numeric inputs which trigger the
 * HUD, so the HUD is rendered HERE (not in the canvas webview). A per-webview NudgeStatePort
 * keeps the store local to this realm — no cross-realm machinery. See
 * docs/specs/2026-06-04-crossrealm-webview-bridge.md.
 */

import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { isTrustedMessageOrigin } from '@shared/utils/trusted-message-origin';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ComponentNavigatorPanel } from '@/components/FloatingPanels';
import { NudgeHUD } from '@/components/NudgeHUD/NudgeHUD';
import RightSidebar from '@/components/RightSidebar/RightSidebar';
import { createNudgeStatePort, NudgeStateProvider } from '@/lib/nudge';
import { PlatformProvider, usePlatformAst, usePlatformCanvas } from '@/lib/platform';
import { useSharedEditorState, useSharedEditorStateSync } from '@/lib/platform/shared-editor-state';
import type { ComponentGroup } from '../../../../lib/component-scanner/types';
import type { SharedEditorState } from '../../../../lib/types';
import { TID } from '../shared/data-testid-map';
import type { ProjectCapabilities } from '../types';

interface ComponentGroupsData {
  atomGroups: ComponentGroup[];
  compositeGroups: ComponentGroup[];
}

export function RightPanelApp() {
  return (
    <PlatformProvider>
      <RightPanelContent />
    </PlatformProvider>
  );
}

function RightPanelContent() {
  const canvas = usePlatformCanvas();
  const astOps = usePlatformAst();
  // RightPanelContent mounts once; canvas is a stable singleton — no duplicate subscriptions
  useSharedEditorStateSync(canvas);

  // Notify extension host when an input/textarea in this panel gains/loses focus,
  // so the `hypercanvas.rightPanelInputFocused` context variable can be set correctly.
  // This prevents canvas keybindings (Delete, Backspace, Enter, Tab, Escape) from
  // firing while the user is typing in an inspector field.
  useEffect(() => {
    const isInputEl = (target: EventTarget | null): boolean =>
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

    const handleFocusIn = (e: FocusEvent) => {
      if (isInputEl(e.target)) {
        canvas.sendEvent({ type: 'panel:inputFocus', active: true });
      }
    };

    const handleFocusOut = (e: FocusEvent) => {
      if (!isInputEl(e.target)) return;
      // Skip if focus is moving to another input within the same panel
      if (isInputEl(e.relatedTarget)) return;
      canvas.sendEvent({ type: 'panel:inputFocus', active: false });
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, [canvas]);

  const projectUIKit = useSharedEditorState((s) => s.projectUIKit) ?? 'none';
  const componentPath = useSharedEditorState((s) => s.currentComponent?.path);
  const insertTargetId = useSharedEditorState((s) => s.insertTargetId);

  // One in-realm NudgeStatePort per webview mount — the inspector's numeric inputs and the
  // HUD share it. D1-A: no cross-realm sync, the store lives in this webview only.
  const nudgePort = useMemo(() => createNudgeStatePort(), []);

  const [componentGroups, setComponentGroups] = useState<ComponentGroupsData | null>(null);
  const [explorerVisible, setExplorerVisible] = useState(false);
  const [insertPanelExpanded, setInsertPanelExpanded] = useState(false);
  const [projectCapabilities, setProjectCapabilities] = useState<ProjectCapabilities | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // Reject untrusted frames before dispatching (js/missing-origin-check).
      if (!isTrustedMessageOrigin(event)) return;
      const data = event.data;
      if (!data?.type) return;

      if (data.type === 'inspector:componentGroups') {
        setComponentGroups({
          atomGroups: data.atomGroups ?? [],
          compositeGroups: data.compositeGroups ?? [],
        });
      }
      if (data.type === 'inspector:explorerVisible') {
        setExplorerVisible(!!data.visible);
      }
      if (data.type === 'projectCapabilities') {
        setProjectCapabilities(data.capabilities ?? null);
      }
    };
    window.addEventListener('message', handler); // nosemgrep: insufficient-postmessage-origin-validation -- VS Code webview, extension-controlled messages only
    return () => window.removeEventListener('message', handler);
  }, []);

  // canvas from usePlatformCanvas() is a stable singleton ref — listing it in
  // deps is correct but does not cause re-renders (satisfies exhaustive-deps).
  const handleComponentClick = useCallback(
    (name: string, path: string) => {
      canvas.sendEvent({ type: 'component:open', name, path });
    },
    [canvas],
  );

  // ── Component insertion ──────────────────────────────────────

  // Both conditions required: show navigator only when a target exists AND groups are loaded
  const showInsertPanel = !!insertTargetId && !!componentGroups;

  const handleInsertComponent = useCallback(
    async (componentType: string, componentFilePath?: string) => {
      if (!componentPath || !insertTargetId) return;
      await astOps.insertElement({
        filePath: componentPath,
        parentId: insertTargetId,
        componentType,
        props: {},
        componentFilePath,
      });
      const patch: Partial<SharedEditorState> = { insertTargetId: null };
      canvas.sendEvent({ type: 'state:update', patch });
    },
    [astOps, canvas, componentPath, insertTargetId],
  );

  const handleCloseInsertPanel = useCallback(() => {
    const patch: Partial<SharedEditorState> = { insertTargetId: null };
    canvas.sendEvent({ type: 'state:update', patch });
  }, [canvas]);

  return (
    <NudgeStateProvider port={nudgePort}>
      <div data-testid={TID.inspector.root} className="relative flex flex-col h-full overflow-hidden">
        <div className={showInsertPanel ? 'flex-1 min-h-0 overflow-y-auto' : 'h-full overflow-y-auto'}>
          <RightSidebar
            projectUIKit={projectUIKit}
            componentGroups={componentGroups}
            explorerVisible={explorerVisible}
            onComponentClick={handleComponentClick}
            readonly={projectCapabilities?.readonly === true}
          />
        </div>
        {/* HUD overlay — sibling of the scroll container so overflow-y-auto can't clip it.
            Inspector layout: left-anchored, fit-to-content, wraps within the panel instead of the
            SaaS nowrap strip that clips at the ~300px edge. Opaque bg so the Border-section inputs
            underneath don't bleed through (the shared default is bg-black/90, translucent). */}
        <NudgeHUD
          adapter={projectUIKit}
          className="absolute bottom-3 left-2 max-w-[calc(100%-1rem)] flex-wrap gap-y-1 bg-neutral-900 [&>div]:flex-wrap"
        />
        {showInsertPanel && (
          <div
            className="min-h-0 flex flex-col border-t border-border transition-[height] ease-in-out"
            style={{ height: insertPanelExpanded ? '66.67%' : '33.33%', transitionDuration: '233ms' }}
          >
            <div className="flex-1 min-h-0 overflow-y-auto">
              <ComponentNavigatorPanel
                variant="inline"
                componentGroups={componentGroups}
                onComponentClick={handleInsertComponent}
                onClose={handleCloseInsertPanel}
                headerExtra={
                  <button
                    type="button"
                    className="hover:bg-muted rounded p-0.5 transition-colors"
                    onClick={() => setInsertPanelExpanded((v) => !v)}
                  >
                    {insertPanelExpanded ? (
                      <IconChevronDown className="w-4 h-4 text-muted-foreground hover:text-foreground" stroke={1.5} />
                    ) : (
                      <IconChevronUp className="w-4 h-4 text-muted-foreground hover:text-foreground" stroke={1.5} />
                    )}
                  </button>
                }
              />
            </div>
          </div>
        )}
      </div>
    </NudgeStateProvider>
  );
}
