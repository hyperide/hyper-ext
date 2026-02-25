/**
 * Left Panel App — thin wrapper for shared LeftSidebar component.
 *
 * Provides PlatformProvider + SharedEditorState sync,
 * then renders the shared LeftSidebar used by both SaaS and VS Code.
 */

import { PlatformProvider, usePlatformCanvas } from '@/lib/platform';
import { useSharedEditorStateSync } from '@/lib/platform/shared-editor-state';
import LeftSidebar from '@/components/LeftSidebar';

export function LeftPanelApp() {
  return (
    <PlatformProvider>
      <LeftPanelContent />
    </PlatformProvider>
  );
}

function LeftPanelContent() {
  const canvas = usePlatformCanvas();
  useSharedEditorStateSync(canvas);

  return <LeftSidebar />;
}
