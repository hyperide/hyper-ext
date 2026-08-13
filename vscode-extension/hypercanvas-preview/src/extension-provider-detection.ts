import { access, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { parse as babelParse } from '@babel/parser';
import type * as t from '@babel/types';
import { detectFramework } from '@lib/preview-generator/framework-routing';
import type { SSRMockConfig } from '@lib/preview-generator';
import type { ProviderWrapConfig } from '@lib/preview-generator/types';
import { VSCodeFileIO } from './vscode-file-io';

interface ProviderContextFile {
  relativePath: string;
  content: string;
}

interface ThemeImport {
  importPath: string;
  importedName: string;
  localName: string;
  defaultImport: boolean;
}

export async function detectPreviewProviders(root: string): Promise<ProviderWrapConfig | undefined> {
  try {
    const previewDir = await getPreviewDir(root);
    const contextFiles = await readProviderContextFiles(root);
    if (contextFiles.length === 0) return undefined;

    const imports: string[] = [];
    let wrapOpen = '';
    let wrapClose = '';

    const pushImport = (line: string) => {
      if (!imports.includes(line)) imports.push(line);
    };

    const appendWrapper = (open: string, close: string) => {
      wrapOpen += open;
      wrapClose = `${close}${wrapClose}`;
    };

    const emotionTheme = findThemeProvider(contextFiles, '@emotion/react');
    if (emotionTheme) {
      pushImport("import { ThemeProvider as EmotionThemeProvider } from '@emotion/react';");
      pushImport(buildThemeImport(root, previewDir, emotionTheme.file, emotionTheme.themeImport));
      appendWrapper(`<EmotionThemeProvider theme={${emotionTheme.themeImport.localName}}>`, '</EmotionThemeProvider>');
    }

    const styledTheme = findThemeProvider(contextFiles, 'styled-components');
    if (styledTheme) {
      pushImport("import { ThemeProvider as StyledThemeProvider } from 'styled-components';");
      pushImport(buildThemeImport(root, previewDir, styledTheme.file, styledTheme.themeImport));
      appendWrapper(`<StyledThemeProvider theme={${styledTheme.themeImport.localName}}>`, '</StyledThemeProvider>');
    }

    const appContent = contextFiles.map((file) => file.content).join('\n');
    const appFile = contextFiles.find((file) => file.content.includes('TamaguiProvider')) ?? contextFiles[0];

    const tamaguiCfg = appFile.content.match(
      /import\s+(?:\{\s*(\w+)\s*\}|(\w+))\s+from\s+['"]([^'"]*tamagui\.config[^'"]*)['"]/,
    );
    if (tamaguiCfg && appContent.includes('TamaguiProvider')) {
      const cfgVar = tamaguiCfg[1] || tamaguiCfg[2];
      const cfgPath = rebaseImportPath(root, previewDir, appFile.relativePath, tamaguiCfg[3]);
      const themeMatch = appContent.match(/defaultTheme=["'](\w+)["']/);
      const theme = themeMatch?.[1] || 'dark';
      pushImport("import { TamaguiProvider } from 'tamagui';");
      pushImport(tamaguiCfg[1] ? `import { ${cfgVar} } from '${cfgPath}';` : `import ${cfgVar} from '${cfgPath}';`);
      appendWrapper(`<TamaguiProvider config={${cfgVar}} defaultTheme="${theme}">`, '</TamaguiProvider>');
    }

    if (appContent.includes('SafeAreaProvider')) {
      pushImport("import { SafeAreaProvider } from 'react-native-safe-area-context';");
      wrapOpen = `<SafeAreaProvider>${wrapOpen}`;
      wrapClose = `${wrapClose}</SafeAreaProvider>`;
    }

    if (appContent.includes('NavigationContainer')) {
      pushImport("import { NavigationContainer } from '@react-navigation/native';");
      pushImport("import { NavigationIndependentTree } from '@react-navigation/core';");
      const tamaguiIdx = wrapOpen.indexOf('<TamaguiProvider');
      if (tamaguiIdx >= 0) {
        wrapOpen = `${wrapOpen.slice(0, tamaguiIdx)}<NavigationContainer><NavigationIndependentTree>${wrapOpen.slice(tamaguiIdx)}`;
        const tamaguiCloseIdx = wrapClose.indexOf('</TamaguiProvider>');
        if (tamaguiCloseIdx >= 0) {
          wrapClose = `${wrapClose.slice(0, tamaguiCloseIdx + '</TamaguiProvider>'.length)}</NavigationIndependentTree></NavigationContainer>${wrapClose.slice(tamaguiCloseIdx + '</TamaguiProvider>'.length)}`;
        }
      } else {
        wrapOpen = `<NavigationContainer><NavigationIndependentTree>${wrapOpen}`;
        wrapClose = `${wrapClose}</NavigationIndependentTree></NavigationContainer>`;
      }
    }

    if (appContent.includes('GalleryProvider')) {
      const galleryImportLine = contextFiles
        .flatMap((f) => f.content.split('\n'))
        .find((line) => line.includes('GalleryProvider') && line.trimStart().startsWith('import'));
      if (galleryImportLine) {
        const pathMatch = galleryImportLine.match(/from\s+['"]([^'"]+)['"]/);
        if (pathMatch) {
          const galleryPath = pathMatch[1];
          const hasLightbox = appContent.includes('GalleryLightbox');
          if (hasLightbox) {
            pushImport(`import { GalleryProvider, GalleryLightbox } from '${galleryPath}';`);
            appendWrapper('<GalleryProvider>', '<GalleryLightbox /></GalleryProvider>');
          } else {
            pushImport(`import { GalleryProvider } from '${galleryPath}';`);
            appendWrapper('<GalleryProvider>', '</GalleryProvider>');
          }
        }
      }
    }

    if (imports.length === 0) {
      // None of the known providers above matched. Fall back to replicating
      // whatever provider element(s) wrap <App/> in the entry render tree so a
      // component-library app (mantine / nextui / a local ThemeProvider, …)
      // renders inside its real providers instead of crashing on a missing one
      // (HYP-782 — the blank-preview wedge for provider-heavy unsupported-CSS apps).
      return detectAppEntryProviderWrap(root, previewDir, contextFiles);
    }
    return { imports, wrapOpen, wrapClose };
  } catch {
    return undefined;
  }
}

// ============================================================================
// Generic entry-render provider replication (HYP-782)
//
// The hardcoded detectors above cover a fixed set of providers (emotion /
// styled-components / Tamagui / react-navigation / Gallery). Component-library
// apps wrap <App/> in main.tsx with a provider those detectors don't know —
// MantineProvider (mantine), NextUIProvider (nextui), a local ThemeProvider
// (vanilla-extract) — so the isolated preview dropped the provider and the app
// crashed, leaving a blank iframe (isPreviewLoaded false, no readonly Continue).
//
// This fallback walks the single-child JSX chain of the entry's ReactDOM mount
// (`createRoot(...).render(<…><App/></…>)`) and replicates the wrapping provider
// elements FAITHFULLY: the original opening tag (with its attributes) is kept and
// every identifier those attributes reference is imported from the same module
// the entry used (rebased to the preview dir). When an attribute references
// something we can't import — a local `const queryClient = new QueryClient()`, a
// spread, a member/call expression — we BAIL (return undefined, i.e. no wrap),
// so a required-prop provider (react-redux <Provider store>, <QueryClientProvider
// client>) is never replicated with its prop dropped (which would throw and
// regress a currently-working preview). Theme/UI providers that tolerate their
// defaults (MantineProvider, NextUIProvider, …) still wrap with their resolvable
// attrs and render.
//
// Deliberately conservative — these stay "no wrap" (current behavior) rather
// than risk a wrong wrap, and can be follow-ups if a real project needs them:
//   - Only runs when the hardcoded detectors above found NOTHING, so a stack
//     that MIXES a known provider (emotion/styled) with an unknown one isn't
//     merged (the hardcoded path stays authoritative for its richer theme attrs).
//   - A provider referenced via a namespace import (`import * as X` → `<X.P>`)
//     is a member tag → not detected → bail.
//   - The first ReactDOM mount whose render tree is a clean provider→App chain
//     wins; an unrelated secondary `.render()` is only chosen if IT forms such a
//     chain (the injected `<CanvasPreviewComp/>` mount has no providers, so the
//     real App tree is picked — covered by a test).
// ============================================================================

/**
 * Render-only wrappers that must be SKIPPED, not replicated — they carry no
 * context a previewed component needs. They are still descended THROUGH (so an
 * inner provider is found), but excluded from the replicated wrap so their own
 * props (e.g. `Suspense`'s `fallback={<Spinner/>}`) never veto the inner
 * providers via the unresolvable-attribute bail.
 */
const NON_PROVIDER_WRAPPERS = new Set(['StrictMode', 'Fragment', 'Suspense', 'Profiler']);

/**
 * Try each candidate entry file (main.tsx / App.tsx, …) and return the first
 * provider wrap extracted from its render tree, or undefined when none wraps
 * <App/> in a replicable provider.
 */
function detectAppEntryProviderWrap(
  root: string,
  previewDir: string,
  contextFiles: ProviderContextFile[],
): ProviderWrapConfig | undefined {
  for (const file of contextFiles) {
    const wrap = extractEntryProviderWrap(file.content, file.relativePath, root, previewDir);
    if (wrap) return wrap;
  }
  return undefined;
}

function extractEntryProviderWrap(
  content: string,
  sourceRelativePath: string,
  root: string,
  previewDir: string,
): ProviderWrapConfig | undefined {
  let ast: t.File;
  try {
    ast = babelParse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: true });
  } catch {
    return undefined;
  }
  const rebaseFrom = { ast, root, previewDir, sourceRelativePath };
  for (const renderArg of collectRenderJSXArguments(ast)) {
    const chain = collectRenderElementChain(renderArg);
    // Need at least one wrapping provider PLUS the inner app element it wraps.
    if (!chain || chain.length < 2) continue;
    const providers = chain.slice(0, -1).filter(isReplicableProviderElement);
    if (providers.length === 0) continue;
    const wrap = buildProviderWrap(providers, content, rebaseFrom);
    if (wrap) return wrap;
  }
  return undefined;
}

function isReplicableProviderElement(element: t.JSXElement): boolean {
  const name = jsxTagName(element.openingElement.name);
  // Self-closing elements wrap no children, so they can't be a provider around
  // <App/> — guard against ever emitting a stray `</Name>` for one.
  if (name === null || element.openingElement.selfClosing) return false;
  return /^[A-Z]/.test(name) && !NON_PROVIDER_WRAPPERS.has(name);
}

interface RebaseContext {
  ast: t.File;
  root: string;
  previewDir: string;
  sourceRelativePath: string;
}

/**
 * Build imports + wrapOpen/wrapClose for an outer→inner list of provider
 * elements, keeping each element's original opening tag and importing the
 * provider plus any identifier its attributes reference. Returns undefined if
 * ANY provider — or an attribute it depends on — can't be resolved to an import,
 * so a provider whose required prop we'd have to drop is never replicated.
 */
function buildProviderWrap(
  providers: t.JSXElement[],
  content: string,
  ctx: RebaseContext,
): ProviderWrapConfig | undefined {
  const imports: string[] = [];
  let wrapOpen = '';
  let wrapClose = '';
  const addImport = (line: string) => {
    if (!imports.includes(line)) imports.push(line);
  };
  for (const element of providers) {
    const name = jsxTagName(element.openingElement.name) as string;
    const providerImport = resolveImportLine(name, ctx);
    if (!providerImport) return undefined;
    const attrImports = resolveAttributeImports(element.openingElement, ctx);
    if (attrImports === null) return undefined;
    const openTag = sliceOpeningTag(element.openingElement, content);
    if (openTag === null) return undefined;
    addImport(providerImport);
    for (const line of attrImports) addImport(line);
    wrapOpen += openTag;
    wrapClose = `</${name}>${wrapClose}`;
  }
  return imports.length > 0 ? { imports, wrapOpen, wrapClose } : undefined;
}

/** The verbatim source of a non-self-closing opening tag (e.g. `<MantineProvider theme={theme}>`), or null if unpositioned. */
function sliceOpeningTag(opening: t.JSXOpeningElement, content: string): string | null {
  if (typeof opening.start !== 'number' || typeof opening.end !== 'number') return null;
  return content.slice(opening.start, opening.end);
}

/**
 * Import lines for every identifier referenced in a provider's attributes, or
 * null when an attribute can't be safely replicated (a spread, or a value that
 * is not a literal / an importable identifier — e.g. an inline call or a local
 * const). String/boolean/numeric literal attributes need no import.
 */
function resolveAttributeImports(opening: t.JSXOpeningElement, ctx: RebaseContext): string[] | null {
  const lines: string[] = [];
  for (const attr of opening.attributes) {
    if (attr.type !== 'JSXAttribute') return null; // JSXSpreadAttribute — unresolvable
    const value = attr.value;
    if (value === null || value === undefined || value.type === 'StringLiteral') continue; // boolean / literal attr
    if (value.type !== 'JSXExpressionContainer') return null;
    const expr = value.expression;
    if (expr.type === 'StringLiteral' || expr.type === 'NumericLiteral' || expr.type === 'BooleanLiteral') continue;
    if (expr.type !== 'Identifier') return null; // member/call/object/template — can't safely re-create
    const importLine = resolveImportLine(expr.name, ctx);
    if (!importLine) return null; // local const / unresolvable → bail
    lines.push(importLine);
  }
  return lines;
}

/** Resolve the import line that brings `name` into the entry file (rebased to the preview dir), or null. */
function resolveImportLine(name: string, ctx: RebaseContext): string | null {
  for (const stmt of ctx.ast.program.body) {
    if (stmt.type !== 'ImportDeclaration') continue;
    const rebase = () => rebaseImportPath(ctx.root, ctx.previewDir, ctx.sourceRelativePath, stmt.source.value);
    for (const spec of stmt.specifiers) {
      if (spec.type === 'ImportSpecifier' && spec.local.name === name) {
        const importedName = spec.imported.type === 'Identifier' ? spec.imported.name : name;
        const clause = importedName === name ? name : `${importedName} as ${name}`;
        return `import { ${clause} } from '${rebase()}';`;
      }
      if (spec.type === 'ImportDefaultSpecifier' && spec.local.name === name) {
        return `import ${name} from '${rebase()}';`;
      }
    }
  }
  return null;
}

/** Collect the JSX argument of every ReactDOM mount call in the file. */
function collectRenderJSXArguments(ast: t.File): Array<t.JSXElement | t.JSXFragment> {
  const args: Array<t.JSXElement | t.JSXFragment> = [];
  walkAst(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    const renderArg = renderCallJSXArgument(node);
    if (renderArg) args.push(renderArg);
  });
  return args;
}

