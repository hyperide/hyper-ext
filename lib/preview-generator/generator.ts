/**
 * @file Pure string-template generator for __canvas_preview__.tsx
 *
 * Accessed via: PreviewFileManager (preview-file-manager.ts:~498)
 * Assumptions: No I/O — takes structured entries, returns source code string
 * Past bugs: HYP-448 — Proxy meta-key delegation for DOM-safe spread
 *   HYP-465 — per-component fallback props filtering
 *   HYP-498 — default-export synthetic sample reference
 */

import type { ContainerSampleJsxBody } from './sample-scaffold';
import type { ExportStyle } from './scanner';
import type { PreviewComponentEntry, GeneratePreviewOptions, ProviderWrapConfig } from './types';
import {
  buildCallbackStubs,
  buildFilterFallback,
  buildPreviewFallbackProps,
  buildPreviewObjects,
} from './fallback-data';
import { deriveUniquePrefix, extractImportedBindings } from './name-resolution';

export type { PreviewComponentEntry, SSRMockConfig, ProviderWrapConfig, GeneratePreviewOptions } from './types';

import { PREVIEW_GENERATOR_SCHEMA_MARKER, entryHasRenderableSample, isUiPrimitive, sampleExportToKey } from './types';

export { PREVIEW_GENERATOR_SCHEMA_MARKER, entryHasRenderableSample, isUiPrimitive, sampleExportToKey } from './types';

export { deriveUniquePrefix } from './name-resolution';

/**
 * Emit `value` as a fully-escaped, single-quoted JS string literal for the
 * generated source (keeps this file's single-quote convention).
 *
 * Derived from `JSON.stringify`, which escapes EVERY metacharacter —
 * backslash, double quote, newlines and control chars — then re-wrapped in
 * single quotes with `'` escaped too. This replaces the previous
 * `.replace(/'/g, "\\'")` single-quote-only escaping, which left `\`
 * unescaped (CodeQL js/incomplete-sanitization): `foo\` would emit `'foo\'`
 * and swallow the closing quote, letting the value break out of the literal.
 */
function jsStr(value: string): string {
  // JSON.stringify gives a fully-escaped double-quoted literal. Strip the
  // outer double quotes, un-escape the now-redundant `\"`, then escape `'`
  // and re-wrap in single quotes. Backslash, newlines, etc. stay escaped.
  const inner = JSON.stringify(value).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'");
  return `'${inner}'`;
}

