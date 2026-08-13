import type { ContainerSampleJsxBody } from './sample-scaffold';
import type { ExportStyle } from './scanner';

export const PREVIEW_GENERATOR_SCHEMA_MARKER = '@hyperide-preview-schema:fallback-props-v15';

export interface PreviewComponentEntry {
  componentPath: string;
  componentName: string;
  exportStyle: ExportStyle;
  sampleExports: string[];
  importPath: string;
  isSSRRoute?: boolean;
  syntheticSampleDefault?: ContainerSampleJsxBody;
  detectedExports?: string[];
  declaredPropNames?: string[];
  /**
   * The SPA entry root (the routed/provider app shell mounted by main.tsx). Previewed
   * AS AN APP in app-mode: rendered raw (own router + providers run), no prop injection or
   * sample wrapping. Normally these are excluded as non-renderable shells (HYP-546); app-mode
   * opts the explicitly-requested entry root back in so `App.tsx` is previewable as an app.
   */
  isAppEntry?: boolean;
  /**
   * Import path for the co-located .samples.tsx file (HYP-378). Present only when
   * .samples.tsx exists and exports at least one Sample* symbol. The generator emits
   * a second import line for this path so samples are decoupled from the component file.
   */
  samplesImportPath?: string;
  /**
   * Sample export names found in .samples.tsx (a subset of sampleExports). Used by the
   * generator to split sample imports between the component file and .samples.tsx, avoiding
   * duplicate bindings when the same name exists in both.
   */
  samplesFileExports?: string[];
}

export interface SSRMockConfig {
  framework: 'remix';
}

export interface ProviderWrapConfig {
  imports: string[];
  wrapOpen: string;
  wrapClose: string;
}

export interface GeneratePreviewOptions {
  isNextPagesRouter?: boolean;
  providerWrap?: ProviderWrapConfig;
  ssrMock?: SSRMockConfig;
}

export function entryHasRenderableSample(entry: PreviewComponentEntry): boolean {
  return entry.sampleExports.includes('SampleDefault') || entry.syntheticSampleDefault !== undefined;
}

export function isUiPrimitive(componentPath: string): boolean {
  return /(\/|\\|^)components[/\\]ui[/\\]/i.test(componentPath);
}

export function sampleExportToKey(exportName: string): string {
  const withoutPrefix = exportName.replace(/^Sample/, '');
  return withoutPrefix.charAt(0).toLowerCase() + withoutPrefix.slice(1);
}