/**
 * The JSX argument of a ReactDOM mount call — `root.render(jsx)` /
 * `ReactDOM.render(jsx, …)` / `…hydrate(jsx, …)` (arg 0) or
 * `hydrateRoot(container, jsx)` (arg 1) — or null when this isn't such a call.
 */
function renderCallJSXArgument(call: t.CallExpression): t.JSXElement | t.JSXFragment | null {
  const callee = call.callee;
  let index = -1;
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
    if (callee.property.name === 'render' || callee.property.name === 'hydrate') index = 0;
  } else if (callee.type === 'Identifier' && callee.name === 'hydrateRoot') {
    index = 1;
  }
  if (index < 0) return null;
  const arg = call.arguments[index];
  return arg && (arg.type === 'JSXElement' || arg.type === 'JSXFragment') ? arg : null;
}

/**
 * Walk the single-child JSX chain from the render root down to its innermost
 * element, returning the JSXElements outer→inner (the innermost is the app
 * itself). Returns null when the structure isn't a clean single-child chain — a
 * leaf (0 JSX children) ends the chain, but >1 JSX children is ambiguous — so
 * only unambiguous provider stacks are ever replicated. Fragments are descended
 * through but not included.
 */
function collectRenderElementChain(node: t.JSXElement | t.JSXFragment): t.JSXElement[] | null {
  const elements: t.JSXElement[] = [];
  let current: t.JSXElement | t.JSXFragment = node;
  for (;;) {
    if (current.type === 'JSXFragment') {
      const kids = jsxElementChildren(current);
      if (kids.length !== 1) return null;
      current = kids[0];
      continue;
    }
    elements.push(current);
    const kids = jsxElementChildren(current);
    if (kids.length === 0) break;
    if (kids.length > 1) return null;
    current = kids[0];
  }
  return elements;
}

