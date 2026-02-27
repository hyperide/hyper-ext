/**
 * Right Panel App — thin wrapper for VS Code Secondary Side Bar.
 *
 * Sets up PlatformProvider + SharedEditorState sync,
 * then renders the shared RightSidebar component.
 */

import { useCallback, useEffect, useState } from 'react';
import RightSidebar from '@/components/RightSidebar/RightSidebar';
import { PlatformProvider, usePlatformCanvas } from '@/lib/platform';
import { useSharedEditorState, useSharedEditorStateSync } from '@/lib/platform/shared-editor-state';
import type { ComponentGroup } from '../../../../lib/component-scanner/types';

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
  useSharedEditorStateSync(canvas);

  const projectUIKit = useSharedEditorState((s) => s.projectUIKit) ?? 'none';

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

  return (
    <RightSidebar
      projectUIKit={projectUIKit}
      componentGroups={componentGroups}
      explorerVisible={explorerVisible}
      onComponentClick={handleComponentClick}
    />
  );
}
