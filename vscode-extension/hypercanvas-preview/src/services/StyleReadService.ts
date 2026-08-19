/**
 * @file StyleReadService reads inspector style metadata from JSX source
 *
 * Accessed via: VS Code right panel inspector when an element is selected
 * Assumptions: selected nodeRefs resolve to JSX source locations through NodeMapService
 *   or React fiber synthetic refs; DOM computed style is unavailable in the extension host.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

import * as fsSync from 'node:fs';
import * as nodePath from 'node:path';
import * as t from '@babel/types';
import { getCssModuleClassReferences, getCssModuleImportBindings } from '@lib/ast/css-module-references';
import type { FileIO } from '@lib/ast/file-io';
import {
  getAttribute,
  getAttributeClassSegments,
  getAttributeStaticClassName,
  getAttributeString,
} from '@lib/ast/mutator';
import { parseCode } from '@lib/ast/parser';
import { findElementByPosition } from '@lib/ast/position-finder';
import { buildAliasMapFromTsconfig } from '@lib/ast/tsconfig-alias-map';
import { analyzeJSXChildren, getChildrenLocation, getJSXTagName } from '@lib/ast/traverser';
import type { NodeMapService } from '@lib/element-tracing/node-map-service';
import { createDefaultStyleReadManager } from '@lib/style-read/default-style-read-manager';
import { detectForwarding, projectForwardDetectionToPropSurface } from '@lib/style-read/forward-detect';
import type {
  ClassNameExpressionFacts,
  CssSystemId,
  ElementStyleFacts,
  ProjectStyleCapabilities,
  RuntimeThemeContext,
  StyleReadResult as SharedStyleReadResult,
  StyleAttributeFacts,
  StyleReadManager,
} from '@lib/style-read/types';
import type { NodeRef } from '@shared/element-tracing/types';
import type { CalleeOrigin } from '@shared/i18n-text/detect-i18n-binding';
import { detectI18nBinding, resolveCalleeOriginAtLocation } from '@shared/i18n-text/detect-i18n-binding';
import { detectI18nPackage } from '@shared/i18n-text/detect-i18n-package';
import { type DomTextI18nMatch, resolveI18nByDomText } from '@shared/i18n-text/resolve-by-dom-text';
import { FLAT_LOCALE_DIRS, discoverLayout, resolveI18nResource } from '@shared/i18n-text/resolve-i18n-resource';
import type { I18nBindingResult, I18nLibrary, I18nTextBinding, PackageJsonDeps } from '@shared/i18n-text/types';
import { listKeysForBinding } from '@shared/i18n-text/adapters/registry';
import { isBundleArtifactPath } from './bundle-artifact-path';
import { resolveWorkspacePath } from './workspace-path';

export interface ElementStyleReadResult {
  className: string;
  childrenType: 'text' | 'expression' | 'expression-complex' | 'jsx' | undefined;
  textContent: string;
  tagType: string;
  childrenLocation?: { line: number; column: number };
  styleReadResult?: SharedStyleReadResult;
  i18nText?: I18nBindingResult;
}

const DEFAULT_RUNTIME_THEME_CONTEXT: RuntimeThemeContext = {
  ideThemePreference: 'light',
  resolvedColorScheme: 'light',
  source: 'vscode',
};

// Reuse the shared directory list from resolve-i18n-resource so this probe and discoverLayout
// never drift. Covers the namespace-undefined case: discoverLayout only scans namespaced layouts
// ({dir}/{locale}/{namespace}.json) when namespace is known, so we probe here for the case where
// no namespace was resolved yet. Uses FLAT_LOCALE_DIRS to include public/locales, src/locales, etc.

export class StyleReadService {
  private _workspaceRoot: string;
  /**
   * HYP-1012 monorepo follow-up — widens the containment allowlist (see
   * `resolveWorkspacePath`'s `additionalRoots`) to also accept sibling sub-project paths
   * outside the opened leaf `_workspaceRoot`, mirroring `AstService.setAdditionalWorkspaceRoot`.
   * Set by `PanelRouter.getComponentGroups`'s `monorepoRoot` discovery.
   */
  private _additionalWorkspaceRoot?: string;
  private _fileIO: FileIO;
  private _nodeMapService: NodeMapService;
  // HYP-1229 A1 forward-detector — tsconfig path-alias map, cached per tsconfig directory so
  // repeated reads in the same project don't re-parse the config. Mirrors AstService._loadAliasMap.
  private readonly _aliasMapCache = new Map<string, Record<string, string>>();
  private _styleReadManager: StyleReadManager;
  // package.json doesn't change during a session — cache detection result after first read
  private _cachedI18nLibrary: ReturnType<typeof detectI18nPackage> | undefined = undefined;
  private _i18nLibraryResolved = false;

  constructor(
    workspaceRoot: string,
    fileIO: FileIO,
    nodeMapService: NodeMapService,
    styleReadManager: StyleReadManager = createDefaultStyleReadManager(),
  ) {
    this._workspaceRoot = workspaceRoot;
    this._fileIO = fileIO;
    this._nodeMapService = nodeMapService;
    this._styleReadManager = styleReadManager;
  }

  /** See `_additionalWorkspaceRoot`. Set `null` to narrow back to just `_workspaceRoot`. */
  setAdditionalWorkspaceRoot(root: string | null): void {
    this._additionalWorkspaceRoot = root ?? undefined;
  }

  /**
   * Build the tsconfig path-alias map for the project owning `importerFilePath`, for the A1
   * forward-detector's cross-file component resolution. Walks up from the importer's directory
   * to the workspace root, using the nearest `tsconfig.json` that declares `compilerOptions.paths`
   * — mirrors `AstService._loadAliasMap` (kept as a separate small copy rather than shared: each
   * service owns its own per-instance cache, and the two callers' failure modes differ enough
   * that a shared helper would need its own FileIO threading for no real benefit here).
   */
  private _loadAliasMap(importerFilePath: string): Record<string, string> {
    const root = this._workspaceRoot;
    let dir = nodePath.dirname(importerFilePath);

    // Path-SEGMENT containment (`dir === root` or `dir` starts with `root + sep`), not a bare
    // string prefix — `startsWith(root)` alone would also admit a sibling directory that merely
    // shares `root` as a text prefix (e.g. root `/ws/app` matching dir `/ws/app-2`).
    while (dir === root || dir.startsWith(root + nodePath.sep)) {
      const cached = this._aliasMapCache.get(dir);
      if (cached) return cached;

      try {
        const source = fsSync.readFileSync(nodePath.join(dir, 'tsconfig.json'), 'utf8');
        const map = buildAliasMapFromTsconfig(source, dir);
        if (Object.keys(map).length > 0) {
          this._aliasMapCache.set(dir, map);
          return map;
        }
      } catch {
        // No tsconfig here (or no paths) — keep walking up.
      }

      const parent = nodePath.dirname(dir);
      if (parent === dir || dir === root) break;
      dir = parent;
    }

    return {};
  }

  /** Resolve + validate `filePath` against `_workspaceRoot` (widened by `_additionalWorkspaceRoot`). */
  private _resolvePath(filePath: string): string {
    return resolveWorkspacePath(
      this._workspaceRoot,
      filePath,
      undefined,
      this._additionalWorkspaceRoot ? [this._additionalWorkspaceRoot] : [],
    );
  }

  /**
   * Read className and metadata from an element in the AST.
   * Uses nodeRef (preferred) to resolve element by position.
   * @param activeLocale - when provided, resolve i18n text for this locale instead of the default.
   */
  async readElementClassName(
    componentPath: string,
    nodeRef?: NodeRef,
    domTextContent?: string,
    activeLocale?: string,
  ): Promise<ElementStyleReadResult> {
    const absolutePath = this._resolvePath(componentPath);
    const empty: ElementStyleReadResult = {
      className: '',
      childrenType: undefined,
      textContent: '',
      tagType: 'unknown',
    };

    try {
      if (!nodeRef) return empty;

      // Prefer lookup by real nodeRef (UUID from NodeMapService).
      // Fall back to resolving a syntheticRef (format: "fileName:line:column") via source location —
      // this is the format used by React 19 fiber-based refs where paths are relative Vite URLs.
      let entry = this._nodeMapService.resolveNodeRef(nodeRef);

      // Track parsed syntheticRef values for direct position lookup if NodeMapService is empty
      let directLine: number | null = null;
      let directColumn: number | null = null;
      let directPath: string | null = null;

      if (!entry) {
        const m = nodeRef.match(/^(.+):(\d+):(\d+)$/);
        if (m) {
          directLine = Number.parseInt(m[2], 10);
          directColumn = Number.parseInt(m[3], 10);
          directPath = this._resolvePath(m[1]);
          entry = this._nodeMapService.resolveSourceLocation({
            fileName: m[1],
            line: directLine,
            column: directColumn,
          });
        }
      }

      const searchLine = entry?.loc.line ?? directLine;
      const searchColumn = entry?.loc.column ?? directColumn;
      // NodeMapService empty and no syntheticRef — nothing to resolve
      if (searchLine === null || searchColumn === null) {
        console.warn('[HyperCanvas] Selection lost after HMR — element not found for nodeRef:', nodeRef);
        return empty;
      }

      const filePath = directPath ?? absolutePath;
      if (isBundleArtifactPath(filePath)) {
        return empty;
      }
      const content = await this._fileIO.readFile(filePath);
      const ast = parseCode(content);

      const result = findElementByPosition(ast, searchLine, searchColumn);
      if (!result) {
        console.warn(
          `[HyperCanvas] Selection lost after HMR — AST element not found at ${searchLine}:${searchColumn} for nodeRef:`,
          nodeRef,
        );
        return empty;
      }

      const element = result.element;

      // Extract className — prefer exact string, fall back to static parts from dynamic expressions
      const className = getAttributeString(element, 'className') ?? getAttributeStaticClassName(element) ?? '';
      const cssModuleReferences = getCssModuleClassReferences(element, getCssModuleImportBindings(ast, filePath));
      const classNameExpression = getClassNameExpressionFacts(element, className, cssModuleReferences);
      const styleAttribute = getStyleAttributeFacts(element);

      // Extract tag type
      const tagName = getJSXTagName(element);

      // Analyze children to determine childrenType and textContent
      const jsxChildren = analyzeJSXChildren(element);
      const { childrenType } = jsxChildren;
      let textContent = jsxChildren.textContent;

      // For input/textarea with no children, fall back to placeholder attribute
      if (!textContent && (tagName === 'input' || tagName === 'textarea')) {
        const placeholder = getAttributeString(element, 'placeholder');
        if (placeholder) {
          textContent = placeholder;
        }
      }

      // Get children location for "Go to code" navigation
      const childrenLoc = getChildrenLocation(element);
      const elementFacts = await buildElementFacts({
        tagName,
        classNameExpression,
        styleAttribute,
        ast,
        filePath,
        element,
        fileIO: this._fileIO,
        aliasMap: this._loadAliasMap(filePath),
        // HYP-1229 review finding — this is the INTERACTIVE read path (fires on every element
        // selection/hover), not the discrete write-path pre-check. Type corroboration only fires
        // when the AST trace is `low`, but that's the COMMON case (opaque hooks, intermediate
        // reassignment) and `ts.createProgram` is an uncached 300ms-2s cold build per
        // forward-detect-type.ts's own header — unconditionally allowing it here would stall
        // selection on an ambiguous custom component. Skip it until a shared LanguageService
        // cache lands (tracked follow-up); the AST trace alone still resolves the common
        // high-confidence cases (native tags, direct/deep attribute forwarding, rest-spread,
        // asChild/Slot, styled-components) correctly — only the LOW-confidence tail loses the
        // type-corroboration upgrade here, and low never blocks (admitted as probable).
        skipTypeCorroboration: true,
      });
      const styleReadResult = await this._styleReadManager.read({
        projectCapabilities: buildProjectCapabilities({ classNameExpression, styleAttribute }),
        elementFacts,
        runtimeThemeContext: DEFAULT_RUNTIME_THEME_CONTEXT,
        computedStyle: {},
        fiberTrace: {
          sourceLocation: {
            filePath,
            line: searchLine,
            column: searchColumn,
          },
          staticSourceClasses: className ? className.split(/\s+/).filter(Boolean) : [],
        },
      });

      const i18nText =
        childrenType === 'expression' || childrenType === 'expression-complex' || childrenType === 'jsx'
          ? await this._tryDetectI18n(element, filePath, content, domTextContent, activeLocale)
          : undefined;

      return {
        className,
        childrenType,
        textContent,
        tagType: tagName,
        childrenLocation: childrenLoc || undefined,
        styleReadResult,
        i18nText,
      };
    } catch (error) {
      console.error('[StyleReadService] Error reading element className:', error);
      return empty;
    }
  }

  /**
   * Fetch all available keys from the active locale file for the project.
   * Called after i18nText arrives (kind === 'i18n') to populate the key combobox.
   * Returns empty array on any error (missing layout, parse failure, etc.).
   *
   * @param namespace - optional namespace from the binding (for namespaced layouts)
   * @param activeLocale - active locale from the binding (used to pick the right file)
   */
  async getAvailableKeys(
    namespace: string | undefined,
    activeLocale: string,
    library?: I18nLibrary,
  ): Promise<string[]> {
    try {
      // 'custom' is not a structurally-gating library (it means "format unknown, infer from
      // files"); pass null so library-gated adapters (next-intl/react-intl/i18next) only claim
      // a file when the project actually uses that library.
      const registryLibrary = library && library !== 'custom' ? library : null;
      return await listKeysForBinding(activeLocale, {
        projectRoot: this._workspaceRoot,
        fileIO: this._fileIO,
        library: registryLibrary,
        namespace,
      });
    } catch {
      return [];
    }
  }

  /**
   * Try to detect and resolve an i18n binding from the first expression container child.
   * Returns undefined when no i18n expression is found or the expression is complex/unknown.
   * @param activeLocale - when provided, resolve using this locale instead of the default 'en'.
   */
  private async _tryDetectI18n(
    element: t.JSXElement,
    filePath: string,
    content: string,
    domTextContent?: string,
    activeLocale?: string,
  ): Promise<I18nBindingResult | undefined> {
    // Find the first non-empty JSXExpressionContainer child
    let exprLoc: { line: number; column: number } | null = null;
    for (const child of element.children) {
      if (t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression)) {
        const expr = child.expression;
        if (expr.loc) {
          exprLoc = { line: expr.loc.start.line, column: expr.loc.start.column };
          break;
        }
      }
    }
    // Also check for known i18n JSX component children (<FormattedMessage />, <Trans />)
    if (!exprLoc) {
      const JSX_I18N_NAMES = new Set(['FormattedMessage', 'Trans']);
      for (const child of element.children) {
        if (t.isJSXElement(child)) {
          const openingName = child.openingElement.name;
          const componentName = openingName.type === 'JSXIdentifier' ? openingName.name : null;
          if (componentName && JSX_I18N_NAMES.has(componentName) && child.loc) {
            exprLoc = { line: child.loc.start.line, column: child.loc.start.column };
            break;
          }
        }
      }
    }
    if (!exprLoc) return undefined;

    // Read package.json once per session to identify the i18n library in use
    if (!this._i18nLibraryResolved) {
      try {
        const pkgContent = await this._fileIO.readFile(`${this._workspaceRoot}/package.json`);
        const pkg = JSON.parse(pkgContent) as PackageJsonDeps;
        this._cachedI18nLibrary = detectI18nPackage(pkg);
      } catch {
        // No package.json or parse error — proceed with null (allows 'custom' detection)
      }
      this._i18nLibraryResolved = true;
    }
    let library: I18nLibrary | null = this._cachedI18nLibrary ?? null;
    let confidence: I18nTextBinding['confidence'] = library !== null ? 'package-json' : undefined;

    // Import-chain analysis: walk imports/destructures to identify custom i18n helpers.
    // Runs before locale-file heuristics so hook patterns (useLanguage, useTranslation) are
    // recognised even when locale files are absent or haven't been discovered yet.
    // Veto via isLikelyI18nOrigin: a callee origin that merely exists (kind !== 'unknown') is
    // not enough — `const { t } = useTheme()` destructures a `t` that has nothing to do with
    // i18n. Only accept origins whose hook name / import path looks like i18n so non-i18n hooks
    // destructuring `t` are not misclassified as custom i18n.
    if (library === null) {
      const calleeResult = resolveCalleeOriginAtLocation(content, exprLoc);
      if (calleeResult && isLikelyI18nOrigin(calleeResult.origin)) {
        library = 'custom';
        confidence = 'import-chain';
      }
    }

    // When no known library found, check if locale files exist — if so treat as custom i18n
    if (library === null) {
      const layout = await discoverLayout(this._workspaceRoot, undefined, 'en', this._fileIO).catch(() => null);
      if (layout && layout.availableLocales.length > 0) {
        library = 'custom';
        confidence = 'locale-heuristic';
      }
    }

    // Also detect namespaced custom layouts: {dir}/{locale}/{namespace}.json
    // discoverLayout skips this branch when namespace is undefined, so probe separately.
    // Probe every known locale dir, not just locales/ — dictionaries also live under
    // src/i18n/ and messages/, which the single-dir scan silently missed.
    if (library === null && this._fileIO.listFiles) {
      for (const relDir of FLAT_LOCALE_DIRS) {
        const localesDir = `${this._workspaceRoot}/${relDir}`;
        const namespacedFiles = await this._fileIO.listFiles(localesDir, ['.json']).catch(() => []);
        const prefix = `${localesDir}/`;
        const hasNamespacedFiles = namespacedFiles.some((f) => {
          const rel = f.slice(prefix.length);
          return rel.split('/').length === 2;
        });
        if (hasNamespacedFiles) {
          library = 'custom';
          confidence = confidence ?? 'locale-heuristic';
          break;
        }
      }
    }

    // For custom i18n, the dictionary is the source of truth. First find the
    // rendered DOM text as a dictionary value; custom wrappers can make the JSX
    // expression shape arbitrary, but the shown text still identifies a key/value pair.
    if (library === 'custom' && domTextContent) {
      const domMatch = await resolveI18nByDomText(domTextContent, this._workspaceRoot, this._fileIO).catch(() => null);
      if (domMatch) {
        return this._createBindingFromDomMatch(
          domMatch,
          library,
          activeLocale,
          { filePath, line: exprLoc.line, column: exprLoc.column },
          confidence ?? 'locale-heuristic',
        );
      }
    }

    const detection = detectI18nBinding({
      source: content,
      filePath,
      location: exprLoc,
      library,
    });

    if (library === 'custom') {
      if (detection.kind === 'unsupported') return detection;

      const requestedLocale = activeLocale ?? 'en';
      let resolved = await resolveI18nResource({
        projectRoot: this._workspaceRoot,
        library: detection.library,
        key: detection.key,
        namespace: detection.namespace,
        activeLocale: requestedLocale,
        fallbackLocale: activeLocale ? undefined : 'en-US',
        fileIO: this._fileIO,
      }).catch(() => null);

      if (
        !activeLocale &&
        resolved?.resolvedText === null &&
        resolved.availableLocales.length > 0 &&
        !resolved.availableLocales.includes('en')
      ) {
        resolved = await resolveI18nResource({
          projectRoot: this._workspaceRoot,
          library: detection.library,
          key: detection.key,
          namespace: detection.namespace,
          activeLocale: resolved.availableLocales[0],
          fileIO: this._fileIO,
        }).catch(() => resolved);
      }

      if (!resolved) {
        return { kind: 'unsupported', reason: 'missing-source-location' };
      }
      // resolvedText may be null; do not bail — see Gap C in plan
      // 2026-05-08-i18n-inspector-consistency. Bailing to 'unsupported' freezes the
      // inspector on the previous binding via the `i18nText ?? prev.i18nText` hook fallback.

      const binding: I18nTextBinding = {
        kind: 'i18n',
        library: detection.library,
        key: detection.key,
        namespace: detection.namespace,
        activeLocale: resolved.activeLocale,
        availableLocales: resolved.availableLocales,
        resolvedText: resolved.resolvedText,
        editable: resolved.writable,
        writable: resolved.writable,
        sourceLocation: {
          filePath,
          line: detection.sourceLocation.line,
          column: detection.sourceLocation.column,
        },
        confidence,
      };
      return binding;
    }

    if (detection.kind === 'unsupported') {
      if (domTextContent) {
        const domMatch = await resolveI18nByDomText(domTextContent, this._workspaceRoot, this._fileIO).catch(
          () => null,
        );
        if (domMatch) {
          return this._createBindingFromDomMatch(
            domMatch,
            library ?? 'custom',
            activeLocale,
            { filePath, line: exprLoc.line, column: exprLoc.column },
            'locale-heuristic',
          );
        }
      }
      return detection;
    }

    // Resolve locale resources to get translated text.
    // When activeLocale is explicitly provided by the panel (locale switcher), always honour it.
    // When not provided (initial load), fall back to 'en' then first available locale.
    const DEFAULT_LOCALE = 'en';
    const requestedLocale = activeLocale ?? DEFAULT_LOCALE;
    let resolved: Awaited<ReturnType<typeof resolveI18nResource>>;
    try {
      resolved = await resolveI18nResource({
        projectRoot: this._workspaceRoot,
        library: detection.library,
        key: detection.key,
        namespace: detection.namespace,
        activeLocale: requestedLocale,
        fallbackLocale: activeLocale ? undefined : 'en-US',
        fileIO: this._fileIO,
      });
    } catch {
      resolved = {
        availableLocales: [],
        activeLocale: requestedLocale,
        resolvedText: null,
        unresolvedReason: 'missing-locale-file',
        writable: false,
      };
    }

    // If the project has no 'en' locale and no explicit locale was requested, retry with the
    // first discovered locale so non-English-primary projects still show resolved text.
    if (
      !activeLocale &&
      resolved.resolvedText === null &&
      resolved.availableLocales.length > 0 &&
      !resolved.availableLocales.includes(DEFAULT_LOCALE)
    ) {
      try {
        resolved = await resolveI18nResource({
          projectRoot: this._workspaceRoot,
          library: detection.library,
          key: detection.key,
          namespace: detection.namespace,
          activeLocale: resolved.availableLocales[0],
          fileIO: this._fileIO,
        });
      } catch {
        // keep original resolved
      }
    }

    const binding: I18nTextBinding = {
      kind: 'i18n',
      library: detection.library,
      key: detection.key,
      namespace: detection.namespace,
      activeLocale: resolved.activeLocale,
      availableLocales: resolved.availableLocales,
      resolvedText: resolved.resolvedText,
      editable: resolved.writable,
      writable: resolved.writable,
      sourceLocation: {
        filePath,
        line: detection.sourceLocation.line,
        column: detection.sourceLocation.column,
      },
      confidence,
    };
    return binding;
  }

  /**
   * Build an i18n binding starting from a DOM-text dictionary lookup.
   *
   * Re-resolves via `resolveI18nResource` using the locale the panel asked for
   * (`requestedLocale`), so the inspector reflects the user-selected locale rather
   * than whichever locale the DOM-text scan happened to land on first. Falls back
   * to `domMatch.resolvedText` only when the requested locale equals the DOM-match
   * locale; otherwise honours `resolved.resolvedText` (which may be `null` when the
   * key is missing in the requested locale — the inspector handles null by showing
   * an empty input).
   *
   * On resolver failure (`resolved === null`, e.g. file I/O error) `editable`/`writable`
   * default to `false` — fail closed rather than offer a write UI we cannot back.
   * `availableLocales` falls back to the DOM-match list when the resolver returns an
   * empty array (the catch-arm of `resolveI18nResource` produces `[]`).
   */
  private async _createBindingFromDomMatch(
    domMatch: DomTextI18nMatch,
    library: I18nLibrary,
    requestedLocale: string | undefined,
    sourceLocation: { filePath: string; line: number; column: number },
    confidence: I18nTextBinding['confidence'],
  ): Promise<I18nTextBinding> {
    const targetLocale = requestedLocale ?? domMatch.locale;
    const resolved = await resolveI18nResource({
      projectRoot: this._workspaceRoot,
      library,
      key: domMatch.key,
      namespace: domMatch.namespace,
      activeLocale: targetLocale,
      fileIO: this._fileIO,
    }).catch(() => null);

    // When requested locale matches the DOM-text locale, prefer the DOM-text resolved
    // value (already known to render in the live DOM). When they differ, the panel is
    // asking for a switch — pass through whatever the dictionary lookup returns, even
    // if that is null (locale missing the key).
    const resolvedText = resolved?.resolvedText ?? (targetLocale === domMatch.locale ? domMatch.resolvedText : null);

    // resolveI18nResource's catch path produces availableLocales: [] — `??` would pass
    // it through, leaving the inspector with no locale buttons even though the DOM scan
    // already discovered them. Fall back on empty.
    const availableLocales =
      resolved?.availableLocales && resolved.availableLocales.length > 0
        ? resolved.availableLocales
        : domMatch.availableLocales;

    // resolved === null means the resolver crashed — we don't know if writes are safe.
    // Fail closed: only mark writable when the resolver explicitly says so.
    const writable = resolved?.writable ?? false;

    return {
      kind: 'i18n',
      library,
      key: domMatch.key,
      namespace: domMatch.namespace,
      activeLocale: resolved?.activeLocale ?? targetLocale,
      availableLocales,
      resolvedText,
      editable: writable,
      writable,
      sourceLocation,
      confidence,
    };
  }
}

