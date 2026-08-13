<!-- markdownlint-disable MD013 -->

# Style Write Foundation — Implementation Plan

> **Historical implementation plan:** Claude Code agents may use the referenced
> superpowers workflow. Codex agents must follow `CODEX.md` and `AGENTS.md`
> instead: no self-invoked `codex exec review`; use staged-diff self-review.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the shared type system, value normalization modules, and write plan model that form the foundation of the unified style-write architecture (Phases 1 + 2 from `docs/specs/2026-04-14-style-write-unification-plan.md`).

**Architecture:** All new code lives in `lib/style-write/` (types + manager interfaces), `lib/style-values/` (codec + normalizer), and `lib/style-read/` (source ownership types). These are pure shared modules with no platform imports — consumed by both VS Code extension and SaaS server. Tests colocated with source files.

**Tech Stack:** TypeScript, bun:test, happy-dom (from test/setup.ts for CSS.supports)

**Spec references:**

- `docs/specs/2026-04-14-style-write-unification-plan.md` — canonical architecture
- `docs/specs/2026-04-14-style-source-owner.md` — StyleSourceOwner, CssSystemId, SourceForm
- `docs/specs/2026-04-14-style-source-confidence.md` — SourceConfidence semantics
- `docs/specs/2026-04-15-style-theme-resolution.md` — RuntimeThemeContext, ThemeCondition

---

## File Structure

```text
lib/
  style-write/
    types.ts                        # StyleWritePlan union, StyleWriteContext, StyleWriteResult,
                                    #   StyleWritePlanBase, all plan variants, FrameworkStyleAdapter,
                                    #   FrameworkStyleWriter, StyleWriteManager, StyleWritePlanner
    types.test.ts                   # Type-level tests: plan discrimination, required fields
  style-values/
    inspector-value-codec.ts        # InspectorValueCodec — normalize/format inspector values
    inspector-value-codec.test.ts   # Unit tests for codec
    css-runtime-normalizer.ts       # CssRuntimeNormalizer — browser CSS.supports validation
    css-runtime-normalizer.test.ts  # Unit tests for normalizer (happy-dom backed)
  style-read/
    types.ts                        # StyleSourceOwner, StyleSourceTab, StyleCondition,
                                    #   CascadeContext, ProjectStyleCapabilities, ElementStyleFacts,
                                    #   InspectorSurfaceDecision, ComponentPropMapper
```

Existing files referenced but NOT modified:

- `client/lib/canvas-engine/adapters/StyleAdapter.ts` — legacy, untouched
- `client/lib/canvas-engine/adapters/types.ts` — `ParsedStyles`, untouched
- `lib/tailwind/generator.ts` — existing Tailwind generator, untouched

---

## Task 1: Create shared style-read types

All source ownership, condition, confidence, theme, and capability types. These are consumed by write types and codec.

**Files:**

- Create: `lib/style-read/types.ts`
- Test: `lib/style-read/types.test.ts`

- [ ] **Step 1: Write type discrimination tests**

```typescript
// lib/style-read/types.test.ts
/**
 * @file Type-level tests for style-read types
 *
 * Accessed via: bun run test lib/style-read/types.test.ts
 * Assumptions: types are importable and values satisfy type constraints
 */
import { describe, expect, it } from 'bun:test';
import type {
  CascadeContext,
  CssSystemId,
  CssSyntaxId,
  ElementStyleFacts,
  ProjectStyleCapabilities,
  SourceConfidence,
  SourceForm,
  StyleCondition,
  StyleSourceOwner,
  StyleSourceTab,
} from './types';

describe('style-read types', () => {
  it('CssSystemId covers all supported systems', () => {
    const systems: CssSystemId[] = [
      'tailwind-v3',
      'tailwind-v4',
      'css-modules',
      'plain-css',
      'inline-style',
      'emotion',
      'styled-components',
      'vanilla-extract',
      'mui-system',
      'chakra-ui',
      'mantine',
      'tamagui',
    ];
    expect(systems).toHaveLength(12);
  });

  it('SourceForm covers all write surfaces', () => {
    const forms: SourceForm[] = [
      'elementClass',
      'cssStyleRule',
      'scriptReactStyleRule',
      'scriptNativeStyleRule',
      'adapterKnownElementProp',
      'arbitraryElementProp',
    ];
    expect(forms).toHaveLength(6);
  });

  it('SourceConfidence has three levels', () => {
    const levels: SourceConfidence[] = ['exact', 'probable', 'computed-only'];
    expect(levels).toHaveLength(3);
  });

  it('StyleSourceOwner has required fields', () => {
    const owner: StyleSourceOwner = {
      cssSystem: 'css-modules',
      sourceForm: 'cssStyleRule',
      cssSyntax: 'css',
      filePath: 'src/Card.module.css',
      selector: '.card',
      property: 'padding-left',
      condition: { state: 'base' },
      confidence: 'exact',
    };
    expect(owner.cssSystem).toBe('css-modules');
    expect(owner.sourceForm).toBe('cssStyleRule');
    expect(owner.condition.state).toBe('base');
  });

  it('StyleCondition composes theme + viewport + state', () => {
    const condition: StyleCondition = {
      state: 'hover',
      viewport: {
        kind: 'viewport',
        key: 'md',
        minWidthPx: 768,
        source: 'tailwind-screens',
      },
      theme: [
        {
          axis: 'color-scheme',
          value: 'dark',
          source: 'tailwind-dark-selector',
          selector: '.dark &',
        },
      ],
    };
    expect(condition.state).toBe('hover');
    expect(condition.viewport?.key).toBe('md');
    expect(condition.theme?.[0].value).toBe('dark');
  });

  it('CascadeContext is separate from StyleCondition', () => {
    const cascade: CascadeContext = {
      layer: 'components',
      scope: { rootSelector: '.card' },
      atRuleStack: [{ name: 'layer', params: 'components' }],
    };
    expect(cascade.layer).toBe('components');
  });

  it('StyleSourceTab has Computed tab without cssSystem', () => {
    const computed: StyleSourceTab = {
      id: 'computed',
      label: 'Computed',
      condition: { state: 'base' },
      confidence: 'computed-only',
    };
    expect(computed.cssSystem).toBeUndefined();
    expect(computed.sourceForm).toBeUndefined();
  });

  it('StyleSourceTab has source tab with cssSystem', () => {
    const tab: StyleSourceTab = {
      id: 'css-modules:card',
      label: '.card',
      cssSystem: 'css-modules',
      sourceForm: 'cssStyleRule',
      cssSyntax: 'css',
      filePath: 'src/Card.module.css',
      selector: '.card',
      condition: { state: 'base' },
      confidence: 'exact',
    };
    expect(tab.cssSystem).toBe('css-modules');
    expect(tab.label).toBe('.card');
  });

  it('ProjectStyleCapabilities uses arrays for multiple systems', () => {
    const caps: ProjectStyleCapabilities = {
      projectCssSystems: ['tailwind-v4', 'css-modules'],
      projectUiKits: ['shadcn-ui'],
      componentPropMappers: [],
      cssSyntaxes: ['css'],
      projectThemeCapabilities: {
        axes: [],
        mechanisms: ['tailwind-dark-variant'],
        tokenSources: [],
      },
      packageEvidence: [],
      configEvidence: [],
      sourceEvidence: [],
    };
    expect(caps.projectCssSystems).toContain('tailwind-v4');
    expect(caps.projectCssSystems).toContain('css-modules');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/style-read/types.test.ts`