/** Generate the full __canvas_preview__.tsx content */
export function generatePreviewContent(entries: PreviewComponentEntry[], options?: GeneratePreviewOptions): string {
  const registryEntries = entries.filter((e) => !isUiPrimitive(e.componentPath) || entryHasRenderableSample(e));
  const uniqueNames = deriveUniquePrefix(
    registryEntries,
    extractImportedBindings(options?.providerWrap?.imports ?? []),
  );
  const lines: string[] = [];

  const ssrRoutes = new Set(registryEntries.filter((e) => e.isSSRRoute).map((e) => e.componentPath));
  const needsRemixMock = options?.ssrMock?.framework === 'remix' && ssrRoutes.size > 0;

  // Header
  lines.push('// @ts-nocheck');
  lines.push(`// ${PREVIEW_GENERATOR_SCHEMA_MARKER}`);
  lines.push("import React from 'react';");

  if (options?.isNextPagesRouter) {
    lines.push("import { useRouter } from 'next/router';");
  }
  if (needsRemixMock) {
    lines.push("import { createMemoryRouter, RouterProvider } from 'react-router-dom';");
  }
  if (options?.providerWrap?.imports.length) {
    for (const imp of options.providerWrap.imports) {
      lines.push(imp);
    }
  }

  lines.push('');
  lines.push('type InstanceEntry = { x?: number; y?: number; props?: Record<string, unknown> };');
  lines.push('type PreviewComponent = React.ComponentType<Record<string, unknown>>;');
  lines.push('');
  lines.push('function toPreviewComponent<P>(component: React.ComponentType<P>): PreviewComponent {');
  lines.push('  return component as unknown as PreviewComponent;');
  lines.push('}');
  lines.push('');

  // Component imports
  for (const entry of registryEntries) {
    const alias = uniqueNames.get(entry.componentPath) ?? entry.componentName;
    lines.push(buildImportLine(entry, alias));
    if (entry.syntheticSampleDefault) {
      lines.push(`import * as ${alias}Module from ${jsStr(entry.importPath)};`);
    }
  }
  lines.push('');

  // componentRegistry
  lines.push('const componentRegistry: Record<string, PreviewComponent> = {');
  for (const entry of registryEntries) {
    const alias = uniqueNames.get(entry.componentPath) ?? entry.componentName;
    lines.push(`  ${jsStr(entry.componentPath)}: toPreviewComponent(${alias}),`);
  }
  lines.push('};');
  lines.push('');

  // sampleRenderMap
  lines.push('const sampleRenderMap: Record<string, React.FC> = {');
  for (const entry of registryEntries) {
    const alias = uniqueNames.get(entry.componentPath) ?? entry.componentName;
    const safeKey = jsStr(entry.componentPath);
    if (entry.sampleExports.includes('SampleDefault')) {
      lines.push(`  ${safeKey}: ${alias}SampleDefault,`);
    } else if (entry.syntheticSampleDefault) {
      const inline = renderSyntheticSampleArrow(
        entry.syntheticSampleDefault,
        alias,
        entry.componentName,
        entry.exportStyle,
      );
      lines.push(`  ${safeKey}: ${inline},`);
    }
  }
  lines.push('};');
  lines.push('');

  // componentExportsMap
  lines.push('const componentExportsMap: Record<string, string[]> = {');
  for (const entry of entries) {
    if (!entry.detectedExports || entry.detectedExports.length === 0) continue;
    const safeKey = jsStr(entry.componentPath);
    const exportsList = entry.detectedExports.map((n) => JSON.stringify(n)).join(', ');
    lines.push(`  ${safeKey}: [${exportsList}],`);
  }
  lines.push('};');
  lines.push('');

  // declaredPropNamesMap
  lines.push('const declaredPropNamesMap: Record<string, string[]> = {');
  for (const entry of entries) {
    if (entry.declaredPropNames === undefined) continue;
    const safeKey = jsStr(entry.componentPath);
    const namesList = entry.declaredPropNames.map((n) => JSON.stringify(n)).join(', ');
    lines.push(`  ${safeKey}: [${namesList}],`);
  }
  lines.push('};');
  lines.push('');

  // sampleRenderersMap
  lines.push('const sampleRenderersMap: Record<string, Record<string, React.FC>> = {');
  for (const entry of registryEntries) {
    const alias = uniqueNames.get(entry.componentPath) ?? entry.componentName;
    if (entry.sampleExports.length > 0) {
      lines.push(`  ${jsStr(entry.componentPath)}: {`);
      for (const exp of entry.sampleExports) {
        lines.push(`    ${jsStr(sampleExportToKey(exp))}: ${alias}${exp},`);
      }
      lines.push('  },');
    } else {
      lines.push(`  ${jsStr(entry.componentPath)}: {},`);
    }
  }
  lines.push('};');
  lines.push('');

  // Callback stubs + preview objects + fallback props
  lines.push(...buildCallbackStubs());
  lines.push(...buildPreviewObjects());
  lines.push(...buildPreviewFallbackProps());
  lines.push(...buildFilterFallback());

  // SSR mock
  if (needsRemixMock) {
    lines.push('const ssrRouteSet = new Set<string>([');
    for (const routePath of ssrRoutes) {
      lines.push(`  ${jsStr(routePath)},`);
    }
    lines.push(']);');
    lines.push('');
    lines.push(...buildRemixMockWrapper());
    lines.push('');
  }

  // Error boundary + signals
  lines.push(...buildErrorBoundary());
  lines.push('');
  lines.push(...buildComponentSuccessSignal());
  lines.push('');
  lines.push(...buildComponentMissingSignal());
  lines.push('');

  // CanvasPreview component
  const ssrRoutesForBody = needsRemixMock ? ssrRoutes : undefined;
  if (options?.isNextPagesRouter) {
    lines.push(...buildCanvasPreviewNextPages(options?.providerWrap, ssrRoutesForBody));
  } else {
    lines.push(...buildCanvasPreviewURLParams(options?.providerWrap, ssrRoutesForBody));
  }

  return `${lines.join('\n')}\n`;
}

