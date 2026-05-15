/**
 * @file Regression test: UI primitives skip ensureSample but still register via ensureComponent.
 *
 * Accessed via: bun test vscode-extension/hypercanvas-preview/src/__tests__/extension-ui-primitive-wiring.test.ts
 *
 * Assumptions:
 * - For shadcn-style UI primitives (`client/components/ui/<name>.tsx`), the extension
 *   must NOT mutate the source file with a `SampleDefault` export — the synthetic scaffold
 *   produced by `preview-file-manager.buildEntry` covers rendering inside __canvas_preview__.tsx.
 * - For non-primitive components, the original ensureSample + ensureDefaultSampleForNoProps
 *   path keeps working.
 * - `ensureComponent` runs in BOTH cases so the registry stays current.
 *
 * Background (Task 3 of HYP — auto-sample for shadcn/ui):
 * Previously extension.ts:743 had a hard early-return for any path matched by
 * `isUiPrimitive(...)` — it called `setComponentParam(...)` and bailed. This skipped
 * `ensureComponent`, so even after Task 2 wired `syntheticSampleDefault` into
 * preview-file-manager, the synthetic scaffold never landed in the registry.
 *
 * The fix: rename `if (isUiPrimitive(...)) { return; }` into a flag, then gate only the
 * source-mutation paths on `!isPrimitive`. ensureComponent + onComponentSelected continue
 * to run for primitives.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { isUiPrimitive } from '../../../../lib/preview-generator/generator';

/**
 * Minimal model of the relevant slice of extension.ts onChange handler.
 * Mirrors the new conditional structure: source-mutation paths gated on `!isPrimitive`,
 * registry/mode-manager paths always run.
 */
async function runComponentSelectedSlice(args: {
  relativePath: string;
  autoSampleEnabled: boolean;
  ensureSample: ReturnType<typeof mock>;
  ensureDefaultSampleForNoProps: ReturnType<typeof mock>;
  ensureComponent: ReturnType<typeof mock>;
  onComponentSelected: ReturnType<typeof mock>;
  setComponentParam: ReturnType<typeof mock>;
  shouldCreateNoPropsSample: boolean;
}) {
  const isPrimitive = isUiPrimitive(args.relativePath);

  const sampleResult =
    args.autoSampleEnabled && !isPrimitive ? await args.ensureSample() : { generated: false, exists: false };

  if (!isPrimitive && args.shouldCreateNoPropsSample) {
    await args.ensureDefaultSampleForNoProps();
  }

  await args.ensureComponent([args.relativePath]);
  await args.onComponentSelected();
  args.setComponentParam(args.relativePath);

  return { isPrimitive, sampleResult };
}

describe('extension UI-primitive selection wiring', () => {
  let ensureSample: ReturnType<typeof mock>;
  let ensureDefaultSampleForNoProps: ReturnType<typeof mock>;
  let ensureComponent: ReturnType<typeof mock>;
  let onComponentSelected: ReturnType<typeof mock>;
  let setComponentParam: ReturnType<typeof mock>;

  beforeEach(() => {
    ensureSample = mock(async () => ({ generated: false, exists: false }));
    ensureDefaultSampleForNoProps = mock(async () => undefined);
    ensureComponent = mock(async (_paths: string[]) => 'preview-content');
    onComponentSelected = mock(async () => 'ok' as const);
    setComponentParam = mock((_p: string) => undefined);
  });

  it('UI primitive: ensureSample is skipped (do not mutate shadcn source)', async () => {
    const result = await runComponentSelectedSlice({
      relativePath: 'client/components/ui/carousel.tsx',
      autoSampleEnabled: true,
      ensureSample,
      ensureDefaultSampleForNoProps,
      ensureComponent,
      onComponentSelected,
      setComponentParam,
      shouldCreateNoPropsSample: true,
    });

    expect(result.isPrimitive).toBe(true);
    expect(ensureSample).not.toHaveBeenCalled();
    expect(ensureDefaultSampleForNoProps).not.toHaveBeenCalled();
  });

  it('UI primitive: ensureComponent + onComponentSelected + setComponentParam still run', async () => {
    await runComponentSelectedSlice({
      relativePath: 'client/components/ui/carousel.tsx',
      autoSampleEnabled: true,
      ensureSample,
      ensureDefaultSampleForNoProps,
      ensureComponent,
      onComponentSelected,
      setComponentParam,
      shouldCreateNoPropsSample: true,
    });

    expect(ensureComponent).toHaveBeenCalledTimes(1);
    expect(ensureComponent).toHaveBeenCalledWith(['client/components/ui/carousel.tsx']);
    expect(onComponentSelected).toHaveBeenCalledTimes(1);
    expect(setComponentParam).toHaveBeenCalledWith('client/components/ui/carousel.tsx');
  });

  it('non-primitive: ensureSample is called when autoSampleEnabled', async () => {
    const result = await runComponentSelectedSlice({
      relativePath: 'src/components/Button.tsx',
      autoSampleEnabled: true,
      ensureSample,
      ensureDefaultSampleForNoProps,
      ensureComponent,
      onComponentSelected,
      setComponentParam,
      shouldCreateNoPropsSample: true,
    });

    expect(result.isPrimitive).toBe(false);
    expect(ensureSample).toHaveBeenCalledTimes(1);
    expect(ensureDefaultSampleForNoProps).toHaveBeenCalledTimes(1);
    expect(ensureComponent).toHaveBeenCalledTimes(1);
  });

  it('non-primitive with autoSampleEnabled=false: ensureSample is skipped, ensureComponent still runs', async () => {
    await runComponentSelectedSlice({
      relativePath: 'src/components/Button.tsx',
      autoSampleEnabled: false,
      ensureSample,
      ensureDefaultSampleForNoProps,
      ensureComponent,
      onComponentSelected,
      setComponentParam,
      shouldCreateNoPropsSample: true,
    });

    expect(ensureSample).not.toHaveBeenCalled();
    // ensureDefaultSampleForNoProps still runs because shouldCreateNoPropsSample is true
    // and the component is not a primitive — only the heavy ensureSample path is gated by autoSampleEnabled
    expect(ensureDefaultSampleForNoProps).toHaveBeenCalledTimes(1);
    expect(ensureComponent).toHaveBeenCalledTimes(1);
  });

  it('UI primitive variant: backslash path (Windows) still classifies as primitive', async () => {
    const result = await runComponentSelectedSlice({
      relativePath: 'client\\components\\ui\\carousel.tsx',
      autoSampleEnabled: true,
      ensureSample,
      ensureDefaultSampleForNoProps,
      ensureComponent,
      onComponentSelected,
      setComponentParam,
      shouldCreateNoPropsSample: true,
    });

    expect(result.isPrimitive).toBe(true);
    expect(ensureSample).not.toHaveBeenCalled();
    expect(ensureComponent).toHaveBeenCalledTimes(1);
  });
});
