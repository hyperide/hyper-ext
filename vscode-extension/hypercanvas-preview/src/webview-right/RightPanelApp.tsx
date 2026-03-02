/**
 * Right Panel App — thin wrapper for VS Code Secondary Side Bar.
 *
 * Sets up PlatformProvider + SharedEditorState sync,
 * then renders the shared RightSidebar component.
 * Handles component insertion UI entirely on the ext side.
 */

import { useCallback, useEffect, useState } from 'react';
import { ComponentNavigatorPanel } from '@/components/FloatingPanels';
import RightSidebar from '@/components/RightSidebar/RightSidebar';
import { PlatformProvider, usePlatformAst, usePlatformCanvas } from '@/lib/platform';
import { useSharedEditorState, useSharedEditorStateSync } from '@/lib/platform/shared-editor-state';
import type { ComponentGroup } from '../../../../lib/component-scanner/types';
import type { SharedEditorState } from '../../../../lib/types';

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

  const projectUIKit = useSharedEditorState((s) => s.projectUIKit) ?? 'none';
  const componentPath = useSharedEditorState((s) => s.componentPath);
  const insertTargetId = useSharedEditorState((s) => s.insertTargetId);

  const [componentGroups, setComponentGroups] = useState<ComponentGroupsData | null>(null);
  const [explorerVisible, setExplorerVisible] = useState(false);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
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
    <>
      {showInsertPanel && (
        <ComponentNavigatorPanel
          variant="inline"
          componentGroups={componentGroups}
          onComponentClick={handleInsertComponent}
          onClose={handleCloseInsertPanel}
        />
      )}
      {/* Tailwind 'hidden' preserves RightSidebar state while insert panel is shown */}
      <div className={showInsertPanel ? 'hidden' : undefined}>
        <RightSidebar
          projectUIKit={projectUIKit}
          componentGroups={componentGroups}
          explorerVisible={explorerVisible}
          onComponentClick={handleComponentClick}
        />
      </div>
    </>
  );
}
