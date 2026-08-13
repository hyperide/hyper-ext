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

  // appEntrySet — paths previewable AS AN APP (rendered raw, own router/providers run).
  // app-mode looks these up here so it can skip prop-injection/sample-wrapping for them.
  lines.push('const appEntrySet = new Set<string>([');
  for (const entry of registryEntries) {
    if (entry.isAppEntry) lines.push(`  ${jsStr(entry.componentPath)},`);
  }
  lines.push(']);');
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
  lines.push(...buildAppRouteDriver());
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

/**
 * The strategy-aware navigation PRIMITIVE emitted into the preview. Given an UNPREFIXED in-app
 * path (`/settings`), it drives the previewed app's OWN router to match that route under the SaaS
 * proxy prefix `/project-preview/<id>/…`. The strategy is read from the iframe URL's `?nav=`:
 *
 *   - 'history-bridge' (default): put the UNPREFIXED path into window.location using the bridge's
 *     ORIGINAL (un-patched) pushState (`window.__hyperOriginalPushState`), so the proxy bridge does
 *     NOT re-prefix it. A no-basename <BrowserRouter> then reads `/settings` and matches. Assets/HMR
 *     keep working because the bridge's fetch/WS patches use a FROZEN prefix, not window.location.
 *   - 'basename': the router runs WITH `basename=<prefix>`, so it expects the PREFIXED path in
 *     location. Use the NORMAL (patched) pushState — it prefixes `/settings` → location becomes
 *     `/project-preview/<id>/settings`, which the basename router strips back to `/settings`.
 *   - 'src-swap': host-driven hard nav owns inter-page moves; this primitive only runs for the BOOT
 *     route, where it behaves like history-bridge (unprefixed) to match without a basename.
 *
 * Outside the proxy (the VS Code ext: no prefix, no bridge globals) every branch degrades to a
 * plain `history.pushState(route)` — there is nothing to prefix, so the router matches directly.
 *
 * SYNC: this emits an inline JS MIRROR of `applyPreviewRoute` in
 * shared/components/preview-chrome/nav-strategy.ts (the iframe bundle can't import shared code at
 * runtime). The shared function is unit-tested against a real <BrowserRouter>; keep the two in
 * lockstep when changing the navigation semantics.
 */
function buildNavPrimitive(): string[] {
  return [
    'function _hyperNavStrategy(): string {',
    '  // CACHE the strategy on first read. _driveInitialAppRoute navigates immediately and DROPS the',
    '  // query string (the boot route has no `?nav=`), so a later read of window.location.search',
    '  // would lose `nav=` and wrongly fall back to history-bridge — breaking e.g. a basename router',
    '  // on the second navigation. Memoize on a window global so it survives the history rewrite.',
    '  const w = window as unknown as { __hyperNavStrategy?: string };',
    '  if (w.__hyperNavStrategy) return w.__hyperNavStrategy;',
    '  // Whitelist + default MUST match the bridge (server/proxy-path-bridge.js VALID_NAV) so a bogus',
    '  // `nav=` is normalized the same on both sides — otherwise the bridge prefixes history while we',
    "  // navigate unprefixed (or vice-versa) and the app's own <Link> breaks the no-basename router.",
    '  const VALID: Record<string, number> = { basename: 1, "history-bridge": 1, "src-swap": 1 };',
    '  let strategy = "history-bridge";',
    '  try {',
    "    const raw = new URLSearchParams(window.location.search).get('nav');",
    '    // Object.prototype.hasOwnProperty (not a bare VALID[raw] lookup) so `nav=toString` etc.',
    "    // can't pass as valid via an inherited key — must match the bridge's Object.hasOwn check.",
    '    strategy = raw && Object.prototype.hasOwnProperty.call(VALID, raw) ? raw : "history-bridge";',
    '  } catch { /* malformed search — keep default */ }',
    '  w.__hyperNavStrategy = strategy;',
    '  return strategy;',
    '}',
    '',
    'function _hyperApplyRoute(route: string): void {',
    '  // route is an UNPREFIXED in-app path (e.g. "/settings"). Push it so the app router matches.',
    "  const target = route.startsWith('/') ? route : '/' + route;",
    '  const w = window as unknown as {',
    '    __hyperOriginalPushState?: (s: unknown, t: string, u: string) => void;',
    '    __hyperPreviewProxyPrefix?: string;',
    '  };',
    '  const strategy = _hyperNavStrategy();',
    '  if (strategy === "basename") {',
    '    // Router has basename=<prefix> → it wants the PREFIXED path. The PATCHED pushState',
    '    // prefixes for us; the router strips the basename back off to match. Compare path AND',
    '    // search AND hash so a query/hash-only change (/settings?tab=1 or /settings#x → /settings)',
    '    // is not dropped as a no-op (stale query/hash would linger).',
    '    const cur = window.location.pathname.replace(w.__hyperPreviewProxyPrefix || "", "") + window.location.search + window.location.hash;',
    '    if (cur !== target) {',
    "      window.history.pushState({}, '', target);",
    "      window.dispatchEvent(new PopStateEvent('popstate'));",
    '    }',
    '    return;',
    '  }',
    '  // history-bridge / src-swap boot: put the UNPREFIXED path into location WITHOUT re-prefixing,',
    '  // using the bridge-exposed original pushState when present (SaaS), else plain (ext).',
    '  const push = w.__hyperOriginalPushState || window.history.pushState.bind(window.history);',
    '  if (window.location.pathname + window.location.search + window.location.hash !== target) {',
    "    push({}, '', target);",
    "    window.dispatchEvent(new PopStateEvent('popstate'));",
    '  }',
    '}',
  ];
}

