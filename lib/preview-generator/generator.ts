/**
 * Pure string-template generator for __canvas_preview__.tsx.
 * No I/O — takes structured entries, returns source code string.
 */

import { basename, dirname } from 'node:path';
import type { ExportStyle } from './scanner';

export interface PreviewComponentEntry {
  /** Relative path from project root, e.g. 'src/components/Button.tsx' */
  componentPath: string;
  /** PascalCase component name, e.g. 'Button' */
  componentName: string;
  exportStyle: ExportStyle;
  /** All Sample* export names found in source, e.g. ['SampleDefault', 'SamplePrimary'] */
  sampleExports: string[];
  /** Resolved import path relative to preview file, e.g. './components/Button' */
  importPath: string;
}

export interface ProviderWrapConfig {
  /** Import lines for providers, e.g. "import { SafeAreaProvider } from 'react-native-safe-area-context'" */
  imports: string[];
  /** Opening JSX tags, e.g. "<SafeAreaProvider><TamaguiProvider config={config}>" */
  wrapOpen: string;
  /** Closing JSX tags, e.g. "</TamaguiProvider></SafeAreaProvider>" */
  wrapClose: string;
}

export interface GeneratePreviewOptions {
  isNextPagesRouter?: boolean;
  /** Wrap rendered components with project-specific providers (theme, safe area, navigation) */
  providerWrap?: ProviderWrapConfig;
}

/** Convert 'SampleDefault' → 'default', 'SamplePrimary' → 'primary' */
export function sampleExportToKey(exportName: string): string {
  const withoutPrefix = exportName.replace(/^Sample/, '');
  return withoutPrefix.charAt(0).toLowerCase() + withoutPrefix.slice(1);
}

/**
 * Detect name collisions and derive unique prefixes.
 * Two `Button.tsx` in different dirs → `UiButton` / `FormButton`.
 */
export function deriveUniquePrefix(entries: PreviewComponentEntry[]): Map<string, string> {
  const nameToEntries = new Map<string, PreviewComponentEntry[]>();
  for (const entry of entries) {
    const list = nameToEntries.get(entry.componentName) ?? [];
    list.push(entry);
    nameToEntries.set(entry.componentName, list);
  }

  const result = new Map<string, string>();
  for (const [, group] of nameToEntries) {
    if (group.length === 1) {
      result.set(group[0].componentPath, group[0].componentName);
      continue;
    }
    // Collision: prepend parent dir name
    const prefixed = new Map<string, string>();
    for (const entry of group) {
      const parentDir = basename(dirname(entry.componentPath));
      // Skip '.' for root-level files — not a valid JS identifier prefix
      const prefix = parentDir && parentDir !== '.' ? parentDir.charAt(0).toUpperCase() + parentDir.slice(1) : 'Root';
      prefixed.set(entry.componentPath, `${prefix}${entry.componentName}`);
    }

    // Check if parent dir prefix resolves all collisions
    const names = [...prefixed.values()];
    const hasDupes = new Set(names).size !== names.length;

    if (hasDupes) {
      // Escalate to grandparent/parent prefix
      for (const entry of group) {
        const parts = dirname(entry.componentPath)
          .split('/')
          .filter((p) => p && p !== '.');
        const grandparent = parts.length >= 2 ? parts[parts.length - 2] : '';
        const parent = parts[parts.length - 1] ?? '';
        const combined = grandparent
          ? `${grandparent.charAt(0).toUpperCase()}${grandparent.slice(1)}${parent.charAt(0).toUpperCase()}${parent.slice(1)}`
          : parent
            ? `${parent.charAt(0).toUpperCase()}${parent.slice(1)}`
            : 'Root';
        result.set(entry.componentPath, `${combined}${entry.componentName}`);
      }
    } else {
      for (const [path, name] of prefixed) {
        result.set(path, name);
      }
    }
  }
  return result;
}