Expected: FAIL — module `./types` not found

- [ ] **Step 3: Create the types module**

```typescript
// lib/style-read/types.ts
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

export type CssSystemTopology = 'flat' | 'cascade';

export interface CssSystemDescriptor {
  id: CssSystemId;
  topology: CssSystemTopology;
  defaultSourceForm: SourceForm;
}

export type CssSyntaxId = 'css' | 'scss' | 'sass' | 'less' | 'stylus';

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

export type SourceForm =
  | 'elementClass'
  | 'cssStyleRule'
  | 'scriptReactStyleRule'
  | 'scriptNativeStyleRule'
  | 'adapterKnownElementProp'
  | 'arbitraryElementProp';

// --- Source Confidence ---

export type SourceConfidence = 'exact' | 'probable' | 'computed-only';

// --- Conditions ---

export type StylePseudoState = 'base' | 'hover' | 'focus' | 'active' | 'focus-visible' | 'disabled';

export type StyleBreakpointKey = 'base' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | (string & {});

export type ResponsiveConditionSource =
  | 'tailwind-screens'
  | 'mui-theme-breakpoints'
  | 'chakra-theme-breakpoints'
  | 'mantine-theme-breakpoints'
  | 'css-media-query'
  | 'css-container-query'
  | 'custom';

export interface ViewportCondition {
  kind: 'viewport';
  key: StyleBreakpointKey;
  minWidthPx?: number;
  maxWidthPx?: number;
  query?: string;
  source: ResponsiveConditionSource;
}

export interface ContainerCondition {
  kind: 'container';
  key?: StyleBreakpointKey;
  containerName?: string;
  minWidthPx?: number;
  maxWidthPx?: number;
  query?: string;
  source: ResponsiveConditionSource;
}

export interface MediaCondition {
  kind: 'media' | 'supports';
  query: string;
  source: ResponsiveConditionSource;
}

// --- Theme ---

export type ThemeAxisId = 'color-scheme' | 'brand' | 'density' | 'contrast' | 'platform' | (string & {});

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
  condition: StyleCondition;
  cascadeContext?: CascadeContext;
  confidence: SourceConfidence;
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

// --- Theme Capabilities ---

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

export interface ThemeAxisCapability {
  id: ThemeAxisId;
  values: string[];
  defaultValue?: string;
  source: 'config' | 'css' | 'runtime' | 'library' | 'inferred';
}

export interface ProjectThemeCapabilities {
  axes: ThemeAxisCapability[];
  mechanisms: ThemeMechanism[];
  tokenSources: ThemeTokenSource[];
}

// --- Project & Element Capabilities ---

export interface PackageEvidence {
  packageName: string;
  version?: string;
  dependencyKind: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'unknown';
}

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
}

export interface StyleAttributeFacts {
  kind: 'object-literal' | 'identifier' | 'spread' | 'unknown';
  hasSpread: boolean;
}

export interface ComponentFacts {
  importSource?: string;
  componentName?: string;
  intrinsicElement?: string;
}

export interface ComponentPropSurfaceFacts {
  acceptsClassName: boolean;
  acceptsStyle: boolean;
  acceptsCssProp: boolean;
  acceptsSxProp: boolean;
  recursivePropsSchemaAvailable: boolean;
  styleLikeProps: string[];
  semanticProps: string[];
}

export interface ThemeVariableUsage {
  name: string;
  fallbackChain: string[];
  owners: StyleSourceOwner[];
}

export interface ThemeTokenUsage {
  tokenPath: string;
  source: ThemeTokenSource['kind'];
  owners: StyleSourceOwner[];
}

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

// --- Component Prop Mapper ---

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

export interface ComponentPropStyleWriteTarget {
  sourceForm: 'adapterKnownElementProp' | 'scriptReactStyleRule' | 'elementClass' | 'cssStyleRule';
  props?: Record<string, unknown>;
  propPaths?: string[][];
  sourceOwner?: StyleSourceOwner;
}

export interface ComponentPropMapperUnsupported {
  supported: false;
  reason: string;
}

export interface ComponentPropMapper {
  readonly id: ComponentPropMapperId;
  readonly cssSystem?: CssSystemId;
  detect(input: {
    componentFacts: ComponentFacts;
    propSurface: ComponentPropSurfaceFacts;
    projectCapabilities: ProjectStyleCapabilities;
  }): ComponentPropMapperMatch;
  mapStyleWrite(input: {
    property: string;
    value: unknown;
    state: StylePseudoState;
    targetValue: unknown;
  }): ComponentPropStyleWriteTarget | ComponentPropMapperUnsupported;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/style-read/types.test.ts`
