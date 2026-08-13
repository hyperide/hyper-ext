/**
 * @file StyleReadService reads inspector style metadata from JSX source
 *
 * Accessed via: VS Code right panel inspector when an element is selected
 * Assumptions: selected nodeRefs resolve to JSX source locations through NodeMapService
 *   or React fiber synthetic refs; DOM computed style is unavailable in the extension host.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

import * as t from '@babel/types';
import { getCssModuleClassReferences, getCssModuleImportBindings } from '@lib/ast/css-module-references';
import type { FileIO } from '@lib/ast/file-io';
import { getAttribute, getAttributeStaticClassName, getAttributeString } from '@lib/ast/mutator';
import { parseCode } from '@lib/ast/parser';
import { findElementByPosition } from '@lib/ast/position-finder';
import { analyzeJSXChildren, getChildrenLocation, getJSXTagName } from '@lib/ast/traverser';
import type { NodeMapService } from '@lib/element-tracing/node-map-service';
import { createDefaultStyleReadManager } from '@lib/style-read/default-style-read-manager';
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
import { isBundleArtifactPath } from './bundle-artifact-path';
import { AdapterFactory } from './i18n/AdapterFactory';
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
  private _fileIO: FileIO;
  private _nodeMapService: NodeMapService;
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
    const absolutePath = resolveWorkspacePath(this._workspaceRoot, componentPath);
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
          directPath = resolveWorkspacePath(this._workspaceRoot, m[1]);
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
      const styleReadResult = await this._styleReadManager.read({
        projectCapabilities: buildProjectCapabilities({ classNameExpression, styleAttribute }),
        elementFacts: buildElementFacts({
          tagName,
          classNameExpression,
          styleAttribute,
        }),
        runtimeThemeContext: DEFAULT_RUNTIME_THEME_CONTEXT,
        computedStyle: {},
        fiberTrace: {
          sourceLocation: {
            filePath,
            line: searchLine,
            column: searchColumn,
          },
          runtimeClasses: className ? className.split(/\s+/).filter(Boolean) : [],
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
      const stub: I18nTextBinding = {
        kind: 'i18n',
        library: library ?? 'custom',
        key: '',
        namespace,
        activeLocale,
        availableLocales: [],
        resolvedText: null,
        editable: false,
        writable: false,
        sourceLocation: { filePath: '', line: 0, column: 0 },
      };
      const adapter = await new AdapterFactory(this._workspaceRoot, this._fileIO).forBinding(stub, activeLocale);
      return adapter.getAvailableKeys(activeLocale);
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
    };
  }

  if (t.isCallExpression(value.expression)) {
    return {
      kind: 'call-expression',
      staticClasses,
      dynamic: true,
      cssModuleReferences: cssModuleReferenceFacts,
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

function buildElementFacts(input: {
  tagName: string;
  classNameExpression?: ClassNameExpressionFacts;
  styleAttribute?: StyleAttributeFacts;
}): ElementStyleFacts {
  const elementCssSystems = getCssSystems(input);

  return {
    elementCssSystems,
    elementUiKits: [],
    elementPropMappers: [],
    sourceOwners: [],
    classNameExpression: input.classNameExpression,
    styleAttribute: input.styleAttribute,
    componentFacts: { intrinsicElement: input.tagName },
    componentPropSurface: {
      acceptsClassName: true,
      acceptsStyle: true,
      acceptsCssProp: false,
      acceptsSxProp: false,
      recursivePropsSchemaAvailable: false,
      styleLikeProps: [],
      semanticProps: [],
    },
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
