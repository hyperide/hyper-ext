/**
 * @file Decides when the extension should create a deterministic SampleDefault scaffold.
 *
 * Accessed via: VS Code extension component selection flow before preview registration
 */

import type { EnsureSampleResult } from '@lib/preview-generator';
import * as vscode from 'vscode';

export function shouldCreateNoPropsSample(
  ensureResult: EnsureSampleResult,
  props: readonly unknown[] | null | undefined,
): boolean {
  // Respect the user-facing setting so E2E harnesses can disable the
  // source-file mutation — git checkout between specs would drop the
  // export and trigger Vite "Could not Fast Refresh" + failed reload.
  const enabled = vscode.workspace.getConfiguration('hypercanvas.preview').get<boolean>('autoSampleGeneration', true);
  if (!enabled) return false;

  // Create a minimal no-props scaffold whenever no sample was generated — regardless of
  // whether the component declares props. If the component renders without them, great.
  // If it crashes, the ErrorBoundary catches it and ComponentErrorOverlay shows instead.
  // This implements "try first, then ask" rather than "refuse to try".
  // `props` being null/undefined means the component couldn't be parsed — skip in that case.
  return !ensureResult.exists && Array.isArray(props);
}