Expected: PASS — all type constraint tests pass

- [ ] **Step 5: Commit**

```bash
git add lib/style-read/types.ts lib/style-read/types.test.ts
git commit -m "feat(style-read): add shared type definitions for source ownership, conditions, and capabilities"
```

---

## Task 2: Create shared style-write types

StyleWritePlan union, StyleWriteContext, StyleWriteResult, framework adapter interfaces. Depends on style-read types.

**Files:**

- Create: `lib/style-write/types.ts`
- Test: `lib/style-write/types.test.ts`

- [ ] **Step 1: Write plan discrimination tests**

```typescript
// lib/style-write/types.test.ts
/**
 * @file Type-level tests for style-write plan types
 *
 * Accessed via: bun run test lib/style-write/types.test.ts
 * Assumptions: types are importable and plan union discriminates correctly
 */
import { describe, expect, it } from 'bun:test';
import type {
  AdapterPropPlan,
  ArbitraryPropPlan,
  CssFilePlan,
  CssModulesFilePlan,
  FrameworkStyleAdapter,
  PlainCssCreateRulePlan,
  PlainCssExistingOwnerPlan,
  ScriptObjectStylePlan,
  ScriptTemplateStylePlan,
  StyleWriteContext,
  StyleWritePlan,
  StyleWriteResult,
  TailwindPlan,
} from './types';

describe('StyleWritePlan union', () => {
  it('TailwindPlan discriminates by sourceForm elementClass', () => {
    const plan: TailwindPlan = {
      id: 'plan-1',
      sourceForm: 'elementClass',
      cssSystem: 'tailwind-v4',
      projectRoot: '/project',
      sourceElement: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:12:4' },
      requestedStyles: { paddingLeft: '16' },
      targetStyles: { paddingLeft: '16' },
      condition: { state: 'base' },
      reason: 'project-primary-system',
      confidence: 'exact',
      diagnostics: [],
      strategy: {
        mode: 'static',
        removeForProperties: ['paddingLeft'],
        addClasses: 'pl-[16px]',
      },
      target: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:12:4' },
    };
    expect(plan.sourceForm).toBe('elementClass');
    expect(plan.strategy.mode).toBe('static');
  });

  it('CssModulesFilePlan discriminates by cssSystem css-modules', () => {
    const plan: CssModulesFilePlan = {
      id: 'plan-2',
      sourceForm: 'cssStyleRule',
      cssSystem: 'css-modules',
      projectRoot: '/project',
      sourceElement: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:20:6' },
      requestedStyles: { paddingLeft: '16' },
      targetStyles: { paddingLeft: '16px' },
      condition: { state: 'base' },
      reason: 'existing-owner',
      confidence: 'exact',
      diagnostics: [],
      target: {
        cssFilePath: 'src/App.module.css',
        cssSyntax: 'css',
        selector: '.app',
        declarations: { 'padding-left': '16px' },
        importSource: './App.module.css',
        importLocalName: 'styles',
        classKey: 'app',
      },
    };
    expect(plan.sourceForm).toBe('cssStyleRule');
    expect(plan.cssSystem).toBe('css-modules');
  });

  it('PlainCssExistingOwnerPlan has mode existing-owner', () => {
    const plan: PlainCssExistingOwnerPlan = {
      id: 'plan-3',
      sourceForm: 'cssStyleRule',
      cssSystem: 'plain-css',
      projectRoot: '/project',
      sourceElement: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:8:4' },
      requestedStyles: { color: 'red' },
      targetStyles: { color: 'red' },
      condition: { state: 'base' },
      reason: 'existing-owner',
      confidence: 'exact',
      diagnostics: [],
      target: {
        mode: 'existing-owner',
        cssFilePath: 'src/global.css',
        cssSyntax: 'css',
        selector: '.card',
        declarations: { color: 'red' },
        cascadeOwner: {
          cssSystem: 'plain-css',
          sourceForm: 'cssStyleRule',
          filePath: 'src/global.css',
          selector: '.card',
          property: 'color',
          condition: { state: 'base' },
          confidence: 'exact',
        },
      },
    };
    expect(plan.target.mode).toBe('existing-owner');
  });

  it('ScriptObjectStylePlan discriminates by scriptReactStyleRule', () => {
    const plan: ScriptObjectStylePlan = {
      id: 'plan-4',
      sourceForm: 'scriptReactStyleRule',
      cssSystem: 'inline-style',
      projectRoot: '/project',
      sourceElement: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:8:4' },
      requestedStyles: { opacity: '50' },
      targetStyles: { opacity: '0.5' },
      condition: { state: 'base' },
      reason: 'existing-owner',
      confidence: 'exact',
      diagnostics: [],
      target: {
        filePath: 'src/App.tsx',
        objectPath: 'JSXAttribute[name=style]/JSXExpressionContainer/ObjectExpression',
        styles: { opacity: '0.5' },
        mergeMode: 'object',
      },
    };
    expect(plan.sourceForm).toBe('scriptReactStyleRule');
  });

  it('AdapterPropPlan requires mapperId for standard-style-inspector origin', () => {
    const plan: AdapterPropPlan = {
      id: 'plan-5',
      sourceForm: 'adapterKnownElementProp',
      cssSystem: 'tamagui',
      projectRoot: '/project',
      sourceElement: { filePath: 'src/Card.tsx', elementRef: 'src/Card.tsx:8:4', tagName: 'YStack' },
      requestedStyles: { opacity: '50' },
      targetStyles: { opacity: 0.5 },
      condition: { state: 'base' },
      reason: 'existing-owner',
      confidence: 'exact',
      diagnostics: [],
      target: {
        filePath: 'src/Card.tsx',
        elementRef: 'src/Card.tsx:8:4',
        mapperId: 'tamagui',
        origin: 'standard-style-inspector',
        props: { opacity: 0.5 },
        propPaths: [['opacity']],
      },
    };
    expect(plan.target.mapperId).toBe('tamagui');
    expect(plan.target.origin).toBe('standard-style-inspector');
  });

  it('ArbitraryPropPlan has empty requestedStyles and targetStyles', () => {
    const plan: ArbitraryPropPlan = {
      id: 'plan-6',
      sourceForm: 'arbitraryElementProp',
      projectRoot: '/project',
      sourceElement: { filePath: 'src/Card.tsx', elementRef: 'src/Card.tsx:8:4' },
      requestedStyles: {},
      targetStyles: {},
      condition: { state: 'base' },
      reason: 'explicit-prop-edit',
      confidence: 'exact',
      diagnostics: [],
      target: {
        filePath: 'src/Card.tsx',
        elementRef: 'src/Card.tsx:8:4',
        origin: 'recursive-props-editor',
        props: { variant: 'solid' },
        propPaths: [['variant']],
      },
    };
    expect(Object.keys(plan.requestedStyles)).toHaveLength(0);
    expect(Object.keys(plan.targetStyles)).toHaveLength(0);
  });

  it('StyleWriteContext carries per-request runtime theme context', () => {
    const ctx: StyleWriteContext = {
      projectCapabilities: {
        projectCssSystems: ['tailwind-v4'],
        projectUiKits: [],
        componentPropMappers: [],
        cssSyntaxes: ['css'],
        projectThemeCapabilities: { axes: [], mechanisms: [], tokenSources: [] },
        packageEvidence: [],
        configEvidence: [],
        sourceEvidence: [],
      },
      elementFacts: {
        elementCssSystems: ['tailwind-v4'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [],
      },
      runtimeThemeContext: {
        ideThemePreference: 'dark',
        resolvedColorScheme: 'dark',
        source: 'vscode',
      },
      condition: { state: 'base' },
      requestedStyles: { paddingLeft: '16' },
    };
    expect(ctx.runtimeThemeContext.resolvedColorScheme).toBe('dark');
  });

  it('StyleWriteResult indicates success or failure', () => {
    const success: StyleWriteResult = {
      success: true,
      plan: {
        id: 'plan-1',
        sourceForm: 'elementClass',
        cssSystem: 'tailwind-v4',
        projectRoot: '/project',
        sourceElement: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:12:4' },
        requestedStyles: { paddingLeft: '16' },
        targetStyles: { paddingLeft: '16' },
        condition: { state: 'base' },
        reason: 'project-primary-system',
        confidence: 'exact',
        diagnostics: [],
        strategy: { mode: 'static', removeForProperties: ['paddingLeft'], addClasses: 'pl-[16px]' },
        target: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:12:4' },
      },
      mutatedFiles: ['src/App.tsx'],
    };
    expect(success.success).toBe(true);

    const failure: StyleWriteResult = {
      success: false,
      error: 'CSS file not found: src/App.module.css',
    };
    expect(failure.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/style-write/types.test.ts`
