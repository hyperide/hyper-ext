/**
 * @file Shared style-write type definitions: write plans, write context, framework adapter interfaces
 *
 * Accessed via: imported by StyleWriteManager, StyleWritePlanner, framework adapters, platform executors
 * Assumptions: types are platform-independent — no VS Code, browser, or Node.js-specific imports
 */
import type {
  CascadeContext,
  ComponentPropMapperId,
  CssSyntaxId,
  CssSystemId,
  ElementStyleFacts,
  FiberTraceResult,
  FrameworkReadResult,
  ProjectStyleCapabilities,
  RuntimeThemeContext,
  SourceForm,
  StyleCondition,
  StyleSourceOwner,
} from '@lib/style-read/types';

// Re-export for consumers that need both read and write types
export type { CssSystemId, CssSyntaxId, SourceForm, StyleCondition, StyleSourceOwner };

// --- Target Value ---

/**
 * Target-ready value produced by the framework adapter writer from the canonical
 * inspector value. string for CSS properties and tokens, number for adapter-known
 * numeric props (e.g. Tamagui/React-Native opacity: 0.5).
 */
export type TargetStyleValue = string | number;

// --- Write Plan Base ---

/** @public */
export interface StyleWritePlanBase {
  id: string;
  sourceForm: SourceForm;
  projectRoot: string;
  sourceElement: {
    filePath: string;
    elementRef: string;
    tagName?: string;
  };
  requestedStyles: Record<string, string>;
  targetStyles: Record<string, TargetStyleValue>;
  selectedSourceTabId?: string;
  routeDecision?: {
    sourceTabId: string;
    router: 'explicit-user-selection' | 'ai-style-source-router' | 'deterministic-owner-router';
    reason: string;
    confidence: 'exact' | 'probable' | 'ai-assisted' | 'fallback';
  };
  condition: StyleCondition;
  reason:
    | 'existing-owner'
    | 'project-primary-system'
    | 'element-primary-system'
    | 'mixed-system-tailwind-priority'
    | 'css-module-selector-ambiguous'
    | 'css-rule-not-found'
    | 'dynamic-source-ambiguous'
    | 'explicit-local-override'
    | 'explicit-prop-edit'
    | 'theme-branch-selected'
    | 'theme-value-owner-selected';
  confidence: 'exact' | 'probable' | 'fallback';
  diagnostics: Array<{
    level: 'info' | 'warning' | 'error';
    message: string;
  }>;
}

// --- Plan Variants ---

/** @public */
export interface ClassNameLocation {
  filePath: string;
  line: number;
  column: number;
  expressionPath: string;
}

export interface TailwindPlan extends StyleWritePlanBase {
  sourceForm: 'elementClass';
  cssSystem: 'tailwind-v3' | 'tailwind-v4';
  strategy:
    | {
        mode: 'static';
        removeForProperties: string[];
        addClasses: string;
      }
    | {
        mode: 'dynamic';
        locations: ClassNameLocation[];
        addClasses: string;
        removeForProperties: string[];
        fallbackStrategy: 'append-to-template' | 'wrap-expression' | 'location-only';
        analysis: {
          engine: 'shared-deterministic-analyzer';
          ambiguityResolverUsed?: boolean;
        };
      };
  target: {
    filePath: string;
    elementRef: string;
  };
}

interface CssFilePlanBase extends StyleWritePlanBase {
  sourceForm: 'cssStyleRule';
}

export interface CssModulesFilePlan extends CssFilePlanBase {
  cssSystem: 'css-modules';
  target: {
    cssFilePath: string;
    cssSyntax: CssSyntaxId;
    selector: string;
    declarations: Record<string, string>;
    importSource: string;
    importLocalName: string;
    classKey: string;
    cascadeContext?: CascadeContext;
  };
}

interface PlainCssFilePlanBase extends CssFilePlanBase {
  cssSystem: 'plain-css';
}

export interface PlainCssExistingOwnerPlan extends PlainCssFilePlanBase {
  target: {
    mode: 'existing-owner';
    cssFilePath: string;
    cssSyntax: CssSyntaxId;
    selector: string;
    declarations: Record<string, string>;
    cascadeOwner: StyleSourceOwner;
    cascadeContext?: CascadeContext;
  };
}

export interface PlainCssCreateRulePlan extends PlainCssFilePlanBase {
  target: {
    mode: 'create-rule';
    cssFilePath: string;
    cssSyntax: CssSyntaxId;
    selector: string;
    declarations: Record<string, string>;
    createMode: {
      reason: 'no-existing-owner' | 'explicit-new-selector';
      insertionHint: 'append-to-file' | 'before-owner' | 'after-owner';
    };
    cascadeContext?: CascadeContext;
  };
}