/**
 * Veto for the import-chain detection gate. A resolved callee origin (kind !== 'unknown')
 * only proves the `t` symbol came from *somewhere*, not that the somewhere is i18n. Accept
 * the origin as custom-i18n only when its hook name or import path looks i18n-related, so a
 * `const { t } = useTheme()` is not mistaken for a translation helper.
 */
function isLikelyI18nOrigin(origin: CalleeOrigin): boolean {
  if (origin.kind === 'hook-destructure') {
    return /i18n|translation|intl|locale|language|trans|lingui/i.test(origin.hookName ?? '');
  }
  if (origin.kind === 'import') {
    return /i18n|intl|locale|translation|lang|message|lingui/i.test(origin.importFrom ?? '');
  }
  return false;
}

function getClassNameExpressionFacts(
  element: t.JSXElement,
  staticClassName: string,
  cssModuleReferences: ClassNameExpressionFacts['cssModuleReferences'],
): ClassNameExpressionFacts | undefined {
  const value = getAttribute(element, 'className');
  if (!value) return undefined;

  const staticClasses = staticClassName.split(/\s+/).filter(Boolean);
  const cssModuleReferenceFacts =
    cssModuleReferences && cssModuleReferences.length > 0 ? cssModuleReferences : undefined;

  // Split static fragments into unconditionally-present (literal args / template quasis) vs
  // conditional-branch classes so readers can surface per-class confidence.
  const segments = getAttributeClassSegments(element) ?? [];
  const splitClasses = (predicate: (segment: { certain: boolean }) => boolean): string[] =>
    segments
      .filter(predicate)
      .flatMap((segment) => segment.value.split(/\s+/))
      .filter(Boolean);
  const staticLiteralClasses = splitClasses((segment) => segment.certain);
  const dynamicBranchClasses = splitClasses((segment) => !segment.certain);

  if (t.isStringLiteral(value)) {
    return {
      kind: 'literal',
      staticClasses,
      dynamic: false,
      cssModuleReferences: cssModuleReferenceFacts,
    };
  }

  if (!t.isJSXExpressionContainer(value) || t.isJSXEmptyExpression(value.expression)) {
    return {
      kind: 'unknown',
      staticClasses,
      dynamic: true,
      cssModuleReferences: cssModuleReferenceFacts,
    };
  }

  if (t.isTemplateLiteral(value.expression)) {
    return {
      kind: 'template',
      staticClasses,
      dynamic: true,
      cssModuleReferences: cssModuleReferenceFacts,
      staticLiteralClasses,
      dynamicBranchClasses,
    };
  }

  if (t.isCallExpression(value.expression)) {
    return {
      kind: 'call-expression',
      staticClasses,
      dynamic: true,
      cssModuleReferences: cssModuleReferenceFacts,
      staticLiteralClasses,
      dynamicBranchClasses,
    };
  }

  if (t.isMemberExpression(value.expression)) {
    return {
      kind: 'member-expression',
      staticClasses,
      dynamic: true,
      cssModuleReferences: cssModuleReferenceFacts,
    };
  }

  return {
    kind: 'unknown',
    staticClasses,
    dynamic: true,
    cssModuleReferences: cssModuleReferenceFacts,
  };
}