/** Generate __canvas_preview__.tsx as a standalone entry */
export function generateStandaloneEntry(
  entries: PreviewComponentEntry[],
  wrapperImportPath: string,
  options?: GeneratePreviewOptions,
): string {
  const baseContent = generatePreviewContent(entries, options);
  const bootstrap = `
// @hyperide-managed
import { createRoot } from 'react-dom/client';
import { PreviewWrapper } from '${wrapperImportPath}';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <PreviewWrapper>
      <CanvasPreview />
    </PreviewWrapper>
  );
}
`;
  return baseContent + bootstrap;
}

function buildImportLine(entry: PreviewComponentEntry, alias: string): string {
  const sampleImports = entry.sampleExports.map((exp) => `${exp} as ${alias}${exp}`);
  const safePath = jsStr(entry.importPath);
  if (entry.exportStyle === 'default-named' || entry.exportStyle === 'default-anonymous') {
    if (sampleImports.length > 0) {
      return `import ${alias}, { ${sampleImports.join(', ')} } from ${safePath};`;
    }
    return `import ${alias} from ${safePath};`;
  }
  const componentImport = alias !== entry.componentName ? `${entry.componentName} as ${alias}` : alias;
  const allImports = [componentImport, ...sampleImports];
  return `import { ${allImports.join(', ')} } from ${safePath};`;
}

function renderSyntheticSampleArrow(
  synthetic: ContainerSampleJsxBody,
  alias: string,
  componentName: string,
  exportStyle: ExportStyle,
): string {
  const moduleAlias = `${alias}Module`;
  const parentIsDefaultExport = exportStyle === 'default-named' || exportStyle === 'default-anonymous';
  let body = synthetic.body;
  for (const name of synthetic.referencedNames) {
    const re = new RegExp(`(<\\/?)\\s*${name}\\b`, 'g');
    const replacement = parentIsDefaultExport && name === componentName ? `$1${alias}` : `$1${moduleAlias}.${name}`;
    body = body.replace(re, replacement);
  }
  const indented = body
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n');
  return `() => (\n${indented}\n    )`;
}

function buildComponentSuccessSignal(): string[] {
  return [
    'function _ComponentSuccessSignal({ componentPath }: { componentPath: string }) {',
    '  React.useEffect(() => {',
    "    window.parent.postMessage({ type: 'hypercanvas:componentRenderSucceeded', componentPath }, '*');",
    '  }, [componentPath]);',
    '  return null;',
    '}',
  ];
}

function buildComponentMissingSignal(): string[] {
  return [
    'function _ComponentMissingSignal({ componentPath }: { componentPath: string }) {',
    '  React.useEffect(() => {',
    "    window.parent.postMessage({ type: 'hypercanvas:componentMissing', componentPath }, '*');",
    '  }, [componentPath]);',
    '  return null;',
    '}',
  ];
}

function buildErrorBoundary(): string[] {
  return [
    'class ComponentErrorBoundary extends React.Component<',
    '  { children: React.ReactNode; componentPath: string; propsReady?: boolean },',
    '  { error: Error | null }',
    '> {',
    '  constructor(props: { children: React.ReactNode; componentPath: string; propsReady?: boolean }) {',
    '    super(props);',
    '    this.state = { error: null };',
    '  }',
    '  static getDerivedStateFromError(error: Error) {',
    '    return { error };',
    '  }',
    '  override componentDidCatch(error: Error) {',
    '    window.parent.postMessage({',
    "      type: 'hypercanvas:componentError',",
    '      componentPath: this.props.componentPath,',
    '      error: error.message,',
    "    }, '*');",
    '  }',
    '  override componentDidUpdate(prevProps: { componentPath: string; propsReady?: boolean }) {',
    '    // HYP-649: componentPath changes are handled by the errorBoundaryKey remount',
    '    // (key includes componentPath), so the only in-place reset left here is the',
    '    // generated-props-arrived case (#210). Keeping a componentPath clause too would',
    '    // double-reset and race the key remount.',
    '    const propsJustArrived = !prevProps.propsReady && this.props.propsReady === true;',
    '    if (propsJustArrived && this.state.error) {',
    '      this.setState({ error: null });',
    '    }',
    '  }',
    '  override render() {',
    '    if (this.state.error) {',
    '      return null;',
    '    }',
    '    return this.props.children;',
    '  }',
    '}',
  ];
}

