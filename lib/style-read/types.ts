/**
 * @file Shared style-read type definitions for inspector source ownership, conditions, and capabilities
 *
 * Accessed via: imported by lib/style-write/, lib/style-values/, client adapters, server routes
 * Assumptions: types are platform-independent — no VS Code or browser imports
 */

// --- CSS System Identity ---

export type CssSystemId =
  | 'tailwind-v3'
  | 'tailwind-v4'
  | 'css-modules'
  | 'plain-css'
  | 'inline-style'
  | 'emotion'
  | 'styled-components'
  | 'vanilla-extract'
  | 'mui-system'
  | 'chakra-ui'
  | 'mantine'
  | 'tamagui';

/** @public */
export type CssSystemTopology = 'flat' | 'cascade';

export type CssSyntaxId = 'css' | 'scss' | 'sass' | 'less' | 'stylus';

/** @public */
export type UiKitId =
  | 'shadcn-ui'
  | 'daisyui'
  | 'radix-ui'
  | 'mui'
  | 'chakra-ui'
  | 'ant-design'
  | 'mantine'
  | 'bootstrap'
  | 'flowbite'
  | 'headless-ui'
  | 'tamagui';

export type ComponentPropMapperId =
  | 'tamagui'
  | 'chakra-ui'
  | 'mui-sx'
  | 'mantine'
  | 'ant-design'
  | 'react-bootstrap'
  | 'flowbite-react'
  | 'radix-ui'
  | 'headless-ui'
  | 'shadcn-cva';

// --- Source Form ---

/** Where a style value physically lives in user code */
export type SourceForm =
  /** className="..." or cn(...) — class string on the element */
  | 'elementClass'
  /** .card { padding: 8px } — rule in a CSS file */
  | 'cssStyleRule'
  /** style={{ padding: 8 }} — React inline style object */
  | 'scriptReactStyleRule'
  /** StyleSheet.create({ ... }) — React Native style object */
  | 'scriptNativeStyleRule'
  /** <Button size="lg"> — prop mapped by a known adapter */
  | 'adapterKnownElementProp'
  /** <Foo bar={...}> — arbitrary component prop with style semantics */
  | 'arbitraryElementProp';

// --- Source Confidence ---

export type SourceConfidence = 'exact' | 'probable' | 'computed-only';

// --- Conditions ---

export type StylePseudoState = 'base' | 'hover' | 'focus' | 'active' | 'focus-visible' | 'disabled';

/** @public */
export type StyleBreakpointKey = 'base' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | (string & {});

/** @public */
export type ResponsiveConditionSource =
  | 'tailwind-screens'
  | 'mui-theme-breakpoints'
  | 'chakra-theme-breakpoints'
  | 'mantine-theme-breakpoints'
  | 'css-media-query'
  | 'css-container-query'
  | 'custom';

/** @public */
export interface ViewportCondition {
  kind: 'viewport';
  key: StyleBreakpointKey;
  minWidthPx?: number;
  maxWidthPx?: number;
  query?: string;
  source: ResponsiveConditionSource;
}

/** @public */
export interface ContainerCondition {
  kind: 'container';
  key?: StyleBreakpointKey;
  containerName?: string;
  minWidthPx?: number;
  maxWidthPx?: number;
  query?: string;
  source: ResponsiveConditionSource;
}

/** @public */
export interface MediaCondition {
  kind: 'media' | 'supports';
  query: string;
  source: ResponsiveConditionSource;
}

// --- Theme ---

/** @public */
export type ThemeAxisId = 'color-scheme' | 'brand' | 'density' | 'contrast' | 'platform' | (string & {});

/** @public */
export type ThemeConditionSource =
  | 'prefers-color-scheme'
  | 'tailwind-dark-selector'
  | 'mui-color-scheme'
  | 'chakra-color-mode'
  | 'mantine-color-scheme'
  | 'tamagui-theme'
  | 'data-attribute'
  | 'class-selector'
  | 'css-variable-scope'
  | 'script-condition'
  | 'theme-provider'
  | 'library-theme-config'
  | 'custom';

export interface ThemeCondition {
  axis: ThemeAxisId;
  value: string;
  source: ThemeConditionSource;
  selector?: string;
  query?: string;
  expression?: string;
  provider?: string;
  configPath?: string;
}

