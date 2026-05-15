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

export interface ElementStyleReadResult {
  className: string;
  childrenType: 'text' | 'expression' | 'expression-complex' | 'jsx' | undefined;
  textContent: string;
  tagType: string;
  childrenLocation?: { line: number; column: number };
  styleReadResult?: SharedStyleReadResult;
}

const DEFAULT_RUNTIME_THEME_CONTEXT: RuntimeThemeContext = {
  ideThemePreference: 'system',
  resolvedColorScheme: 'light',
  source: 'vscode',
};

export class StyleReadService {
  private _workspaceRoot: string;
  private _fileIO: FileIO;
  private _nodeMapService: NodeMapService;
  private _styleReadManager: StyleReadManager;

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
   * Resolve file path to absolute path
   */
  private _resolvePath(filePath: string): string {
    if (filePath.startsWith('/')) {
      return filePath;
    }
    return `${this._workspaceRoot}/${filePath}`;
  }

  /**
   * Read className and metadata from an element in the AST.
   * Uses nodeRef (preferred) to resolve element by position.
   */
  async readElementClassName(
    _elementId: string,
    componentPath: string,
    nodeRef?: NodeRef,
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

      return {
        className,
        childrenType,
        textContent,
        tagType: tagName,
        childrenLocation: childrenLoc || undefined,
        styleReadResult,
      };
    } catch (error) {
      console.error('[StyleReadService] Error reading element className:', error);
      return empty;
    }
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
