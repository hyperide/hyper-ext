/**
 * Disconnected-state screen for the VS Code preview panel.
 *
 * Accessed via: PreviewPanelApp — rendered when the dev server stops after a
 * successful connection (shellScreen === 'disconnected'). Thin wrapper over
 * the shared ConnectionErrorOverlay (HYP-647): the message replaces the old
 * ReconnectingBanner, the action button replaces DisconnectedPreviewScreen's
 * inline Start Dev Server button.
 *
 * Assumptions:
 *   - The root testid stays `hyper-preview-reconnecting` — pinned by
 *     ext-test-projects visual-regression.spec.ts ("reconnecting banner when
 *     connection is lost"). The PNG baseline there needs a regen since the
 *     banner became a full-area overlay.
 *   - The start button keeps TID.preview.startServerButton so dev-server
 *     lifecycle e2e flows find it in the disconnected state too.
 */

import { ConnectionErrorOverlay } from '@shared/components/overlays';
import { TID } from '../shared/data-testid-map';

export function DisconnectedScreen({ onStart }: { onStart: () => void }) {
  return (
    <ConnectionErrorOverlay
      testId="hyper-preview-reconnecting"
      message="Dev server disconnected"
      action={{ label: 'Start Dev Server', onClick: onStart, testId: TID.preview.startServerButton }}
    />
  );
}