/**
 * App-mode shared bridge — rendered in BOTH app-mode branches. Two responsibilities:
 *   1. Install the `hypercanvas:navigateRoute` listener at the WINDOW level (idempotent global,
 *      NOT a React effect) so it SURVIVES any component unmount (app-mode B navigates away from
 *      `/test-preview`, unmounting the preview tree; the listener must outlive it).
 *   2. On mount, drive the app router OFF the `/test-preview` mount path to a real route (the
 *      `?route=` address, or `/`). Both modes need this: in app-mode A the raw app's
 *      BrowserRouter would otherwise see `/test-preview` and match no route; in app-mode B it is
 *      how the patched app renders its real page.
 * All navigation goes through `_hyperApplyRoute` (strategy-aware); a no-op for apps with no router.
 */
function buildAppRouteDriver(): string[] {
  return [
    ...buildNavPrimitive(),
    '',
    "// Report the app's CURRENT route to the host so the address bar stays in sync when the user",
    '// navigates INSIDE the preview (clicks an app <Link>, browser back/forward), not just via the bar.',
    '// The route is reported UNPREFIXED (strip the proxy prefix) since that is what the bar shows.',
    '',
    '// Snapshot the EXACT bootstrap URL (raw pathname + search) at mount. Route reporting cleans the',
    '// preview query ONLY while the URL is STILL byte-for-byte this bootstrap entry (no app navigation',
    '// yet) — distinguishing the preview bootstrap from later APP-OWNED URLs by TIME, not by guessing',
    '// which params the harness injected. Once the app navigates (pushState → a different path, query',
    '// dropped), the URL differs and we report it VERBATIM, so every real app param survives (a real',
    '// `/gallery?mode=multi`, `/feed?app=1`, or duplicate `?a=1&a=2` is never touched).',
    '// SSR-safe: this module is imported by SSR-capable preview routes (Next/Remix/Astro) where there',
    '// is no `window` at module load — guard the access so importing the module never crashes (the',
    '// value is only ever READ in the browser-only `_reportRouteToHost`).',
    "const _hyperBootHref = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '';",
    '// One-shot BOOT PHASE flag (a plain boolean — SSR-safe). Active ONLY when the module first loads',
    '// at a HARNESS MOUNT — the mount PATH (root `/`, or `/test-preview`, after stripping any',
    '// `/project-preview/<id>` proxy prefix) AND the injected `component` param. So a module that',
    '// (re)loads directly on a real app URL — `/gallery?mode=multi` (no component) OR even',
    '// `/gallery?component=hero` (non-mount path) — never enters boot phase and is reported verbatim.',
    '// The flag flips FALSE forever on the first navigation away from the bootstrap href, so navigating',
    '// away and BACK to the exact mount URL is a real route (verbatim) too.',
    'let _hyperInBootPhase = (function () {',
    "  if (typeof window === 'undefined') return false;",
    "  const _p = window.location.pathname.replace(/^\\/project-preview\\/[a-fA-F0-9-]+/, '') || '/';",
    "  const _isMountPath = _p === '/' || _p.indexOf('/test-preview') === 0;",
    "  return _isMountPath && new URLSearchParams(window.location.search).has('component');",
    '})();',
    '',
    'function _reportRouteToHost() {',
    '  try {',
    '    const w = window as unknown as { __hyperPreviewProxyPrefix?: string };',
    '    const prefix = w.__hyperPreviewProxyPrefix || "";',
    '    let path = window.location.pathname;',
    '    if (prefix && path.startsWith(prefix)) path = path.slice(prefix.length) || "/";',
    '    if (path.indexOf("/test-preview") === 0) return; // still on the mount path — not a real route',
    '    // Leave the boot phase FOREVER the first time the URL differs from the bootstrap href.',
    '    const _href = window.location.pathname + window.location.search;',
    '    if (_href !== _hyperBootHref) _hyperInBootPhase = false;',
    '    // Only the UNTOUCHED bootstrap entry (still in boot phase) has an all-harness query → report',
    '    // just the path (`/`). Every real navigation reports its search VERBATIM (real app params).',
    '    const _onBootstrap = _hyperInBootPhase && _href === _hyperBootHref;',
    '    const _search = _onBootstrap ? "" : window.location.search;',
    '    // Keep the hash so `<Link to="/settings#billing">` reports the full address.',
    '    const full = path + _search + window.location.hash;',
    "    window.parent.postMessage({ type: 'hypercanvas:appRouteChanged', route: full }, '*');",
    '  } catch { /* no parent / cross-origin — nothing to report */ }',
    '}',
    '',
    'function _installPersistentRouteListener() {',
    '  const w = window as unknown as { __hyperRouteNavInstalled?: boolean };',
    '  if (w.__hyperRouteNavInstalled) return;',
    '  w.__hyperRouteNavInstalled = true;',
    '  window.addEventListener("message", function (e: MessageEvent) {',
    '    if (e.source !== window.parent) return;',
    "    if (e.data?.type !== 'hypercanvas:navigateRoute') return;",
    "    const route = typeof e.data.route === 'string' ? e.data.route : null;",
    '    if (!route) return;',
    '    try { _hyperApplyRoute(route); }',
    '    catch { /* malformed address — free text is allowed but may not parse */ }',
    '  });',
    '  // Report app-initiated navigation back to the host. popstate covers back/forward; we also wrap',
    '  // pushState/replaceState (React Router <Link> calls those WITHOUT firing popstate) to report.',
    "  window.addEventListener('popstate', function () { _reportRouteToHost(); });",
    '  const hist = window.history as unknown as { pushState: (...a: unknown[]) => void; replaceState: (...a: unknown[]) => void };',
    '  const origPush = hist.pushState.bind(window.history);',
    '  const origReplace = hist.replaceState.bind(window.history);',
    '  hist.pushState = function (...args: unknown[]) { const r = origPush(...args); _reportRouteToHost(); return r; };',
    '  hist.replaceState = function (...args: unknown[]) { const r = origReplace(...args); _reportRouteToHost(); return r; };',
    '}',
    '',
    'function _driveInitialAppRoute() {',
    '  try {',
    '    const params = new URLSearchParams(window.location.search);',
    "    const requested = params.get('route');",
    '    if (requested && requested.startsWith("/")) { _hyperApplyRoute(requested); return; }',
    '    // No explicit ?route=. Only drive OFF the `/test-preview` mount path (or an unprefixed root)',
    '    // to "/". If the app is ALREADY on a real route — e.g. the user navigated to "/settings" and',
    '    // the preview later remounts (HMR / sample switch / retry) and reruns this bridge — do NOT',
    '    // shove it back to "/" (that would fight the address bar, which still shows /settings).',
    '    const w = window as unknown as { __hyperPreviewProxyPrefix?: string };',
    '    const prefix = w.__hyperPreviewProxyPrefix || "";',
    '    const path = prefix && window.location.pathname.startsWith(prefix)',
    '      ? (window.location.pathname.slice(prefix.length) || "/")',
    '      : window.location.pathname;',
    '    const onMountPath = path === "/" || path === "" || path.indexOf("/test-preview") === 0;',
    '    if (onMountPath) _hyperApplyRoute("/");',
    '  } catch { /* app has no history router — nothing to drive */ }',
    '}',
    '',
    'function _AppModeBridge() {',
    '  React.useEffect(() => {',
    '    _installPersistentRouteListener();',
    '    _driveInitialAppRoute();',
    '  }, []);',
    '  return null;',
    '}',
    '',
    'function _AppRouteDriver() {',
    '  return (<>',
    '    <_AppModeBridge />',
    "    <div style={{ padding: 20, fontFamily: 'sans-serif', color: '#888' }}>Loading app…</div>",
    '  </>);',
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
    'function RemixMockWrapper({ Component, componentPath }: { Component: React.ComponentType<Record<string, unknown>>; componentPath: string }) {',
    '  // createMemoryRouter + RouterProvider is a CLIENT-ONLY data-router API: it cannot',
    '  // render during server rendering. Remix SSRs this /test-preview route via',
    '  // renderToPipeableStream, so building the router at render time threw on the server',
    '  // and returned a 500 — the previewed route file (e.g. notifications.tsx) got an empty',
    '  // #root, the preview iframe never stabilised, and the e2e "switch" walk wedged on a',
    '  // perpetually-(re)loading frame (ext-test-projects matrix red #83). Gate the router behind a client-mount flag:',
    '  // SSR and the first client render emit a stable placeholder (so hydration sees matching',
    '  // markup), and the memory router mounts only after the effect runs on the client.',
    '  const [mounted, setMounted] = React.useState(false);',
    '  React.useEffect(() => { setMounted(true); }, []);',
    '  const router = React.useMemo(',
    '    () =>',
    '      mounted',
    '        ? createMemoryRouter(',
    '            [',
    '              {',
    "                id: 'root',",
    "                path: '/',",
    '                loader: () => ({}),',
    '                Component: React.Fragment,',
    '                children: [',
    '                  {',
    "                    path: 'preview',",
    '                    Component: Component as React.ComponentType,',
    '                    loader: () => ({}),',
    '                  },',
    '                ],',
    '              },',
    '            ],',
    "            { initialEntries: ['/preview'] },",
    '          )',
    '        : null,',
    '    [mounted, Component],',
    '  );',
    '  // While only the pre-mount placeholder exists, do NOT emit the success signal:',
    '  // the route component has not rendered yet, so reporting render-success here would',
    '  // clear a real error prematurely (usePreviewBridge consumes componentRenderSucceeded).',
    '  // The SSR-route callsites suppress the OUTER success signal (!ssrRouteSet.has(...)),',
    '  // so the only success signal for these routes is the one below, fired post-mount.',
    '  if (!router) return <div data-hyper-ssr-route-placeholder style={{ padding: 20 }} />;',
    '  return (',
    '    <>',
    '      <RouterProvider router={router} />',
    '      <_ComponentSuccessSignal componentPath={componentPath} />',
    '    </>',
    '  );',
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

/**
 * App-mode route navigation. The address bar (host webview/canvas) posts
 * `hypercanvas:navigateRoute` with an in-app path. We drive the previewed app's OWN router
 * (BrowserRouter / createBrowserRouter / Next) via `_hyperApplyRoute`, which is strategy-aware
 * (history-bridge / basename / src-swap) and re-reads `window.location` by firing `popstate`.
 * Router-agnostic and a no-op for apps without a router. Component-mode never receives the
 * message, so this stays inert outside app-mode.
 */
function buildRouteNavigationEffect(): string[] {
  return [
    '  React.useEffect(() => {',
    '    function onNavigateRoute(e: MessageEvent) {',
    '      // Only the embedding host (the preview panel / canvas) may drive the app router.',
    '      // Reject messages from any other sender (a nested iframe, an injected script) so an',
    '      // embedded page in the previewed app cannot pushState the top-level app around.',
    '      if (e.source !== window.parent) return;',
    "      if (e.data?.type !== 'hypercanvas:navigateRoute') return;",
    "      const route = typeof e.data.route === 'string' ? e.data.route : null;",
    '      if (!route) return;',
    '      try { _hyperApplyRoute(route); }',
    '      catch { /* ignore malformed addresses — free text is allowed but may not parse */ }',
    '    }',
    "    window.addEventListener('message', onNavigateRoute);",
    "    return () => window.removeEventListener('message', onNavigateRoute);",
    '  }, []);',
    '',
  ];
}

function buildCanvasPreviewURLParams(providerWrap?: ProviderWrapConfig, ssrRoutes?: Set<string>): string[] {
  return [
    'interface CanvasPreviewProps {',
    '  component?: string | null;',
    "  mode?: 'single' | 'multi' | 'app' | null;",
    '}',
    '',
    'export default function CanvasPreview({ component: componentProp, mode: modeProp }: CanvasPreviewProps = {}) {',
    '  const [componentPath, setComponentPath] = React.useState<string | null>(componentProp ?? null);',
    "  const [mode, setMode] = React.useState<'single' | 'multi' | 'app'>(modeProp ?? 'single');",
    '',
    ...buildGeneratedPropsState(),
    ...buildRetryRenderState(),
    ...buildRouteNavigationEffect(),
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
    "    if (urlMode === 'single' || urlMode === 'multi' || urlMode === 'app') setMode(urlMode);",
    "    if (params.get('app') === '1') setMode('app');",
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
    "  const mode = (router.query.app === '1' ? 'app' : router.query.mode) as 'single' | 'multi' | 'app';",
    '  const [componentPath, setComponentPath] = React.useState(router.query.component as string);',
    '',
    ...buildGeneratedPropsState(),
    ...buildRetryRenderState(),
    ...buildRouteNavigationEffect(),
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
    ? `{SampleDefault ? <SampleDefault /> : ssrRouteSet.has(componentPath) ? <RemixMockWrapper Component={Component} componentPath={componentPath} /> : <Component {...filterFallback(componentPath)} {...generatedProps} />}`
    : `{SampleDefault ? <SampleDefault /> : <Component {...filterFallback(componentPath)} {...generatedProps} />}`;
  const multiRender = hasSSR
    ? `{ssrRouteSet.has(componentPath) ? <RemixMockWrapper Component={Component} componentPath={componentPath} /> : <Component {...filterFallback(componentPath)} />}`
    : `<Component {...filterFallback(componentPath)} />`;
  const multiMergedRender = hasSSR
    ? `{ssrRouteSet.has(componentPath) ? <RemixMockWrapper Component={Component} componentPath={componentPath} /> : <Component {...mergedProps} />}`
    : `<Component {...mergedProps} />`;
  // For SSR routes RemixMockWrapper owns the success signal (fired post-mount, once the
  // route actually renders — not on the pre-mount placeholder). So the OUTER success
  // signal must be suppressed for those, or it would fire on the placeholder and clear a
  // real error prematurely (ext-test-projects matrix red #83 review). Non-SSR components keep the outer signal.
  const outerSuccessSignal = hasSSR
    ? '{!ssrRouteSet.has(componentPath) && <_ComponentSuccessSignal componentPath={componentPath} />}'
    : '<_ComponentSuccessSignal componentPath={componentPath} />';
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
    "  if (mode === 'app') {",
    '    // App-mode A — registerable entry root (router via RouterProvider / createBrowserRouter,',
    '    // or a clean App.tsx whose router lives in main.tsx): render it RAW. Its own router +',
    '    // providers run, so the address bar drives them via the route-navigation effect above.',
    '    // No provider wrap, no prop injection, no sample, full-bleed.',
    '    if (appEntrySet.has(componentPath) && Component) {',
    '      return (',
    '        <ComponentErrorBoundary key={errorBoundaryKey} componentPath={componentPath}>',
    '          <_AppModeBridge />',
    '          <Component />',
    '          <_ComponentSuccessSignal componentPath={componentPath} />',
    '        </ComponentErrorBoundary>',
    '      );',
    '    }',
    '    // App-mode B — the entry root is the vite-spa-jsx-router file the patcher injected this',
    "    // very `/test-preview` route into, so it can't be rendered raw (nested router). But the",
    '    // PATCHED app is already mounted around us. Drive its OWN router off `/test-preview` to a',
    '    // real route (the address, default `/`); the app then renders its real page, unmounting',
    '    // this preview. The route-navigation effect handles subsequent address-bar navigation.',
    '    return <_AppRouteDriver />;',
    '  }',
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
    `    return ${wo}<ComponentErrorBoundary key={errorBoundaryKey} componentPath={componentPath} propsReady={generatedPropsReady}><div style={${singleWrapperStyle}}>${singleRender}${outerSuccessSignal}</div></ComponentErrorBoundary>${wc};`,
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
    `      ${outerSuccessSignal}`,
    '    </div>',
    `    </ComponentErrorBoundary>${wc}`,
    '  );',
  ];
}
