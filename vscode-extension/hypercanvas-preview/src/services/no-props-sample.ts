/**
 * @file Decides when the extension should inject in-memory generated sample props.
 *
 * Accessed via: VS Code extension component selection flow before preview registration
 */

import type { EnsureSampleResult } from '@lib/preview-generator';
import { buildContainerSampleJsxBody } from '@lib/preview-generator/sample-scaffold';
import { scanSampleExports } from '@lib/preview-generator/scanner';

export interface PrimitiveRenderableSampleInfo {
  hasAuthoredSampleDefault: boolean;
  hasSyntheticSampleDefault: boolean;
}

/**
 * HYP-915 — cheaply determine whether a `components/ui/*` primitive already has a way to render
 * without in-memory generated props: an authored `SampleDefault` export, or a synthesizable
 * COMPOUND scaffold (sibling sub-exports like `CardHeader`/`CardContent`, same detection
 * `preview-file-manager.ts` uses to build `syntheticSampleDefault`). Called before
 * `previewManager.ensureComponent` runs (so the in-memory injection decision below doesn't have to
 * wait on the full registry rebuild) — duplicates only the cheap detection, not the registry logic.
 */
export function getPrimitiveRenderableSampleInfo(
  sourceCode: string,
  componentName: string,
): PrimitiveRenderableSampleInfo {
  let hasAuthoredSampleDefault = false;
  try {
    hasAuthoredSampleDefault = scanSampleExports(sourceCode).includes('SampleDefault');
  } catch {
    hasAuthoredSampleDefault = false;
  }

  if (hasAuthoredSampleDefault) {
    return { hasAuthoredSampleDefault: true, hasSyntheticSampleDefault: false };
  }

  let hasSyntheticSampleDefault = false;
  try {
    hasSyntheticSampleDefault = buildContainerSampleJsxBody({ sourceCode, componentName }) !== null;
  } catch {
    hasSyntheticSampleDefault = false;
  }

  return { hasAuthoredSampleDefault, hasSyntheticSampleDefault };
}

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

/**
 * HYP-915 — same "try first" decision as {@link shouldInjectGeneratedProps}, extended to cover
 * `components/ui/*` primitives. A primitive that already has an authored `SampleDefault` or a
 * synthesized COMPOUND scaffold (`buildContainerSampleJsxBody` found sibling sub-exports, e.g.
 * `CardHeader`/`CardContent`) renders through that richer path already — injecting flat generated
 * props on top would be redundant at best. Only a primitive with NEITHER falls through to the same
 * in-memory generated-props injection non-primitive components already use.
 */
export function shouldInjectGeneratedPropsForSelection(
  ensureResult: EnsureSampleResult,
  props: readonly unknown[] | null | undefined,
  primitiveSampleInfo?: PrimitiveRenderableSampleInfo,
): boolean {
  if (primitiveSampleInfo?.hasAuthoredSampleDefault || primitiveSampleInfo?.hasSyntheticSampleDefault) {
    return false;
  }
  return shouldInjectGeneratedProps(ensureResult, props);
}