/** Generate the full __canvas_preview__.tsx content */
export function generatePreviewContent(entries: PreviewComponentEntry[], options?: GeneratePreviewOptions): string {
  const uniqueNames = deriveUniquePrefix(entries);
  const lines: string[] = [];

  // 1. React import + InstanceEntry type for multi-instance mode
  lines.push("import React from 'react';");

  // Next.js pages router import
  if (options?.isNextPagesRouter) {
    lines.push("import { useRouter } from 'next/router';");
  }

  // Provider imports for project-specific wrapping (theme, safe area, navigation)
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

  // 2. Component imports
  for (const entry of entries) {
    const alias = uniqueNames.get(entry.componentPath) ?? entry.componentName;
    lines.push(buildImportLine(entry, alias));
  }

  lines.push('');

  // 3. componentRegistry
  lines.push('const componentRegistry: Record<string, PreviewComponent> = {');
  for (const entry of entries) {
    const alias = uniqueNames.get(entry.componentPath) ?? entry.componentName;
    lines.push(`  '${entry.componentPath}': toPreviewComponent(${alias}),`);
  }
  lines.push('};');
  lines.push('');

  // 4. sampleRenderMap (SampleDefault only)
  lines.push('const sampleRenderMap: Record<string, React.FC> = {');
  for (const entry of entries) {
    if (entry.sampleExports.includes('SampleDefault')) {
      const alias = uniqueNames.get(entry.componentPath) ?? entry.componentName;
      lines.push(`  '${entry.componentPath}': ${alias}SampleDefault,`);
    }
  }
  lines.push('};');
  lines.push('');

  // 5. sampleRenderersMap (all variants)
  lines.push('const sampleRenderersMap: Record<string, Record<string, React.FC>> = {');
  for (const entry of entries) {
    const alias = uniqueNames.get(entry.componentPath) ?? entry.componentName;
    if (entry.sampleExports.length > 0) {
      lines.push(`  '${entry.componentPath}': {`);
      for (const exp of entry.sampleExports) {
        lines.push(`    '${sampleExportToKey(exp)}': ${alias}${exp},`);
      }
      lines.push('  },');
    } else {
      lines.push(`  '${entry.componentPath}': {},`);
    }
  }
  lines.push('};');
  lines.push('');

  // 6. callbackStubs
  lines.push('const callbackStubs = {');
  lines.push("  onClick: () => console.log('[Preview] onClick'),");
  lines.push(
    "  onChange: (e: React.SyntheticEvent) => console.log('[Preview] onChange', (e?.target as HTMLInputElement)?.value),",
  );
  lines.push("  onSubmit: (e: React.SyntheticEvent) => { e?.preventDefault?.(); console.log('[Preview] onSubmit'); },");
  lines.push("  onBlur: () => console.log('[Preview] onBlur'),");
  lines.push("  onFocus: () => console.log('[Preview] onFocus'),");
  lines.push("  onNavChange: (value: unknown) => console.log('[Preview] onNavChange', value),");
  lines.push('};');
  lines.push('');

  // 7. Fallback props for components without SampleDefault.
  // Extra props are harmless for React components that do not read them, and
  // they keep prop-required leaf components renderable in the preview.
  lines.push('const previewFallbackProps: Record<string, unknown> = {');
  lines.push('  ...callbackStubs,');
  lines.push('  activeNav: "dashboard",');
  lines.push('  activeSection: "dashboard",');
  lines.push('  count: 1,');
  lines.push('  data: [],');
  lines.push('  headings: [],');
  lines.push('  index: 1,');
  lines.push('  items: [],');
  lines.push('  label: "Preview",');
  lines.push('  rows: [],');
  lines.push('  title: "Preview",');
  lines.push('  value: "Preview",');
  lines.push('  block: { id: "preview-block", type: "paragraph", content: "Preview block", checked: false },');
  lines.push('  page: {');
  lines.push('    id: "preview-page",');
  lines.push('    title: "Preview Page",');
  lines.push('    icon: "Preview",');
  lines.push('    coverGradient: "linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)",');
  lines.push('    parentId: null,');
  lines.push('    isFavorite: false,');
  lines.push('    lastEdited: "Preview",');
  lines.push('    blocks: [{ id: "preview-block", type: "paragraph", content: "Preview block" }],');
  lines.push('  },');
  lines.push('  metric: { label: "Preview", value: "1,024", change: "+12%", trend: "up" },');
  lines.push(
    '  row: { id: "preview-row", name: "Preview row", status: "Done", priority: "Medium", date: "2026-01-01" },',
  );
  lines.push('};');
  lines.push('');

  // 8. Error boundary to catch component render crashes (e.g. missing required props)
  // Without this, a crash in one component kills the entire React tree and all subsequent
  // component switches via postMessage silently fail (black canvas).
  lines.push(...buildErrorBoundary());
  lines.push('');

  // 9. CanvasPreview component
  if (options?.isNextPagesRouter) {
    lines.push(...buildCanvasPreviewNextPages(options?.providerWrap));
  } else {
    lines.push(...buildCanvasPreviewURLParams(options?.providerWrap));
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Generate __canvas_preview__.tsx as a standalone entry (Isolated mode).
 * Includes createRoot and imports PreviewWrapper from .hyperide/preview.tsx.
 *
 * @hyperide-managed — generated file, do not edit
 */
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

  if (entry.exportStyle === 'default-named' || entry.exportStyle === 'default-anonymous') {
    if (sampleImports.length > 0) {
      return `import ${alias}, { ${sampleImports.join(', ')} } from '${entry.importPath}';`;
    }
    return `import ${alias} from '${entry.importPath}';`;
  }

  // Named export — if alias differs from actual export name, rename it
  const componentImport = alias !== entry.componentName ? `${entry.componentName} as ${alias}` : alias;
  const allImports = [componentImport, ...sampleImports];
  return `import { ${allImports.join(', ')} } from '${entry.importPath}';`;
}

function buildCanvasPreviewURLParams(providerWrap?: ProviderWrapConfig): string[] {
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
    '  // Sync props to state when parent re-renders with new searchParams (Next.js App Router)',
    '  React.useEffect(() => {',
    '    if (componentProp != null) setComponentPath(componentProp);',
    '  }, [componentProp]);',
    '',
    '  // Read URL params on client mount (Vite / CSR environments without prop injection)',
    '  React.useEffect(() => {',
    '    if (componentProp != null) return;',
    '    const params = new URLSearchParams(window.location.search);',
    "    const urlComponent = params.get('component');",
    '    if (urlComponent) setComponentPath(urlComponent);',
    "    const urlMode = params.get('mode');",
    "    if (urlMode) setMode(urlMode as 'single' | 'multi');",
    '  }, []);',
    '',
    '  // Listen for component switches via postMessage (no iframe reload needed)',
    '  React.useEffect(() => {',
    '    function onMessage(e: MessageEvent) {',
    "      if (e.data?.type === 'hypercanvas:setComponent' && e.data.component) {",
    '        setComponentPath(e.data.component);',
    '        // Sync URL so HMR full-reload / Fast Refresh remount picks up the current component',
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
    ...buildCanvasPreviewBody(providerWrap),
    '}',
    '',
  ];
}

