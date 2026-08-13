/**
 * @file Auto-create an empty sample when the preview error is caused solely by a
 *   component that truly has no props (HYP-649 recovery pipeline).
 *
 * Accessed via: PreviewPanelApp — called alongside the shared ComponentErrorOverlay.
 * Why extension-only: the auto-create flow writes a sample file through the VS Code
 *   extension host (errorBoundary:createSample → FileIO). SaaS has a separate
 *   sample-creation path and does not consume this hook.
 */

import { shouldAutoCreateEmptySampleFromError } from '@shared/components/overlays/extract-props-from-error';
import { useEffect, useRef } from 'react';
import type { SimplePropInfo } from '@shared/components/overlays';

interface AutoCreateInput {
  componentPath: string;
  error: string | null | undefined;
  errorSeq?: number;
  propsSchema: SimplePropInfo[] | null | undefined;
  /**
   * When true, the component file already contains a `SampleDefault` export.
   * Auto-create is suppressed — we must not overwrite an existing (possibly broken)
   * sample for generic runtime errors (HYP-648 P1 fix).
   */
  hasSample?: boolean;
}

/**
 * Pure decision: returns the dedup key to fire `onCreateSample('SampleDefault')`
 * under, or `null` to NOT fire. We fire at most once per `(componentPath, errorSeq)`
 * pair, and only when the error has no prop hints and `propsSchema` has resolved to
 * an empty array. `prevKey` is the last key we fired under (so re-renders with the
 * same error don't re-fire, but a fresh error — new errorSeq — does).
 */
export function nextAutoCreateKey(prevKey: string | null, input: AutoCreateInput): string | null {
  const { componentPath, error, errorSeq, propsSchema, hasSample } = input;
  if (!error) return null;
  // Do not auto-create when the component already has a SampleDefault — it may be
  // throwing a real runtime error (missing provider, external dep) that is unrelated
  // to a missing sample. Overwriting it would silently destroy the user's sample.
  if (hasSample) return null;
  if (!shouldAutoCreateEmptySampleFromError(propsSchema, error)) return null;

  const key = `${componentPath}:${errorSeq ?? 0}`;
  return key === prevKey ? null : key;
}

/**
 * Fires `onCreateSample('SampleDefault')` exactly once per `(componentPath, errorSeq)`
 * pair when the overlay should skip the PropsForm (see `nextAutoCreateKey`). This
 * skips the overlay entirely for the common "component takes no props, just needs a
 * sample" case — the created sample re-renders and the error clears via retryRender.
 */
export function useAutoCreateEmptySample(
  input: AutoCreateInput & { onCreateSample: (sampleName: string, propValues?: Record<string, unknown>) => void },
): void {
  const { onCreateSample, ...decision } = input;
  const { componentPath, error, errorSeq, propsSchema, hasSample } = decision;
  const autoCreateKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const key = nextAutoCreateKey(autoCreateKeyRef.current, { componentPath, error, errorSeq, propsSchema, hasSample });
    if (key === null) return;
    autoCreateKeyRef.current = key;
    onCreateSample('SampleDefault');
  }, [componentPath, error, errorSeq, propsSchema, hasSample, onCreateSample]);
}