/** @public */
export type SelectorConditionKind =
  | 'self-pseudo'
  | 'ancestor-selector'
  | 'group-selector'
  | 'peer-selector'
  | 'data-attribute'
  | 'aria-attribute'
  | 'structural-selector'
  | 'slot-selector'
  | 'arbitrary-selector'
  | 'library-variant';

/** @public */
export interface SelectorCondition {
  kind: SelectorConditionKind;
  selector: string;
  label?: string;
  source: 'css-selector' | 'tailwind-variant' | 'mui-slot' | 'chakra-pseudo-prop' | 'mantine-slot' | 'custom';
}

export interface StyleCondition {
  state: StylePseudoState;
  viewport?: ViewportCondition;
  container?: ContainerCondition;
  media?: MediaCondition[];
  theme?: ThemeCondition[];
  selector?: SelectorCondition[];
  raw?: Array<{
    kind: string;
    value: string;
    source: string;
  }>;
}

export interface CascadeContext {
  layer?: string;
  scope?: {
    rootSelector: string;
    limitSelector?: string;
  };
  atRuleStack?: Array<{
    name: string;
    params: string;
  }>;
}

// --- Source Ownership ---

export interface StyleSourceOwner {
  cssSystem: CssSystemId;
  sourceForm: SourceForm;
  cssSyntax?: CssSyntaxId;
  filePath: string;
  elementRef?: string;
  selector?: string;
  property: string;
  condition: StyleCondition;
  cascadeContext?: CascadeContext;
  confidence: SourceConfidence;
}

export interface StyleSourceTab {
  id: string;
  label: string;
  cssSystem?: CssSystemId;
  sourceForm?: SourceForm;
  cssSyntax?: CssSyntaxId;
  filePath?: string;
  selector?: string;
  cssClass?: string;
  classKey?: string;
  sourceRef?: {
    importLocalName?: string;
    importSource?: string;
    expressionPath?: string;
  };
  condition: StyleCondition;
  cascadeContext?: CascadeContext;
  confidence: SourceConfidence;
  isDefault?: boolean;
}

export interface SourceClassIdentity {
  sourceTabId?: string;
  cssSystem: CssSystemId;
  sourceForm: SourceForm;
  label: string;
  filePath?: string;
  cssSyntax?: CssSyntaxId;
  cssClass?: string;
  classKey?: string;
  selector?: string;
  sourceRef?: {
    importLocalName?: string;
    importSource?: string;
    expressionPath?: string;
  };
  condition: StyleCondition;
  confidence: SourceConfidence;
  /**
   * Per-class confidence for a single class-string source. Statically certain classes are
   * 'exact'; classes that appear only inside a conditional branch are 'probable'. This is
   * METADATA on the one source identity — it intentionally does NOT split the identity into
   * multiple source tabs, which would render as duplicate, indistinguishable tab buttons.
   */
  classConfidences?: ClassConfidence[];
}

export interface ClassConfidence {
  cssClass: string;
  confidence: SourceConfidence;
}

export interface CssModuleClassReference {
  importLocalName: string;
  importSource: string;
  cssFilePath: string;
  cssSyntax: CssSyntaxId;
  classKey: string;
  selector: string;
  expressionPath: string;
}

export interface FrameworkReadResult {
  sourceOwners: StyleSourceOwner[];
  values: Record<string, string>;
  classIdentities: SourceClassIdentity[];
  conditions: StyleCondition[];
}

export interface FiberTraceResult {
  sourceLocation?: {
    filePath: string;
    line: number;
    column: number;
  };
  /**
   * Class names extracted from the JSX `className` AST — the exact static string plus
   * the static fragments of dynamic expressions. These are AST-static source classes,
   * NOT the live DOM `element.className`: this read path has no DOM access, so it cannot
   * see runtime-only classes (e.g. the active branch of a conditional). The name reflects
   * the source, not a runtime value.
   */
  staticSourceClasses?: string[];
}

// --- Runtime Theme Context ---

export type IdeThemePreference = 'light' | 'dark' | 'system';
export type ResolvedColorScheme = 'light' | 'dark';
export type RuntimeThemeSource = 'hyperide' | 'vscode' | 'browser-system' | 'app-runtime' | 'test-fixture';

export interface RuntimeThemeContext {
  ideThemePreference: IdeThemePreference;
  resolvedColorScheme: ResolvedColorScheme;
  source: RuntimeThemeSource;
  selectedTheme?: ThemeCondition[];
}