/** @public */
export type PlainCssFilePlan = PlainCssExistingOwnerPlan | PlainCssCreateRulePlan;
export type CssFilePlan = CssModulesFilePlan | PlainCssFilePlan;

export interface ScriptObjectStylePlan extends StyleWritePlanBase {
  sourceForm: 'scriptReactStyleRule';
  cssSystem: 'inline-style' | 'emotion' | 'styled-components' | 'vanilla-extract' | 'mui-system' | 'mantine';
  target: {
    filePath: string;
    elementRef?: string;
    objectPath: string;
    styles: Record<string, TargetStyleValue>;
    mergeMode: 'object' | 'spread-existing-expression';
    cascadeContext?: CascadeContext;
  };
}

/** @public */
export interface ScriptTemplateStylePlan extends StyleWritePlanBase {
  sourceForm: 'scriptNativeStyleRule';
  cssSystem: 'emotion' | 'styled-components';
  target: {
    filePath: string;
    quasiPath: string;
    declarations: Record<string, string>;
    cascadeContext?: CascadeContext;
  };
}

export interface AdapterPropPlan extends StyleWritePlanBase {
  sourceForm: 'adapterKnownElementProp';
  cssSystem: CssSystemId;
  target: {
    filePath: string;
    elementRef: string;
    mapperId: ComponentPropMapperId;
    origin: 'standard-style-inspector' | 'recursive-props-editor';
    props: Record<string, unknown>;
    propPaths?: string[][];
  };
}

export interface ArbitraryPropPlan extends StyleWritePlanBase {
  sourceForm: 'arbitraryElementProp';
  target: {
    filePath: string;
    elementRef: string;
    origin: 'recursive-props-editor';
    props: Record<string, unknown>;
    propPaths?: string[][];
  };
}

export type StyleWritePlan =
  | TailwindPlan
  | CssFilePlan
  | ScriptObjectStylePlan
  | ScriptTemplateStylePlan
  | AdapterPropPlan
  | ArbitraryPropPlan;

// --- Write Context ---

export interface StyleWriteContext {
  projectCapabilities: ProjectStyleCapabilities;
  elementFacts: ElementStyleFacts;
  runtimeThemeContext: RuntimeThemeContext;
  selectedSourceTabId?: string;
  condition: StyleCondition;
  requestedStyles: Record<string, string>;
}

// --- Write Result ---

export type StyleWriteResult =
  | {
      success: true;
      plan: StyleWritePlan;
      mutatedFiles: string[];
    }
  | {
      success: false;
      plan?: StyleWritePlan;
      error: string;
    };

// --- Framework Adapter Interfaces ---

export interface FrameworkStyleReader {
  read(input: {
    elementFacts: ElementStyleFacts;
    computedStyle: Record<string, string>;
    fiberTrace?: FiberTraceResult;
    runtimeThemeContext: RuntimeThemeContext;
  }): FrameworkReadResult | Promise<FrameworkReadResult>;
}

export interface FrameworkStyleWriter {
  createPlan(input: { context: StyleWriteContext; sourceOwner: StyleSourceOwner }): StyleWritePlan;
}

/** @public */
export interface FrameworkSourceResolver {
  resolve(input: {
    elementFacts: ElementStyleFacts;
    property: string;
    condition: StyleCondition;
  }): StyleSourceOwner | undefined;
}

/** @public */
export interface FrameworkTokenResolver {
  resolveToken(input: { tokenId: string; property: string }): string | undefined;
}

/** @public */
export interface FrameworkThemeResolver {
  resolveThemeValue(input: { property: string; themeCondition: StyleCondition }): StyleSourceOwner | undefined;
}

/** @public */
export interface LayoutMutationStrategy {
  changeLayout(input: { elementRef: string; filePath: string; layoutType: string }): StyleWritePlan;
}

export interface FrameworkStyleAdapter {
  readonly id: CssSystemId;
  readonly reader?: FrameworkStyleReader;
  readonly writer?: FrameworkStyleWriter;
  readonly sourceResolver?: FrameworkSourceResolver;
  readonly tokenResolver?: FrameworkTokenResolver;
  readonly themeResolver?: FrameworkThemeResolver;
  readonly layoutStrategy?: LayoutMutationStrategy;
}

// --- Manager Interfaces ---

export interface StyleWriteManager {
  createPlan(ctx: StyleWriteContext): Promise<StyleWritePlan>;
  execute(plan: StyleWritePlan): Promise<StyleWriteResult>;
}

export interface StyleWritePlanner {
  selectTarget(ctx: StyleWriteContext): {
    adapter: FrameworkStyleAdapter;
    writer: FrameworkStyleWriter;
    sourceOwner: StyleSourceOwner;
  };
}