Expected: FAIL — module `./types` not found

- [ ] **Step 3: Create the types module**

```typescript
// lib/style-write/types.ts
/**
 * @file Shared style-write type definitions: write plans, write context, framework adapter interfaces
 *
 * Accessed via: imported by StyleWriteManager, StyleWritePlanner, framework adapters, platform executors
 * Assumptions: types are platform-independent — no VS Code, browser, or Node.js-specific imports
 */
import type {
  CascadeContext,
  ComponentPropMapperId,
  CssSystemId,
  CssSyntaxId,
  ElementStyleFacts,
  ProjectStyleCapabilities,
  RuntimeThemeContext,
  SourceConfidence,
  SourceForm,
  StyleCondition,
  StylePseudoState,
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
  read(input: { elementFacts: ElementStyleFacts; condition: StyleCondition }): StyleSourceOwner[];
}

export interface FrameworkStyleWriter {
  createPlan(input: { context: StyleWriteContext; sourceOwner: StyleSourceOwner }): StyleWritePlan;
}

export interface FrameworkSourceResolver {
  resolve(input: {
    elementFacts: ElementStyleFacts;
    property: string;
    condition: StyleCondition;
  }): StyleSourceOwner | undefined;
}

export interface FrameworkTokenResolver {
  resolveToken(input: { tokenId: string; property: string }): string | undefined;
}

export interface FrameworkThemeResolver {
  resolveThemeValue(input: { property: string; themeCondition: StyleCondition }): StyleSourceOwner | undefined;
}

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/style-write/types.test.ts`
Expected: PASS — all plan discrimination tests pass