function buildCanvasPreviewNextPages(providerWrap?: ProviderWrapConfig): string[] {
  return [
    'export default function CanvasPreview() {',
    '  const router = useRouter();',
    "  const mode = router.query.mode as 'single' | 'multi';",
    '  const [componentPath, setComponentPath] = React.useState(router.query.component as string);',
    '',
    '  // Sync with router query changes',
    '  React.useEffect(() => {',
    '    if (router.query.component) setComponentPath(router.query.component as string);',
    '  }, [router.query.component]);',
    '',
    '  // Listen for component switches via postMessage (no iframe reload needed)',
    '  React.useEffect(() => {',
    '    function onMessage(e: MessageEvent) {',
    "      if (e.data?.type === 'hypercanvas:setComponent' && e.data.component) {",
    '        setComponentPath(e.data.component);',
    '        // Sync URL so HMR full-reload / Fast Refresh remount picks up the current component',
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
    ...buildCanvasPreviewBody(providerWrap),
    '}',
    '',
  ];
}

function buildErrorBoundary(): string[] {
  return [
    'class ComponentErrorBoundary extends React.Component<',
    '  { children: React.ReactNode; componentPath: string },',
    '  { error: Error | null }',
    '> {',
    '  constructor(props: { children: React.ReactNode; componentPath: string }) {',
    '    super(props);',
    '    this.state = { error: null };',
    '  }',
    '  static getDerivedStateFromError(error: Error) {',
    '    return { error };',
    '  }',
    '  componentDidUpdate(prevProps: { componentPath: string }) {',
    '    // Reset error state when switching to a different component',
    '    if (prevProps.componentPath !== this.props.componentPath && this.state.error) {',
    '      this.setState({ error: null });',
    '    }',
    '  }',
    '  render() {',
    '    if (this.state.error) {',
    '      // Notify parent webview about the error — UI renders in the overlay layer, not here',
    '      window.parent.postMessage({',
    "        type: 'hypercanvas:componentError',",
    '        componentPath: this.props.componentPath,',
    '        error: this.state.error.message,',
    "      }, '*');",
    '      return null;',
    '    }',
    '    return this.props.children;',
    '  }',
    '}',
  ];
}

