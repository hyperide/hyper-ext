/**
 * @file Decides when the extension should create a deterministic SampleDefault scaffold for no-props components.
 *
 * Accessed via: VS Code extension component selection flow before preview registration
 * Assumptions: `props` is `[]` only when the component was parsed successfully and truly has no props
 */

import type { EnsureSampleResult } from '@lib/preview-generator';

export function shouldCreateNoPropsSample(
  ensureResult: EnsureSampleResult,
  props: readonly unknown[] | null | undefined,
): boolean {
  return !ensureResult.exists && Array.isArray(props) && props.length === 0;
}
