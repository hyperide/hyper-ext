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
import { detectI18nBinding, resolveCalleeOriginAtLocation } from '@shared/i18n-text/detect-i18n-binding';
import { detectI18nPackage } from '@shared/i18n-text/detect-i18n-package';
import { resolveI18nByDomText } from '@shared/i18n-text/resolve-by-dom-text';
import { discoverLayout, resolveI18nResource } from '@shared/i18n-text/resolve-i18n-resource';
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
      let { childrenType, textContent } = analyzeJSXChildren(element);

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
  async getAvailableKeys(namespace: string | undefined, activeLocale: string): Promise<string[]> {
    try {
      const stub: I18nTextBinding = {
        kind: 'i18n',
        library: 'custom',
        key: '',
        namespace,
        activeLocale,
        availableLocales: [],
        resolvedText: null,
        editable: false,
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
    if (library === null) {
      const calleeResult = resolveCalleeOriginAtLocation(content, exprLoc);
      if (calleeResult && calleeResult.origin.kind !== 'unknown') {
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

    // Also detect namespaced custom layouts: locales/{locale}/{namespace}.json
    // discoverLayout skips this branch when namespace is undefined, so probe separately.
    if (library === null && this._fileIO.listFiles) {
      const localesDir = `${this._workspaceRoot}/locales`;
      const namespacedFiles = await this._fileIO.listFiles(localesDir, ['.json']).catch(() => []);
      const prefix = `${localesDir}/`;
      const hasNamespacedFiles = namespacedFiles.some((f) => {
        const rel = f.slice(prefix.length);
        return rel.split('/').length === 2;
      });
      if (hasNamespacedFiles) {
        library = 'custom';
        confidence = confidence ?? 'locale-heuristic';
      }
    }

    // AST detection: is the expression a known i18n call?
    const detection = detectI18nBinding({
      source: content,
      filePath,
      location: exprLoc,
      library,
    });

    if (detection.kind === 'unsupported') {
      // Fallback: search locale files by the rendered DOM text.
      // Handles dynamic keys like {t(someVar)} where AST detection cannot resolve the key at build time.
      if (domTextContent) {
        const domMatch = await resolveI18nByDomText(domTextContent, this._workspaceRoot, this._fileIO).catch(
          () => null,
        );
        if (domMatch) {
          const binding: I18nTextBinding = {
            kind: 'i18n',
            library: library ?? 'custom',
            key: domMatch.key,
            namespace: domMatch.namespace,
            activeLocale: domMatch.locale,
            availableLocales: domMatch.availableLocales,
            resolvedText: domMatch.resolvedText,
            editable: true,
            sourceLocation: { filePath, line: exprLoc.line, column: exprLoc.column },
            confidence: 'locale-heuristic',
          };
          return binding;
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
      // editable=true whenever the user can persist a translation. This includes the case
      // where the active locale file is missing the key (`missing-key`) — typing should
      // create the entry under the active locale. Only block when the underlying file
      // cannot be safely written (missing-locale-file / parse-error / unsupported-format).
      editable: resolved.unresolvedReason === undefined || resolved.unresolvedReason === 'missing-key',
      sourceLocation: {
        filePath,
        line: detection.sourceLocation.line,
        column: detection.sourceLocation.column,
      },
      confidence,
    };
    return binding;
  }
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