function buildRemixMockWrapper(): string[] {
  return [
    'function RemixMockWrapper({ Component }: { Component: React.ComponentType<Record<string, unknown>> }) {',
    '  const router = createMemoryRouter([',
    '    {',
    "      id: 'root',",
    "      path: '/',",
    '      loader: () => ({}),',
    '      Component: React.Fragment,',
    '      children: [{',
    "        path: 'preview',",
    '        Component: Component as React.ComponentType,',
    '        loader: () => ({}),',
    '      }],',
    '    },',
    "  ], { initialEntries: ['/preview'] });",
    '  return <RouterProvider router={router} />;',
    '}',
  ];
}

function buildGeneratedPropsState(): string[] {
  return [
    '  const [generatedPropsMap, setGeneratedPropsMap] = React.useState<Record<string, Record<string, unknown>>>({});',
    '  React.useEffect(() => {',
    '    function onGeneratedProps(e: MessageEvent) {',
    "      if (e.data?.type !== 'hypercanvas:setGeneratedProps') return;",
    '      const path = typeof e.data.componentPath === "string" ? e.data.componentPath : null;',
    '      if (!path) return;',
    '      const values = e.data.values && typeof e.data.values === "object" ? e.data.values : {};',
    '      setGeneratedPropsMap((prev) => ({ ...prev, [path]: values as Record<string, unknown> }));',
    '    }',
    "    window.addEventListener('message', onGeneratedProps);",
    "    return () => window.removeEventListener('message', onGeneratedProps);",
    '  }, []);',
    '',
  ];
}

/**
 * HYP-649 — re-render-after-error recovery. The host posts `hypercanvas:retryRender`
 * after an HMR full reload (and on demand). Bumping `retryCount` changes the
 * ErrorBoundary `key` (see `errorBoundaryKey` in buildCanvasPreviewBody), so React
 * remounts the boundary with fresh (non-error) state — a fixed component clears its
 * stale overlay without a full page reload. Key-remount is the single source of
 * truth for componentPath-driven resets (the boundary no longer resets in
 * componentDidUpdate on componentPath change, to avoid a double-reset race).
 */
function buildRetryRenderState(): string[] {
  return [
    '  const [retryCount, setRetryCount] = React.useState(0);',
    '  React.useEffect(() => {',
    '    function onRetryRender(e: MessageEvent) {',
    "      if (e.data?.type === 'hypercanvas:retryRender') {",
    '        setRetryCount((c) => c + 1);',
    '      }',
    '    }',
    "    window.addEventListener('message', onRetryRender);",
    "    return () => window.removeEventListener('message', onRetryRender);",
    '  }, []);',
    '',
  ];
}

