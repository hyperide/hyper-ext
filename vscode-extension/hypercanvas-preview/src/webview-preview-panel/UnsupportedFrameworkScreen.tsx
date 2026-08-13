/**
 * Framework-compatibility screen for the VS Code preview panel.
 *
 * Accessed via: PreviewPanelApp — rendered when the project has no supported
 * bundler/framework (projectError.type === 'framework'). Replaces the old
 * "unsupported project type" warning toast (HYP-442): the toast was redundant
 * with this authoritative compatibility table.
 *
 * Since HYP-647 this is a thin wrapper over the shared PreviewSetupOverlay's
 * `unsupported` variant — same FRAMEWORK_SUPPORT source of truth, same table
 * markup as the SaaS overlay. The wrapper exists to pin the extension-specific
 * contract: the e2e-pinned root testid (framework-compat-screen.spec.ts) and
 * the detection-specific message from the extension host.
 *
 * `onAutoFix` (HYP-917) is threaded straight through to the shared overlay — the caller
 * (PreviewPanelApp) wires it to `canvas.sendEvent({ type: 'ai:openChat', prompt })`, the
 * same already-wired mechanism the diagnostics panel and SaaS editor use for their own
 * Auto Fix buttons. Even when the extension genuinely cannot render this project, the
 * user still gets a standard path to ask the AI agent instead of a dead end.
 */

import { PreviewSetupOverlay } from '@shared/components/overlays';
import { FRAMEWORK_SUPPORT } from '@shared/framework-support';
import { TID } from '@shared/data-testid-map';

export function UnsupportedFrameworkScreen({
  message,
  onAutoFix,
}: {
  message: string;
  onAutoFix?: (prompt: string) => void;
}) {
  return (
    <PreviewSetupOverlay
      status="unsupported"
      description={message}
      frameworkSupport={FRAMEWORK_SUPPORT}
      testId={TID.preview.unsupportedFrameworkRoot}
      onAutoFix={onAutoFix}
    />
  );
}