/**
 * Element-or-fragment children, ignoring JSXText/whitespace and expression
 * containers. Fragments are INCLUDED (not dropped) so the chain walk can descend
 * THROUGH a `<>…</>` inserted between a provider and <App/> — e.g.
 * `<MantineProvider><><App/></></MantineProvider>` — instead of stopping at the
 * provider and treating it as the leaf (which dropped the provider entirely).
 */
function jsxElementChildren(node: t.JSXElement | t.JSXFragment): Array<t.JSXElement | t.JSXFragment> {
  return node.children.filter(
    (child): child is t.JSXElement | t.JSXFragment => child.type === 'JSXElement' || child.type === 'JSXFragment',
  );
}

/** Element tag name for a simple `<Identifier>`; null for member/namespaced tags (e.g. `React.StrictMode`). */
function jsxTagName(name: t.JSXOpeningElement['name']): string | null {
  return name.type === 'JSXIdentifier' ? name.name : null;
}

/** Depth-first visit of every AST node (generic key-walk; position/comment keys skipped). */
function walkAst(node: t.Node, visit: (n: t.Node) => void): void {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' || key === 'trailingComments') {
      continue;
    }
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (isAstNode(child)) walkAst(child, visit);
      }
    } else if (isAstNode(value)) {
      walkAst(value, visit);
    }
  }
}