function buildCanvasPreviewURLParams(providerWrap?: ProviderWrapConfig, ssrRoutes?: Set<string>): string[] {
  return [
    'interface CanvasPreviewProps {',
    '  component?: string | null;',
    "  mode?: 'single' | 'multi' | null;",
    '}',
    '',
    'export default function CanvasPreview({ component: componentProp, mode: modeProp }: CanvasPreviewProps = {}) {',
    '  const [componentPath, setComponentPath] = React.useState<string | null>(componentProp ?? null);',
    "  const [mode, setMode] = React.useState<'single' | 'multi'>(modeProp ?? 'single');",
    '',
    ...buildGeneratedPropsState(),
    ...buildRetryRenderState(),
    '  React.useEffect(() => {',
    '    if (componentProp != null) setComponentPath(componentProp);',
    '  }, [componentProp]);',
    '',
    '  React.useEffect(() => {',
    '    if (componentProp != null) return;',
    '    const params = new URLSearchParams(window.location.search);',
    "    const urlComponent = params.get('component');",
    '    if (urlComponent) setComponentPath(urlComponent);',
    "    const urlMode = params.get('mode');",
    "    if (urlMode) setMode(urlMode as 'single' | 'multi');",
    '  }, []);',
    '',
    '  React.useEffect(() => {',
    '    function onMessage(e: MessageEvent) {',
    "      if (e.data?.type === 'hypercanvas:setComponent' && e.data.component) {",
    '        setComponentPath(e.data.component);',
    '        try {',
    '          const url = new URL(window.location.href);',
    "          url.searchParams.set('component', e.data.component);",
    "          window.history.replaceState(null, '', url.toString());",
    '        } catch { /* ignore */ }',
    '      }',
    '    }',
    "    window.addEventListener('message', onMessage);",
    "    return () => window.removeEventListener('message', onMessage);",
    '  }, []);',
    '',
    ...buildCanvasPreviewBody(providerWrap, ssrRoutes),
    '}',
    '',
  ];
}

function buildCanvasPreviewNextPages(providerWrap?: ProviderWrapConfig, ssrRoutes?: Set<string>): string[] {
  return [
    'export default function CanvasPreview() {',
    '  const router = useRouter();',
    "  const mode = router.query.mode as 'single' | 'multi';",
    '  const [componentPath, setComponentPath] = React.useState(router.query.component as string);',
    '',
    ...buildGeneratedPropsState(),
    ...buildRetryRenderState(),
    '  React.useEffect(() => {',
    '    if (router.query.component) setComponentPath(router.query.component as string);',
    '  }, [router.query.component]);',
    '',
    '  React.useEffect(() => {',
    '    function onMessage(e: MessageEvent) {',
    "      if (e.data?.type === 'hypercanvas:setComponent' && e.data.component) {",
    '        setComponentPath(e.data.component);',
    '        try {',
    '          const url = new URL(window.location.href);',
    "          url.searchParams.set('component', e.data.component);",
    "          window.history.replaceState(null, '', url.toString());",
    '        } catch { /* ignore */ }',
    '      }',
    '    }',
    "    window.addEventListener('message', onMessage);",
    "    return () => window.removeEventListener('message', onMessage);",
    '  }, []);',
    '',
    ...buildCanvasPreviewBody(providerWrap, ssrRoutes),
    '}',
    '',
  ];
}