- [ ] **Step 5: Commit**

```bash
git add lib/style-write/types.ts lib/style-write/types.test.ts
git commit -m "feat(style-write): add StyleWritePlan union, context, result, and framework adapter interfaces"
```

---

## Task 3: Create InspectorValueCodec

Validates and normalizes user input to canonical inspector form. Does NOT convert to target value spaces — adapters do that.

**Files:**

- Create: `lib/style-values/inspector-value-codec.ts`
- Test: `lib/style-values/inspector-value-codec.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// lib/style-values/inspector-value-codec.test.ts
/**
 * @file Tests for InspectorValueCodec — inspector-form validation and normalization
 *
 * Accessed via: bun run test lib/style-values/inspector-value-codec.test.ts
 * Assumptions: inspector canonical form is 0-100 for opacity, unitless numbers for lengths
 */
import { describe, expect, it } from 'bun:test';
import { inspectorValueCodec } from './inspector-value-codec';

describe('InspectorValueCodec.normalize', () => {
  describe('opacity', () => {
    it('passes through integer string', () => {
      const result = inspectorValueCodec.normalize({ key: 'opacity', value: '50' });
      expect(result.value).toBe('50');
    });

    it('normalizes percentage string to integer', () => {
      const result = inspectorValueCodec.normalize({ key: 'opacity', value: '50%' });
      expect(result.value).toBe('50');
    });

    it('normalizes number to string', () => {
      const result = inspectorValueCodec.normalize({ key: 'opacity', value: 50 });
      expect(result.value).toBe('50');
    });

    it('normalizes float string to integer string', () => {
      const result = inspectorValueCodec.normalize({ key: 'opacity', value: '50.0' });
      expect(result.value).toBe('50');
    });

    it('preserves non-integer float', () => {
      const result = inspectorValueCodec.normalize({ key: 'opacity', value: '33.5' });
      expect(result.value).toBe('33.5');
    });

    it('clamps value above 100', () => {
      const result = inspectorValueCodec.normalize({ key: 'opacity', value: '150' });
      expect(result.value).toBe('100');
    });

    it('clamps negative value', () => {
      const result = inspectorValueCodec.normalize({ key: 'opacity', value: '-10' });
      expect(result.value).toBe('0');
    });

    it('rejects non-numeric value', () => {
      expect(() => inspectorValueCodec.normalize({ key: 'opacity', value: 'foo' })).toThrow();
    });

    it('normalizes empty string as remove', () => {
      const result = inspectorValueCodec.normalize({ key: 'opacity', value: '' });
      expect(result.kind).toBe('remove');
    });
  });

  describe('lengths (padding, margin, width, etc.)', () => {
    it('strips px suffix to bare number', () => {
      const result = inspectorValueCodec.normalize({ key: 'paddingLeft', value: '16px' });
      expect(result.value).toBe('16');
    });

    it('passes through bare number', () => {
      const result = inspectorValueCodec.normalize({ key: 'paddingLeft', value: '16' });
      expect(result.value).toBe('16');
    });

    it('passes through number type', () => {
      const result = inspectorValueCodec.normalize({ key: 'width', value: 16 });
      expect(result.value).toBe('16');
    });

    it('preserves auto keyword', () => {
      const result = inspectorValueCodec.normalize({ key: 'width', value: 'auto' });
      expect(result.value).toBe('auto');
    });

    it('preserves percentage', () => {
      const result = inspectorValueCodec.normalize({ key: 'width', value: '50%' });
      expect(result.value).toBe('50%');
    });

    it('preserves rem units', () => {
      const result = inspectorValueCodec.normalize({ key: 'paddingLeft', value: '1rem' });
      expect(result.value).toBe('1rem');
    });

    it('preserves vh/vw units', () => {
      const result = inspectorValueCodec.normalize({ key: 'height', value: '100vh' });
      expect(result.value).toBe('100vh');
    });

    it('normalizes empty string as remove', () => {
      const result = inspectorValueCodec.normalize({ key: 'paddingLeft', value: '' });
      expect(result.kind).toBe('remove');
    });

    it('preserves fit-content keyword', () => {
      const result = inspectorValueCodec.normalize({ key: 'width', value: 'fit-content' });
      expect(result.value).toBe('fit-content');
    });

    it('preserves min-content keyword', () => {
      const result = inspectorValueCodec.normalize({ key: 'width', value: 'min-content' });
      expect(result.value).toBe('min-content');
    });

    it('preserves negative values', () => {
      const result = inspectorValueCodec.normalize({ key: 'marginLeft', value: '-8' });
      expect(result.value).toBe('-8');
    });
  });

  describe('colors', () => {
    it('passes through hex color', () => {
      const result = inspectorValueCodec.normalize({ key: 'backgroundColor', value: '#4285f4' });
      expect(result.value).toBe('#4285f4');
    });

    it('passes through rgb color', () => {
      const result = inspectorValueCodec.normalize({ key: 'color', value: 'rgb(255, 0, 0)' });
      expect(result.value).toBe('rgb(255, 0, 0)');
    });

    it('passes through named color', () => {
      const result = inspectorValueCodec.normalize({ key: 'borderColor', value: 'red' });
      expect(result.value).toBe('red');
    });

    it('passes through transparent', () => {
      const result = inspectorValueCodec.normalize({ key: 'backgroundColor', value: 'transparent' });
      expect(result.value).toBe('transparent');
    });

    it('normalizes empty string as remove', () => {
      const result = inspectorValueCodec.normalize({ key: 'backgroundColor', value: '' });
      expect(result.kind).toBe('remove');
    });
  });

  describe('enum properties', () => {
    it('passes through display value', () => {
      const result = inspectorValueCodec.normalize({ key: 'display', value: 'flex' });
      expect(result.value).toBe('flex');
    });

    it('passes through position value', () => {
      const result = inspectorValueCodec.normalize({ key: 'position', value: 'absolute' });
      expect(result.value).toBe('absolute');
    });

    it('passes through flexDirection value', () => {
      const result = inspectorValueCodec.normalize({ key: 'flexDirection', value: 'column' });
      expect(result.value).toBe('column');
    });
  });
});

describe('InspectorValueCodec.format', () => {
  it('formats opacity value for display', () => {
    const result = inspectorValueCodec.format({ key: 'opacity', value: '50' });
    expect(result).toBe('50');
  });

  it('formats length value for display', () => {
    const result = inspectorValueCodec.format({ key: 'paddingLeft', value: '16' });
    expect(result).toBe('16');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/style-values/inspector-value-codec.test.ts`