function getStyleAttributeFacts(element: t.JSXElement): StyleAttributeFacts | undefined {
  const value = getAttribute(element, 'style');
  if (!value) return undefined;

  if (!t.isJSXExpressionContainer(value) || t.isJSXEmptyExpression(value.expression)) {
    return {
      kind: 'unknown',
      hasSpread: false,
    };
  }

  if (t.isObjectExpression(value.expression)) {
    return {
      kind: 'object-literal',
      hasSpread: value.expression.properties.some((property) => t.isSpreadElement(property)),
    };
  }

  if (t.isIdentifier(value.expression)) {
    return {
      kind: 'identifier',
      hasSpread: false,
    };
  }

  return {
    kind: 'unknown',
    hasSpread: false,
  };
}

function buildProjectCapabilities(input: {
  classNameExpression?: ClassNameExpressionFacts;
  styleAttribute?: StyleAttributeFacts;
}): ProjectStyleCapabilities {
  return {
    projectCssSystems: getCssSystems(input),
    projectUiKits: [],
    componentPropMappers: [],
    cssSyntaxes: ['css'],
    projectThemeCapabilities: { axes: [], mechanisms: [], tokenSources: [] },
    packageEvidence: [],
    configEvidence: [],
    sourceEvidence: [],
  };
}