interface RuntimeThemeContextInputBase {
  source: RuntimeThemeSource;
  selectedTheme?: ThemeCondition[];
  includeColorSchemeCondition?: boolean;
}

export type RuntimeThemeContextInput =
  | (RuntimeThemeContextInputBase & {
      ideThemePreference: 'light' | 'dark';
      systemColorScheme?: ResolvedColorScheme;
    })
  | (RuntimeThemeContextInputBase & {
      ideThemePreference: 'system';
      systemColorScheme: ResolvedColorScheme;
    });

export interface ThemeStateRuntimeThemeContextInput extends RuntimeThemeContextInputBase {
  theme: IdeThemePreference;
  resolvedTheme: ResolvedColorScheme;
}

export interface CssClassRuntimeThemeContextInput extends RuntimeThemeContextInputBase {
  classNames: string[];
  systemColorScheme: ResolvedColorScheme;
}

export interface ThemeContextResolver {
  resolve(input: RuntimeThemeContextInput): RuntimeThemeContext;
}

// --- Theme Capabilities ---

/** @public */
export type ThemeMechanism =
  | 'prefers-color-scheme'
  | 'class-selector'
  | 'data-attribute'
  | 'css-custom-properties'
  | 'tailwind-dark-variant'
  | 'tailwind-theme'
  | 'mui-theme'
  | 'chakra-theme'
  | 'mantine-theme'
  | 'tamagui-theme'
  | 'vanilla-extract-theme'
  | 'css-in-js-theme-callback'
  | 'script-branch';

/** @public */
export interface ThemeTokenSource {
  kind:
    | 'css-custom-property'
    | 'tailwind-token'
    | 'mui-theme-token'
    | 'chakra-theme-token'
    | 'mantine-theme-token'
    | 'tamagui-token'
    | 'vanilla-extract-token'
    | 'css-in-js-theme-token';
  filePath?: string;
  owner?: string;
}

/** @public */
export interface ThemeAxisCapability {
  id: ThemeAxisId;
  values: string[];
  defaultValue?: string;
  source: 'config' | 'css' | 'runtime' | 'library' | 'inferred';
}

/** @public */
export interface ProjectThemeCapabilities {
  axes: ThemeAxisCapability[];
  mechanisms: ThemeMechanism[];
  tokenSources: ThemeTokenSource[];
}

// --- Project & Element Capabilities ---

/** @public */
export interface PackageEvidence {
  packageName: string;
  version?: string;
  dependencyKind: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'unknown';
}

/** @public */
export interface ConfigEvidence {
  filePath: string;
  kind:
    | 'tailwind-config'
    | 'postcss-config'
    | 'vite-config'
    | 'next-config'
    | 'tsconfig'
    | 'vanilla-extract-config'
    | 'theme-config'
    | 'other';
}

/** @public */
export interface SourceEvidence {
  filePath: string;
  cssSyntax?: CssSyntaxId;
  kind:
    | 'css-import'
    | 'css-module-import'
    | 'css-in-js-import'
    | 'ui-kit-import'
    | 'style-prop'
    | 'className-expression'
    | 'theme-config'
    | 'css-variable-definition'
    | 'script-theme-branch';
}

export interface ProjectStyleCapabilities {
  projectCssSystems: CssSystemId[];
  projectUiKits: UiKitId[];
  componentPropMappers: ComponentPropMapperId[];
  cssSyntaxes: CssSyntaxId[];
  projectThemeCapabilities: ProjectThemeCapabilities;
  packageEvidence: PackageEvidence[];
  configEvidence: ConfigEvidence[];
  sourceEvidence: SourceEvidence[];
}

export interface ClassNameExpressionFacts {
  kind: 'literal' | 'template' | 'call-expression' | 'member-expression' | 'unknown';
  staticClasses: string[];
  dynamic: boolean;
  cssModuleReferences?: CssModuleClassReference[];
  /**
   * Classes that are unconditionally present in the expression: direct string-literal
   * arguments to cn()/clsx() and top-level template quasis. Statically certain → 'exact'.
   * Optional for back-compat; readers fall back to `staticClasses` when absent.
   */
  staticLiteralClasses?: string[];
  /**
   * Classes that appear only inside a conditional branch: a logical-`&&` right side or a
   * ternary consequent/alternate. Their presence depends on runtime state → 'probable'.
   */
  dynamicBranchClasses?: string[];
}