Expected: FAIL — module `./inspector-value-codec` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/style-values/inspector-value-codec.ts
/**
 * @file InspectorValueCodec — validates and normalizes user input to inspector canonical form
 *
 * Accessed via: Inspector UI → codec → write pipeline, adapter readers → codec → UI display
 * Assumptions: inspector canonical form is 0-100 for opacity, unitless numbers for lengths
 *   Per-target conversion (opacity 50→0.5 for CSS, 50→opacity-50 for Tailwind) is NOT
 *   this module's responsibility — that lives in framework adapter writers.
 */

export interface NormalizedInspectorValue {
  kind: 'value' | 'remove';
  value: string;
}

interface NormalizeInput {
  key: string;
  value: unknown;
}

interface FormatInput {
  key: string;
  value: string;
}

const OPACITY_KEYS = new Set(['opacity']);

const SIZE_KEYWORDS = new Set([
  'auto',
  'inherit',
  'initial',
  'unset',
  'revert',
  'min-content',
  'max-content',
  'fit-content',
  'none',
]);

const COLOR_KEYS = new Set([
  'color',
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'textDecorationColor',
  'caretColor',
  'shadowColor',
  'fill',
  'stroke',
]);

function isLengthProperty(key: string): boolean {
  return (
    key.startsWith('padding') ||
    key.startsWith('margin') ||
    (key.startsWith('border') && key.endsWith('Width')) ||
    (key.startsWith('border') && key.endsWith('Radius')) ||
    key === 'width' ||
    key === 'height' ||
    key === 'minWidth' ||
    key === 'minHeight' ||
    key === 'maxWidth' ||
    key === 'maxHeight' ||
    key === 'top' ||
    key === 'right' ||
    key === 'bottom' ||
    key === 'left' ||
    key === 'gap' ||
    key === 'rowGap' ||
    key === 'columnGap' ||
    key === 'fontSize' ||
    key === 'lineHeight' ||
    key === 'letterSpacing' ||
    key === 'wordSpacing' ||
    key === 'textIndent' ||
    key === 'outlineWidth' ||
    key === 'outlineOffset' ||
    key === 'borderRadius' ||
    key === 'borderRadiusTopLeft' ||
    key === 'borderRadiusTopRight' ||
    key === 'borderRadiusBottomLeft' ||
    key === 'borderRadiusBottomRight'
  );
}

function normalizeOpacity(raw: unknown): NormalizedInspectorValue {
  const str = String(raw).trim();
  if (str === '') return { kind: 'remove', value: '' };

  let numStr = str;
  if (numStr.endsWith('%')) {
    numStr = numStr.slice(0, -1);
  }

  const num = Number.parseFloat(numStr);
  if (Number.isNaN(num)) {
    throw new Error(`Invalid opacity value: ${String(raw)}`);
  }

  const clamped = Math.max(0, Math.min(100, num));
  const formatted = clamped === Math.trunc(clamped) ? String(Math.trunc(clamped)) : String(clamped);
  return { kind: 'value', value: formatted };
}

function normalizeLength(raw: unknown): NormalizedInspectorValue {
  const str = String(raw).trim();
  if (str === '') return { kind: 'remove', value: '' };

  // Check for keyword values
  if (SIZE_KEYWORDS.has(str)) {
    return { kind: 'value', value: str };
  }

  // Check for values with non-px units — preserve as-is
  if (/^-?\d+(\.\d+)?(rem|em|vh|vw|vmin|vmax|ch|ex|svh|svw|dvh|dvw|lvh|lvw|cqi|cqb|%)$/.test(str)) {
    return { kind: 'value', value: str };
  }

  // Strip px suffix for bare number canonical form
  if (str.endsWith('px')) {
    const num = str.slice(0, -2);
    return { kind: 'value', value: num };
  }

  // Bare number or negative number — pass through
  if (/^-?\d+(\.\d+)?$/.test(str)) {
    return { kind: 'value', value: str };
  }

  // CSS functions and other complex values — pass through
  return { kind: 'value', value: str };
}

function normalizeColor(raw: unknown): NormalizedInspectorValue {
  const str = String(raw).trim();
  if (str === '') return { kind: 'remove', value: '' };
  return { kind: 'value', value: str };
}