async function buildElementFacts(input: {
  tagName: string;
  classNameExpression?: ClassNameExpressionFacts;
  styleAttribute?: StyleAttributeFacts;
  ast: t.File;
  filePath: string;
  element: t.JSXElement;
  fileIO: FileIO;
  aliasMap: Record<string, string>;
  skipTypeCorroboration?: boolean;
}): Promise<ElementStyleFacts> {
  const elementCssSystems = getCssSystems(input);
  const forwardDetection = await detectForwarding({
    ast: input.ast,
    filePath: input.filePath,
    element: input.element,
    fileIO: input.fileIO,
    aliasMap: input.aliasMap,
    skipTypeCorroboration: input.skipTypeCorroboration,
  });

  return {
    elementCssSystems,
    elementUiKits: [],
    elementPropMappers: [],
    sourceOwners: [],
    classNameExpression: input.classNameExpression,
    styleAttribute: input.styleAttribute,
    componentFacts: { intrinsicElement: input.tagName },
    forwardDetection,
    componentPropSurface: projectForwardDetectionToPropSurface(forwardDetection),
  };
}

function getCssSystems(input: {
  classNameExpression?: ClassNameExpressionFacts;
  styleAttribute?: StyleAttributeFacts;
}): CssSystemId[] {
  const systems: CssSystemId[] = [];
  const cssModuleReferences = input.classNameExpression?.cssModuleReferences ?? [];
  const hasCssModules = cssModuleReferences.length > 0;
  const hasTailwindClasses =
    input.classNameExpression &&
    (input.classNameExpression.staticClasses.length > 0 || (!hasCssModules && input.classNameExpression.dynamic));

  if (hasTailwindClasses) systems.push('tailwind-v4');
  if (hasCssModules) systems.push('css-modules');
  if (input.styleAttribute) systems.push('inline-style');
  return systems;
}
