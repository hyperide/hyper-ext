/**
 * @file Decides when the extension should inject in-memory generated sample props.
 *
 * Accessed via: VS Code extension component selection flow before preview registration
 */

import type { EnsureSampleResult } from '@lib/preview-generator';

/**
 * Feature #210 — decide whether to compute + inject in-memory generated sample
 * props for a freshly selected component.
 *
 * Returns true when the component has NO authored SampleDefault yet (so the
 * preview would otherwise render it propless and crash on required props) AND its
 * prop schema was parsed successfully. "Try first, then ask": inject best-effort
 * values, attempt a real render, and only fall back to the "requires props"
 * overlay when that still fails.
 *
 * NOTE: intentionally NOT gated on `hypercanvas.preview.autoSampleGeneration`.
 * That setting exists to stop the AI/scaffold path from writing into the
 * component SOURCE file (which `git checkout` between E2E specs would revert).
 * In-memory injection never touches source, so the gate does not apply.
 *
 * `props` being null/undefined means the component couldn't be parsed — skip.
 */
export function shouldInjectGeneratedProps(
  ensureResult: EnsureSampleResult,
  props: readonly unknown[] | null | undefined,
): boolean {
  return !ensureResult.exists && Array.isArray(props);
}