function normalizeGeneric(raw: unknown): NormalizedInspectorValue {
  const str = String(raw).trim();
  if (str === '') return { kind: 'remove', value: '' };
  return { kind: 'value', value: str };
}

function normalize(input: NormalizeInput): NormalizedInspectorValue {
  const { key, value } = input;

  if (OPACITY_KEYS.has(key)) {
    return normalizeOpacity(value);
  }

  if (isLengthProperty(key)) {
    return normalizeLength(value);
  }

  if (COLOR_KEYS.has(key)) {
    return normalizeColor(value);
  }

  return normalizeGeneric(value);
}

function format(input: FormatInput): string {
  return input.value;
}

export const inspectorValueCodec = { normalize, format };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/style-values/inspector-value-codec.test.ts`
Expected: PASS — all normalization and format tests pass

- [ ] **Step 5: Commit**

```bash
git add lib/style-values/inspector-value-codec.ts lib/style-values/inspector-value-codec.test.ts
git commit -m "feat(style-values): add InspectorValueCodec for inspector-form validation and normalization"
```

---

## Task 4: Create CssRuntimeNormalizer

Browser-backed CSS validation using CSS.supports from happy-dom in tests. CSS-target adapter writers call this after converting canonical inspector values to CSS values.

**Files:**

- Create: `lib/style-values/css-runtime-normalizer.ts`
- Test: `lib/style-values/css-runtime-normalizer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// lib/style-values/css-runtime-normalizer.test.ts
/**
 * @file Tests for CssRuntimeNormalizer — browser CSS.supports validation
 *
 * Accessed via: bun run test lib/style-values/css-runtime-normalizer.test.ts
 * Assumptions: happy-dom provides CSS.supports from test/setup.ts preload
 */
import { describe, expect, it } from 'bun:test';
import { cssRuntimeNormalizer } from './css-runtime-normalizer';

describe('CssRuntimeNormalizer.normalize', () => {
  describe('length properties', () => {
    it('appends px to bare number for length properties', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'padding-left', value: '16' });
      expect(result).toEqual({ kind: 'value', value: '16px' });
    });

    it('passes through value with px already', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'padding-left', value: '16px' });
      expect(result).toEqual({ kind: 'value', value: '16px' });
    });

    it('passes through value with rem', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'margin-top', value: '1rem' });
      expect(result).toEqual({ kind: 'value', value: '1rem' });
    });

    it('passes through auto keyword', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'width', value: 'auto' });
      expect(result).toEqual({ kind: 'value', value: 'auto' });
    });

    it('passes through percentage', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'width', value: '50%' });
      expect(result).toEqual({ kind: 'value', value: '50%' });
    });

    it('handles negative bare numbers', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'margin-left', value: '-8' });
      expect(result).toEqual({ kind: 'value', value: '-8px' });
    });
  });

  describe('opacity', () => {
    it('passes through valid CSS opacity', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'opacity', value: '0.5' });
      expect(result).toEqual({ kind: 'value', value: '0.5' });
    });

    it('passes through integer opacity (CSS accepts it)', () => {
      // CSS.supports("opacity", "1") → true, browser clamps to valid range
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'opacity', value: '1' });
      expect(result).toEqual({ kind: 'value', value: '1' });
    });
  });

  describe('color properties', () => {
    it('passes through hex color', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'background-color', value: '#4285f4' });
      expect(result).toEqual({ kind: 'value', value: '#4285f4' });
    });

    it('passes through named color', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'color', value: 'red' });
      expect(result).toEqual({ kind: 'value', value: 'red' });
    });

    it('passes through transparent', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'background-color', value: 'transparent' });
      expect(result).toEqual({ kind: 'value', value: 'transparent' });
    });
  });

  describe('remove', () => {
    it('returns remove for empty string', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'padding-left', value: '' });
      expect(result).toEqual({ kind: 'remove' });
    });
  });

  describe('invalid values', () => {
    it('rejects nonsense value', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'width', value: 'foo' });
      expect(result.kind).toBe('invalid');
    });

    it('rejects nonsense with px appended', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'width', value: 'abc' });
      expect(result.kind).toBe('invalid');
    });
  });

  describe('enum/keyword properties', () => {
    it('passes through valid display value', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'display', value: 'flex' });
      expect(result).toEqual({ kind: 'value', value: 'flex' });
    });

    it('passes through valid position value', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'position', value: 'absolute' });
      expect(result).toEqual({ kind: 'value', value: 'absolute' });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/style-values/css-runtime-normalizer.test.ts`
Expected: FAIL — module `./css-runtime-normalizer` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/style-values/css-runtime-normalizer.ts
/**
 * @file CssRuntimeNormalizer — validates and normalizes CSS values using browser CSS APIs
 *
 * Accessed via: CSS-target adapter writers call this after converting canonical inspector
 *   values to CSS values, before emitting the write plan.
 * Assumptions: globalThis.CSS.supports is available (browser, happy-dom in tests).
 *   Non-CSS adapters (Tailwind, Tamagui) do NOT call this — they have their own validation.
 */

export type CssNormalizationResult =
  | { kind: 'value'; value: string }
  | { kind: 'remove' }
  | { kind: 'invalid'; reason: string };

interface NormalizeInput {
  cssProperty: string;
  value: string;
}

/**
 * Check if CSS.supports is available. Falls back to static heuristics when not.
 */
function hasCssSupports(): boolean {
  return typeof globalThis.CSS !== 'undefined' && typeof globalThis.CSS.supports === 'function';
}

/**
 * Try CSS.supports for the property/value pair. Returns true if the browser
 * CSS parser accepts the declaration.
 */
function cssSupports(property: string, value: string): boolean {
  if (hasCssSupports()) {
    try {
      return CSS.supports(property, value);
    } catch {
      return false;
    }
  }
  // Static fallback for Node.js unit tests without happy-dom
  return staticFallbackSupports(property, value);
}

/**
 * Intentionally incomplete static fallback. Covers enough for unit tests
 * but must not be used as a production substitute for browser CSS APIs.
 */
function staticFallbackSupports(property: string, value: string): boolean {
  // Keywords valid for most properties
  if (['inherit', 'initial', 'unset', 'revert'].includes(value)) return true;

  // Opacity accepts any number
  if (property === 'opacity') return /^-?\d+(\.\d+)?$/.test(value);

  // Display/position enum values
  if (property === 'display') {
    return [
      'block',
      'inline',
      'flex',
      'grid',
      'inline-flex',
      'inline-grid',
      'inline-block',
      'none',
      'contents',
      'table',
      'list-item',
      'flow-root',
    ].includes(value);
  }
  if (property === 'position') {
    return ['static', 'relative', 'absolute', 'fixed', 'sticky'].includes(value);
  }

  // Color values — basic check
  if (property.includes('color') || property === 'background-color') {
    if (/^#([0-9a-fA-F]{3,8})$/.test(value)) return true;
    if (/^(rgb|rgba|hsl|hsla|oklch|lch|lab|oklab)\(/.test(value)) return true;
    if (
      [
        'transparent',
        'currentColor',
        'red',
        'blue',
        'green',
        'black',
        'white',
        'gray',
        'grey',
        'orange',
        'yellow',
        'purple',
        'pink',
        'brown',
        'cyan',
        'magenta',
        'navy',
        'teal',
        'lime',
        'aqua',
        'silver',
        'gold',
      ].includes(value)
    )
      return true;
  }

  // Length values with units
  if (/^-?\d+(\.\d+)?(px|rem|em|vh|vw|vmin|vmax|ch|ex|%)$/.test(value)) return true;

  // Keywords
  if (['auto', 'none', 'min-content', 'max-content', 'fit-content'].includes(value)) return true;

  // Flex direction, flex-wrap, align, justify, etc.
  if (
    [
      'row',
      'column',
      'row-reverse',
      'column-reverse',
      'wrap',
      'nowrap',
      'wrap-reverse',
      'flex-start',
      'flex-end',
      'center',
      'space-between',
      'space-around',
      'space-evenly',
      'start',
      'end',
      'stretch',
      'baseline',
      'hidden',
      'visible',
      'scroll',
      'clip',
    ].includes(value)
  )
    return true;

  return false;
}

const BARE_NUMBER_RE = /^-?\d+(\.\d+)?$/;

function normalize(input: NormalizeInput): CssNormalizationResult {
  const { cssProperty, value } = input;

  if (value === '') return { kind: 'remove' };

  // Try the value as-is first
  if (cssSupports(cssProperty, value)) {
    return { kind: 'value', value };
  }

  // If bare number, try appending px
  if (BARE_NUMBER_RE.test(value) && cssSupports(cssProperty, `${value}px`)) {
    return { kind: 'value', value: `${value}px` };
  }

  return { kind: 'invalid', reason: `${cssProperty}: ${value}` };
}

export const cssRuntimeNormalizer = { normalize };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/style-values/css-runtime-normalizer.test.ts`
Expected: PASS — all CSS normalization tests pass