function buildCanvasPreviewBody(providerWrap?: ProviderWrapConfig, ssrRoutes?: Set<string>): string[] {
  const wo = providerWrap?.wrapOpen ?? '';
  const wc = providerWrap?.wrapClose ?? '';
  const hasSSR = ssrRoutes && ssrRoutes.size > 0;
  const isReactNative = (providerWrap?.imports ?? []).some(
    (imp) =>
      imp.includes('react-native-safe-area-context') ||
      imp.includes("from 'react-native'") ||
      imp.includes('@react-navigation/'),
  );
  const singleWrapperStyle = isReactNative
    ? "{ minHeight: '100vh', display: 'flex', flexDirection: 'column', padding: 20, boxSizing: 'border-box' }"
    : '{ padding: 20 }';
  const singleRender = hasSSR
    ? `{SampleDefault ? <SampleDefault /> : ssrRouteSet.has(componentPath) ? <RemixMockWrapper Component={Component} /> : <Component {...filterFallback(componentPath)} {...generatedProps} />}`
    : `{SampleDefault ? <SampleDefault /> : <Component {...filterFallback(componentPath)} {...generatedProps} />}`;
  const multiRender = hasSSR
    ? `{ssrRouteSet.has(componentPath) ? <RemixMockWrapper Component={Component} /> : <Component {...filterFallback(componentPath)} />}`
    : `<Component {...filterFallback(componentPath)} />`;
  const multiMergedRender = hasSSR
    ? `{ssrRouteSet.has(componentPath) ? <RemixMockWrapper Component={Component} /> : <Component {...mergedProps} />}`
    : `<Component {...mergedProps} />`;
  return [
    '  if (!componentPath) {',
    "    return <div style={{ padding: 20, fontFamily: 'sans-serif' }}>",
    '      <h2>Loading preview...</h2>',
    '      <p>Waiting for component selection</p>',
    '    </div>;',
    '  }',
    '',
    '  const Component = componentRegistry[componentPath];',
    '  const sampleRenderers = sampleRenderersMap[componentPath] || {};',
    '  const generatedProps = generatedPropsMap[componentPath] ?? {};',
    '  const generatedPropsReady = Object.prototype.hasOwnProperty.call(generatedPropsMap, componentPath);',
    '  // HYP-649: re-keying the ErrorBoundary on retryCount (or componentPath) remounts',
    '  // it with fresh state, clearing a stale error after the source is fixed.',
    '  const errorBoundaryKey = `${componentPath}-${retryCount}`;',
    '',
    "  if (mode !== 'multi') {",
    '    const SampleDefault = sampleRenderMap[componentPath];',
    '    if (!SampleDefault && !Component) {',
    '      const detectedExports = componentExportsMap[componentPath] ?? [];',
    '      return (',
    '        <div style={{ padding: 20, fontFamily: "sans-serif", color: "#666" }}>',
    '          <_ComponentMissingSignal componentPath={componentPath} />',
    '          <h2 style={{ margin: 0, fontSize: 16, color: "#333" }}>No sample for this component</h2>',
    '          <p style={{ marginTop: 8 }}>{componentPath}</p>',
    '          {detectedExports.length > 0 ? (',
    '            <p style={{ marginTop: 8 }}>Detected exports: {detectedExports.join(", ")}</p>',
    '          ) : (',
    '            <p style={{ marginTop: 8 }}>Generating sample…</p>',
    '          )}',
    '        </div>',
    '      );',
    '    }',
    `    return ${wo}<ComponentErrorBoundary key={errorBoundaryKey} componentPath={componentPath} propsReady={generatedPropsReady}><div style={${singleWrapperStyle}}>${singleRender}<_ComponentSuccessSignal componentPath={componentPath} /></div></ComponentErrorBoundary>${wc};`,
    '  }',
    '',
    '  const instances = ((window.parent as unknown) as { __CANVAS_INSTANCES__?: Record<string, InstanceEntry> }).__CANVAS_INSTANCES__ || {};',
    '',
    '  return (',
    `    ${wo}<ComponentErrorBoundary key={errorBoundaryKey} componentPath={componentPath}>`,
    "    <div style={{ position: 'relative', width: 10000, height: 10000 }}>",
    '      {Object.entries(instances).map(([id, instance]: [string, InstanceEntry]) => {',
    '        const { x = 0, y = 0, props } = instance;',
    '',
    '        if (props && Object.keys(props).length > 0 && Component) {',
    '          const mergedProps = { ...filterFallback(componentPath), ...props };',
    '          return (',
    '            <div key={id} data-canvas-instance-id={id}',
    "                 style={{ position: 'absolute', left: x, top: y }}>",
    `              ${multiMergedRender}`,
    '            </div>',
    '          );',
    '        }',
    '',
    '        const SampleComponent = sampleRenderers[id] || sampleRenderMap[componentPath];',
    '        if (!SampleComponent) {',
    '          if (Component) {',
    '            return (',
    '              <div key={id} data-canvas-instance-id={id}',
    "                   style={{ position: 'absolute', left: x, top: y }}>",
    `                ${multiRender}`,
    '              </div>',
    '            );',
    '          }',
    '          return null;',
    '        }',
    '',
    '        return (',
    '          <div key={id} data-canvas-instance-id={id}',
    "               style={{ position: 'absolute', left: x, top: y }}>",
    '            <SampleComponent />',
    '          </div>',
    '        );',
    '      })}',
    '      <_ComponentSuccessSignal componentPath={componentPath} />',
    '    </div>',
    `    </ComponentErrorBoundary>${wc}`,
    '  );',
  ];
}
