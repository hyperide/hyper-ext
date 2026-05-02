/**
 * @file Decides when the extension should create a deterministic SampleDefault scaffold for no-props components.
 *
 * Accessed via: VS Code extension component selection flow before preview registration
 * Assumptions: `props` is `[]` only when the component was parsed successfully and truly has no props
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

  return !ensureResult.exists && Array.isArray(props) && props.length === 0;
}