export interface StyleAttributeFacts {
  kind: 'object-literal' | 'identifier' | 'spread' | 'unknown';
  hasSpread: boolean;
}

/** @public */
export interface ComponentFacts {
  importSource?: string;
  componentName?: string;
  intrinsicElement?: string;
}

/** @public */
export interface ComponentPropSurfaceFacts {
  acceptsClassName: boolean;
  acceptsStyle: boolean;
  acceptsCssProp: boolean;
  acceptsSxProp: boolean;
  recursivePropsSchemaAvailable: boolean;
  styleLikeProps: string[];
  semanticProps: string[];
}

/** @public */
export interface ThemeVariableUsage {
  name: string;
  fallbackChain: string[];
  owners: StyleSourceOwner[];
}

/** @public */
export interface ThemeTokenUsage {
  tokenPath: string;
  source: ThemeTokenSource['kind'];
  owners: StyleSourceOwner[];
}

/** @public */
export interface ElementThemeFacts {
  activeRuntimeTheme: RuntimeThemeContext;
  sourceThemeConditions: ThemeCondition[];
  variableUsages: ThemeVariableUsage[];
  tokenUsages: ThemeTokenUsage[];
}

export interface ElementStyleFacts {
  elementCssSystems: CssSystemId[];
  elementUiKits: UiKitId[];
  elementPropMappers: ComponentPropMapperId[];
  sourceOwners: StyleSourceOwner[];
  classNameExpression?: ClassNameExpressionFacts;
  styleAttribute?: StyleAttributeFacts;
  componentFacts?: ComponentFacts;
  componentPropSurface?: ComponentPropSurfaceFacts;
  themeFacts?: ElementThemeFacts;
}

// --- Inspector Surface Decision ---

export interface InspectorSurfaceDecision {
  standardStyleInspector: 'enabled' | 'disabled';
  propsEditor: 'hidden' | 'compact' | 'full';
  reasons: Array<
    | 'intrinsic-element'
    | 'accepts-className'
    | 'accepts-style'
    | 'accepts-css-prop'
    | 'accepts-sx-prop'
    | 'adapter-known-prop-mapper'
    | 'source-owner-found'
    | 'props-schema-available'
    | 'no-standard-style-surface'
  >;
}

export interface StyleReadContext {
  projectCapabilities: ProjectStyleCapabilities;
  elementFacts: ElementStyleFacts;
  runtimeThemeContext: RuntimeThemeContext;
  computedStyle: Record<string, string>;
  fiberTrace?: FiberTraceResult;
}

export interface PropertySource {
  property: string;
  value: string;
  sourceTabId: string;
  specificity?: number;
  active: boolean;
}

export interface AvailableConditionAxes {
  states: StylePseudoState[];
  viewportKeys: StyleBreakpointKey[];
  themeAxes: ThemeAxisId[];
  containerKeys: StyleBreakpointKey[];
}

/** @public */
export interface StyleReadDiagnostic {
  level: 'info' | 'warning';
  message: string;
}

export interface StyleReadResult {
  sourceTabs: StyleSourceTab[];
  properties: PropertySource[];
  surfaceDecision: InspectorSurfaceDecision;
  activeConditions: StyleCondition;
  availableConditionAxes: AvailableConditionAxes;
  diagnostics: StyleReadDiagnostic[];
}

export interface StyleReadManager {
  read(context: StyleReadContext): Promise<StyleReadResult>;
}

// --- Component Prop Mapper ---

/** @public */
export type ComponentPropMapperMatch =
  | {
      matched: true;
      confidence: 'exact' | 'probable';
      supportedProps: string[];
      supportedStates: StylePseudoState[];
    }
  | {
      matched: false;
      reason: string;
    };

/** @public */
export interface ComponentPropStyleWriteTarget {
  sourceForm: 'adapterKnownElementProp' | 'scriptReactStyleRule' | 'elementClass' | 'cssStyleRule';
  props?: Record<string, unknown>;
  propPaths?: string[][];
  sourceOwner?: StyleSourceOwner;
}

/** @public */
export interface ComponentPropMapperUnsupported {
  supported: false;
  reason: string;
}