function buildCanvasPreviewBody(providerWrap?: ProviderWrapConfig): string[] {
  const wo = providerWrap?.wrapOpen ?? '';
  const wc = providerWrap?.wrapClose ?? '';
  return [
    '  if (!componentPath) {',
    "    return <div style={{ padding: 20, fontFamily: 'sans-serif' }}>",
    '      <h2>Error: No component specified</h2>',
    '      <p>Add ?component=... to URL</p>',
    '    </div>;',
    '  }',
    '',
    '  const Component = componentRegistry[componentPath];',
    '  const sampleRenderers = sampleRenderersMap[componentPath] || {};',
    '',
    "  if (mode !== 'multi') {",
    '    const SampleDefault = sampleRenderMap[componentPath];',
    '    if (!SampleDefault && !Component) {',
    "      return <div style={{ padding: 20, fontFamily: 'sans-serif' }}>",
    '        <h2>Error: Component not found</h2>',
    '        <p>Component &quot;{componentPath}&quot; is not available</p>',
    '      </div>;',
    '    }',
    `    return ${wo}<ComponentErrorBoundary componentPath={componentPath}><div style={{ padding: 20 }}>{SampleDefault ? <SampleDefault /> : <Component {...previewFallbackProps} />}</div></ComponentErrorBoundary>${wc};`,
    '  }',
    '',
    '  const instances = ((window.parent as unknown) as { __CANVAS_INSTANCES__?: Record<string, InstanceEntry> }).__CANVAS_INSTANCES__ || {};',
    '',
    '  return (',
    `    ${wo}<ComponentErrorBoundary componentPath={componentPath}>`,
    "    <div style={{ position: 'relative', width: 10000, height: 10000 }}>",
    '      {Object.entries(instances).map(([id, instance]: [string, InstanceEntry]) => {',
    '        const { x = 0, y = 0, props } = instance;',
    '',
    '        if (props && Object.keys(props).length > 0 && Component) {',
    '          const mergedProps = { ...previewFallbackProps, ...props };',
    '          return (',
    '            <div key={id} data-canvas-instance-id={id}',
    "                 style={{ position: 'absolute', left: x, top: y }}>",
    '              <Component {...mergedProps} />',
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
    '                <Component {...previewFallbackProps} />',
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
    '    </div>',
    `    </ComponentErrorBoundary>${wc}`,
    '  );',
  ];
}