function isAstNode(value: unknown): value is t.Node {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

export async function detectSSRMockConfig(root: string): Promise<SSRMockConfig | undefined> {
  try {
    const { framework } = await detectFramework(root, new VSCodeFileIO());
    return framework === 'remix' ? { framework: 'remix' } : undefined;
  } catch {
    return undefined;
  }
}

async function detectFrontendRoot(root: string): Promise<string> {
  try {
    const html = await readFile(join(root, 'index.html'), 'utf-8'); // nosemgrep: path-join-resolve-traversal
    // HTML tag names are case-insensitive — match `<SCRIPT>`/`<Script>` too
    // (CodeQL js/bad-tag-filter). Regex HTML parsing is a smell; this only
    // sniffs the module entry script to detect the frontend root dir.
    for (const scriptTag of html.matchAll(/<script\b([^>]*)>/gi)) {
      const attrs = scriptTag[1];
      if (!/\btype=["']module["']/i.test(attrs)) continue;
      const srcMatch = attrs.match(/\bsrc=["']\/([^/"']+)\/main\.[jt]sx?["']/i);
      if (srcMatch && srcMatch[1] !== 'src') return srcMatch[1];
    }
  } catch {
    /* no index.html */
  }
  return 'src';
}

async function getPreviewDir(root: string): Promise<string> {
  try {
    await access(join(root, 'apps/next')); // nosemgrep: path-join-resolve-traversal
    return join(root, 'apps/next'); // nosemgrep: path-join-resolve-traversal
  } catch {
    const frontendRoot = await detectFrontendRoot(root);
    return join(root, frontendRoot); // nosemgrep: path-join-resolve-traversal
  }
}

async function readProviderContextFiles(root: string): Promise<ProviderContextFile[]> {
  const result: ProviderContextFile[] = [];
  const frontendRoot = await detectFrontendRoot(root);
  const rootPrefixes = frontendRoot !== 'src' ? [frontendRoot, 'src'] : ['src'];
  const fileNames = ['main.tsx', 'main.ts', 'App.web.tsx', 'App.tsx', 'app.tsx'];
  const candidates = [
    ...rootPrefixes.flatMap((r) => fileNames.map((f) => `${r}/${f}`)),
    'App.web.tsx',
    'App.tsx',
    'main.tsx',
    'main.ts',
  ];

  const seen = new Set<string>();
  for (const relativePath of candidates) {
    if (seen.has(relativePath)) continue;
    seen.add(relativePath);
    try {
      const content = await readFile(join(root, relativePath), 'utf-8'); // nosemgrep: path-join-resolve-traversal
      result.push({ relativePath, content });
    } catch {
      /* file doesn't exist — try next */
    }
  }
  return result;
}

function findThemeProvider(
  files: ProviderContextFile[],
  packageName: '@emotion/react' | 'styled-components',
): { file: ProviderContextFile; themeImport: ThemeImport } | null {
  const escapedPackageName = packageName.replace('/', '\\/');
  const providerImport = new RegExp(`import\\s+[^;]*\\bThemeProvider\\b[^;]*from\\s+['"]${escapedPackageName}['"]`); // nosemgrep: detect-non-literal-regexp -- escaped constrained package-name literal, not user input

  for (const file of files) {
    if (!providerImport.test(file.content)) continue;
    const themeImport = extractThemeImport(file.content);
    if (themeImport) return { file, themeImport };
  }
  return null;
}

function extractThemeImport(source: string): ThemeImport | null {
  const namedImport = source.match(/import\s+\{([^}]*\btheme\b[^}]*)\}\s+from\s+['"]([^'"]+)['"]/);
  if (namedImport) {
    const spec = namedImport[1]
      .split(',')
      .map((part) => part.trim())
      .find((part) => part === 'theme' || part.startsWith('theme as '));
    if (spec) {
      const alias = spec.match(/^theme\s+as\s+(\w+)$/);
      return {
        importPath: namedImport[2],
        importedName: 'theme',
        localName: alias?.[1] ?? 'theme',
        defaultImport: false,
      };
    }
  }

  const defaultImport = source.match(/import\s+(\w+)\s+from\s+['"]([^'"]*theme[^'"]*)['"]/);
  if (defaultImport) {
    return {
      importPath: defaultImport[2],
      importedName: defaultImport[1],
      localName: defaultImport[1],
      defaultImport: true,
    };
  }

  return null;
}

function buildThemeImport(
  root: string,
  previewDir: string,
  file: ProviderContextFile,
  themeImport: ThemeImport,
): string {
  const importPath = rebaseImportPath(root, previewDir, file.relativePath, themeImport.importPath);
  if (themeImport.defaultImport) {
    return `import ${themeImport.localName} from '${importPath}';`;
  }
  const spec =
    themeImport.importedName === themeImport.localName
      ? themeImport.importedName
      : `${themeImport.importedName} as ${themeImport.localName}`;
  return `import { ${spec} } from '${importPath}';`;
}

function rebaseImportPath(root: string, previewDir: string, sourceRelativePath: string, importPath: string): string {
  if (!importPath.startsWith('.')) return importPath;
  const absImportPath = resolve(dirname(join(root, sourceRelativePath)), importPath);
  let rebased = relative(previewDir, absImportPath);
  if (!rebased.startsWith('.')) rebased = `./${rebased}`;
  return rebased.replace(/\\/g, '/');
}