- [ ] **Step 5: Commit**

```bash
git add lib/style-values/css-runtime-normalizer.ts lib/style-values/css-runtime-normalizer.test.ts
git commit -m "feat(style-values): add CssRuntimeNormalizer with browser CSS.supports validation"
```

---

## Task 5: Verify all tests pass together

Run the full test suite to confirm no regressions.

- [ ] **Step 1: Run all new tests**

Run: `bun run test lib/style-read/ lib/style-values/ lib/style-write/`
Expected: PASS — all tests across all three new modules pass

- [ ] **Step 2: Run full project test suite**

Run: `bun run test`
Expected: PASS — no regressions in existing tests

- [ ] **Step 3: Run type checker**

Run: `npx tsc --noEmit`
Expected: no new errors from our modules (pre-existing errors may exist)

- [ ] **Step 4: Run linter**

Run: `biome check lib/style-read/ lib/style-values/ lib/style-write/`
Expected: no warnings or errors

---

## Summary

After completing all tasks, the codebase will have:

| Module                                       | Files             | Purpose                                                                                                                     |
| -------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `lib/style-read/types.ts`                    | 1 source + 1 test | CssSystemId, SourceForm, StyleCondition, StyleSourceOwner, ProjectStyleCapabilities, ElementStyleFacts, ComponentPropMapper |
| `lib/style-write/types.ts`                   | 1 source + 1 test | StyleWritePlan union (6 variants), StyleWriteContext, StyleWriteResult, FrameworkStyleAdapter, StyleWriteManager            |
| `lib/style-values/inspector-value-codec.ts`  | 1 source + 1 test | Normalize/format inspector values (opacity 0-100, lengths, colors)                                                          |
| `lib/style-values/css-runtime-normalizer.ts` | 1 source + 1 test | Browser CSS.supports validation, px unit appending, static Node.js fallback                                                 |

This is the foundation for all subsequent phases. Next phases will build framework adapters, read/write managers, and platform integration on top of these types and modules.
