# DS Core — Design System Intelligence Engine

**Date:** 2026-04-01
**Author:** Alex Ultra + Claude
**Status:** Draft (Pass 1 — Architecture)
**Linear:** HYP-123 (parent), HYP-294, HYP-313, HYP-267, HYP-314

## Vision

A standalone design system engine built on two proven models:

**ESLint/Biome for design** — a pluggable linter with familiar config format,
built-in rule presets (Apple HIG, Material Design 3, Fluent, WCAG), custom
rules, autofixes, pre-commit hooks, and CLI. Any developer who has configured
a linter already knows this DX.

**Kubernetes for UI** — the user declares the **desired state** (tokens,
rules, constraints) and the system continuously reconciles it against the
**actual state** extracted from code. Drift detection, violation reports,
and auto-remediation — not one-shot checks, but continuous reconciliation.

Not a documentation tool. Not a style guide generator. A **verification and
enforcement engine** with AI-powered validation and a self-improving decision
template system.

> `core + cli + sdk + mcp + ui + adapters`

### Positioning

> "You don't make AI design systems better by adding more documentation. You
> make it better with linters, test harnesses, and tooling that verifies itself."
> — Brian Lonsdorf

DS Core is the "design harness" — machine-readable, verifiable, enforceable.

### Unique Differentiators

1. **Kubernetes-style reconciliation** — declarative desired state vs extracted
   actual state, with drift detection and auto-remediation
2. **Two-tier validation** — algorithmic for tokens, AI for high-level rules,
   with learned templates bridging the gap
3. **Self-improving** — AI decisions crystallize into deterministic templates,
   reviewed by humans, applied automatically next time
4. **Framework-agnostic** — works with any CSS framework via DI adapters
5. **Multi-surface** — same engine powers SDK, CLI, MCP, UI, and pre-commit hooks

---

## 1. Package Structure

```
packages/ds-core/
  src/
    index.ts                          -- Public API
    types/
      rule.ts                         -- Rule, RuleSection, RuleParam schemas
      state.ts                        -- DesiredState, ActualState, Violation
      template.ts                     -- DecisionTemplate, TemplateMatch
      adapters.ts                     -- DI adapter interfaces
      config.ts                       -- DSConfig schema

    config/
      loader.ts                       -- Load DS config from .hyperide/ds.config.ts
      defaults.ts                     -- Default rule values per section
      schema.ts                       -- Zod schemas for config validation

    extractor/
      extractor.ts                    -- ActualState extraction orchestrator
      color-extractor.ts              -- Extract color usage from code
      typography-extractor.ts         -- Extract font usage
      spacing-extractor.ts            -- Extract spacing patterns
      accessibility-extractor.ts      -- Extract a11y state
      component-extractor.ts          -- Extract component patterns

    reconciler/
      reconciler.ts                   -- Core diff engine (desired vs actual)
      violation.ts                    -- Violation creation and formatting
      autofix.ts                      -- Fix generation and application

    validators/
      algorithmic/                    -- Deterministic validators
        color-contrast.ts
        token-usage.ts
        spacing-grid.ts
        typography-scale.ts
        tap-targets.ts
        ...
      templates/
        template-store.ts             -- Template CRUD (DB or JSON file)
        template-matcher.ts           -- Pattern matching against templates
        template-generator.ts         -- AI → template crystallization
      ai/
        ai-validator.ts               -- AI validation orchestrator
        prompts/                      -- Section-specific prompts
          color-prompt.ts
          typography-prompt.ts
          tone-of-voice-prompt.ts
          motion-prompt.ts
          accessibility-prompt.ts
          ...

    rules/
      registry.ts                     -- Rule registry (built-in + custom)
      sections/
        color.ts                      -- Built-in color rules
        typography.ts                 -- Built-in typography rules
        spacing.ts                    -- Built-in spacing rules
        accessibility.ts              -- Built-in a11y rules
        tone-of-voice.ts              -- Built-in writing rules
        motion.ts                     -- Built-in animation rules
        navigation.ts                 -- Built-in navigation rules
        elevation.ts                  -- Built-in shadow/elevation rules
        components.ts                 -- Built-in component rules
        iconography.ts                -- Built-in icon rules

    presets/
      apple-hig.ts                    -- Apple HIG preset (224 rules)
      material-design.ts              -- Material Design 3 preset
      fluent.ts                       -- Microsoft Fluent preset
      web-accessibility.ts            -- WCAG 2.1 AA/AAA preset
      minimal.ts                      -- Minimal sensible defaults

    importers/
      figma/
        figma-tokens.ts               -- Import from Figma Variables/Tokens
        figma-styles.ts               -- Import from Figma Styles
        figma-layout.ts               -- Import layout constraints
      tailwind/
        tailwind-config.ts            -- Extract DS from tailwind.config
      css-variables/
        css-vars.ts                   -- Extract DS from CSS custom properties

    surfaces/
      sdk.ts                          -- Programmatic API
      cli.ts                          -- CLI entry point
      mcp.ts                          -- MCP tool definitions
      pre-commit.ts                   -- Pre-commit hook integration

  tests/
    ...

  package.json
  tsconfig.json
```

---

## 2. DI Adapter Interfaces

DS Core depends on **zero** concrete implementations. All external capabilities
are injected via typed interfaces.

```typescript
// packages/ds-core/src/types/adapters.ts

/**
 * Reads styles from code/DOM — the "eyes" of the extractor.
 *
 * HyperCanvas provides: TailwindAdapter, TamaguiAdapter, InlineStyleAdapter, etc.
 * External consumers provide their own implementations.
 */
export interface StyleReadAdapter {
  readonly framework: string

  /** Read computed/declared styles from an element or AST node */
  readStyles(target: StyleTarget): Promise<ParsedStyles>

  /** List all style declarations in a file */
  listDeclarations(filePath: string): Promise<StyleDeclaration[]>

  /** Resolve a class/token name to concrete CSS values */
  resolveToken(token: string): ResolvedValue | null
}

/**
 * Writes style fixes back to code.
 * Separate from read — some consumers may want read-only validation.
 */
export interface StyleWriteAdapter {
  readonly framework: string

  /** Apply a single style fix */
  applyFix(fix: StyleFix): Promise<FixResult>

  /** Apply multiple fixes atomically */
  applyFixBatch(fixes: StyleFix[]): Promise<FixResult>
}

/**
 * Provides color token information — the "palette dictionary".
 *
 * HyperCanvas provides: TailwindColorTokenProvider, TamaguiColorTokenProvider.
 */
export interface TokenProvider {
  /** List all available tokens, optionally filtered by category */
  listTokens(category?: TokenCategory): Promise<DesignToken[]>

  /** Find the nearest token to a given value */
  findNearest(value: string, count?: number): Promise<TokenMatch[]>

  /** Resolve a token reference to its concrete value */
  resolve(tokenRef: string): ResolvedValue | null

  /** Get all token categories (color, spacing, typography, etc.) */
  getCategories(): TokenCategory[]
}

/**
 * Provides component information — knows what components exist,
 * their props, their composition patterns.
 *
 * HyperCanvas provides: ComponentScanner.
 */
export interface ComponentIntrospector {
  /** List all components in the project */
  listComponents(): Promise<ComponentInfo[]>

  /** Get detailed info about a specific component */
  getComponent(name: string): Promise<ComponentDetail | null>

  /** Find components by usage pattern (e.g., "renders children") */
  findByPattern(pattern: ComponentPattern): Promise<ComponentInfo[]>
}

/**
 * AI provider for validation — the "brain" for high-level rules.
 * Abstracted so DS Core doesn't depend on any specific AI SDK.
 */
export interface AIProvider {
  /** Ask AI to validate code against a rule */
  validate(request: AIValidationRequest): Promise<AIValidationResult>

  /** Ask AI to suggest a fix for a violation */
  suggestFix(violation: Violation, context: CodeContext): Promise<FixSuggestion[]>

  /** Ask AI to generate a decision template from a validation result */
  generateTemplate(
    result: AIValidationResult,
    context: CodeContext,
  ): Promise<CandidateTemplate | null>
}

/**
 * File system access — abstracted for testability and remote execution.
 */
export interface FileSystem {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  glob(pattern: string, cwd?: string): Promise<string[]>
  exists(path: string): Promise<boolean>
}

/**
 * AST access — reads and modifies source code structure.
 * Optional: not all consumers need AST-level analysis.
 */
export interface ASTProvider {
  /** Parse a file into an AST */
  parse(filePath: string): Promise<ASTNode>

  /** Find nodes matching a pattern */
  query(ast: ASTNode, selector: string): ASTNode[]

  /** Apply a transformation to the AST and write back */
  transform(filePath: string, transform: ASTTransform): Promise<void>
}

/**
 * Template persistence — stores and retrieves decision templates.
 * Could be a JSON file, SQLite, or remote API.
 */
export interface TemplateStore {
  list(filter?: TemplateFilter): Promise<DecisionTemplate[]>
  get(id: string): Promise<DecisionTemplate | null>
  save(template: DecisionTemplate): Promise<void>
  updateStatus(id: string, status: TemplateStatus): Promise<void>
  findMatching(context: MatchContext): Promise<DecisionTemplate[]>
}
```

### Adapter Registration

```typescript
// packages/ds-core/src/index.ts

export class DSCore {
  private styleAdapters: Map<string, StyleReadAdapter> = new Map()
  private tokenProviders: Map<string, TokenProvider> = new Map()

  constructor(private config: DSCoreConfig) {}

  /** Register a style adapter for a framework */
  registerStyleAdapter(adapter: StyleReadAdapter): void {
    this.styleAdapters.set(adapter.framework, adapter)
  }

  /** Register a style write adapter (optional, for autofixes) */
  registerStyleWriter(adapter: StyleWriteAdapter): void { ... }

  /** Register a token provider */
  registerTokenProvider(provider: TokenProvider): void { ... }

  /** Register component introspector */
  registerComponentIntrospector(introspector: ComponentIntrospector): void { ... }

  /** Register AI provider (required for AI-validated rules) */
  registerAIProvider(provider: AIProvider): void { ... }

  /** Register template store */
  registerTemplateStore(store: TemplateStore): void { ... }

  /** Register file system (defaults to Node fs) */
  registerFileSystem(fs: FileSystem): void { ... }

  /** Register AST provider (optional) */
  registerASTProvider(ast: ASTProvider): void { ... }

  // --- Core operations ---

  /** Extract actual state from the project */
  async extractActualState(): Promise<ActualState> { ... }

  /** Load desired state from config + Figma + overrides */
  async loadDesiredState(): Promise<DesiredState> { ... }

  /** Reconcile: diff desired vs actual, produce violations */
  async reconcile(): Promise<ReconciliationReport> { ... }

  /** Validate specific files (for pre-commit / incremental) */
  async validateFiles(files: string[]): Promise<Violation[]> { ... }

  /** Apply autofixes for a set of violations */
  async autofix(violations: Violation[]): Promise<FixReport> { ... }
}
```

---

## 3. State Model

### 3.1 Desired State

The desired state is built from three layers, merged in priority order:

```
Layer 1: Inferred baseline     (scan project: tailwind.config, CSS vars, theme)
Layer 2: Figma import           (optional: Figma Variables API, Tokens plugin)
Layer 3: Explicit config        (.hyperide/ds.config.ts or ds.config.json)
  └─ Token overrides            (specific values: primary = #0066CC)
  └─ Rule overrides             (enable/disable, change severity, set params)
  └─ Custom rules               (user-defined rules with Zod schemas)
```

Later layers override earlier layers. Conflicts are reported as warnings.

```typescript
// packages/ds-core/src/types/state.ts

export interface DesiredState {
  /** Resolved tokens (merged from all layers) */
  tokens: DesignTokenSet

  /** Active rules with resolved params */
  rules: ResolvedRule[]

  /** Layer provenance — where each value came from */
  provenance: Map<string, StateProvenance>

  /** Conflicts between layers */
  conflicts: StateConflict[]
}

export interface DesignTokenSet {
  colors: ColorTokenGroup[]
  typography: TypographyTokenGroup
  spacing: SpacingTokenGroup
  elevation: ElevationTokenGroup
  motion: MotionTokenGroup
  shape: ShapeTokenGroup
  custom: Record<string, CustomTokenGroup>
}

export interface ColorTokenGroup {
  /** Group name: "primary", "neutral", "error", etc. */
  name: string
  /** Role-based semantic colors */
  roles: Record<string, ColorToken>        // { "base": "#0066CC", "on-base": "#FFFFFF", ... }
  /** Full scale (if applicable) */
  scale?: Record<string, string>            // { "50": "#E6F0FF", "100": "#CCE0FF", ... }
  /** Source layer */
  source: 'inferred' | 'figma' | 'config'
}

export interface TypographyTokenGroup {
  fontFamilies: Record<string, string>      // { "display": "Inter", "body": "Inter", "mono": "JetBrains Mono" }
  typeScale: TypeScaleEntry[]               // Ordered: display-lg, display, headline, title, body, caption...
  lineHeights: Record<string, string>       // { "tight": "1.2", "normal": "1.5", "loose": "1.8" }
  fontWeights: Record<string, number>       // { "regular": 400, "medium": 500, "bold": 700 }
}

export interface TypeScaleEntry {
  name: string                              // "display-lg", "body-md", "caption-sm"
  fontSize: string                          // "3rem", "1rem", "0.75rem"
  lineHeight: string                        // "1.2", "1.5"
  fontWeight: number                        // 700, 400
  letterSpacing?: string                    // "-0.02em"
  fontFamily?: string                       // Override per entry
}

export interface SpacingTokenGroup {
  baseUnit: number                          // 4 (px)
  scale: Record<string, string>             // { "xs": "4px", "sm": "8px", "md": "16px", "lg": "24px", ... }
}

export type StateProvenance = {
  layer: 'inferred' | 'figma' | 'config'
  source: string                            // File path or "figma:variables/color"
  confidence: number                        // 0-1, how confident we are in inference
}
```

### 3.2 Actual State

```typescript
export interface ActualState {
  /** Colors actually used in the codebase */
  colors: ActualColorUsage[]

  /** Typography actually used */
  typography: ActualTypographyUsage[]

  /** Spacing values actually used */
  spacing: ActualSpacingUsage[]

  /** Components discovered */
  components: ActualComponentUsage[]

  /** Raw style declarations for deep analysis */
  declarations: StyleDeclaration[]

  /** Extraction metadata */
  meta: {
    extractedAt: string
    filesScanned: number
    framework: string
    adaptersUsed: string[]
  }
}

export interface ActualColorUsage {
  value: string                             // "#4597F7", "bg-blue-500", "$blue9"
  resolvedHex: string                       // "#4597F7" — always resolved
  locations: CodeLocation[]                 // Where it's used
  isToken: boolean                          // Does it reference a known token?
  tokenRef?: string                         // "blue-500" if isToken
  context: 'background' | 'text' | 'border' | 'shadow' | 'other'
  count: number                             // How many times used
}

export interface CodeLocation {
  filePath: string
  line: number
  column: number
  snippet: string                           // Short code snippet for context
}
```

### 3.3 Reconciliation Report

```typescript
export interface ReconciliationReport {
  /** All violations found */
  violations: Violation[]

  /** Summary counts */
  summary: {
    total: number
    errors: number
    warnings: number
    info: number
    autofixable: number
  }

  /** Per-section breakdown */
  sections: Record<string, SectionSummary>

  /** Discrepancies between desired tokens and actual usage */
  tokenDrift: TokenDrift[]

  /** Decision templates generated this run (pending approval) */
  newTemplates: CandidateTemplate[]

  /** Templates that were applied (shortcutted AI) */
  templatesApplied: TemplateApplication[]

  /** Metadata */
  meta: {
    duration: number                        // ms
    filesAnalyzed: number
    algorithmic: number                     // Count of algorithmic validations
    templateMatched: number                 // Count of template-shortcutted validations
    aiCalled: number                        // Count of AI validations
  }
}

export interface Violation {
  id: string                                // Unique violation ID
  ruleId: string                            // "color.contrast-min"
  section: string                           // "color"
  severity: 'error' | 'warning' | 'info'
  message: string                           // Human-readable description
  location: CodeLocation
  actual: string                            // What was found
  expected?: string                         // What was expected (if applicable)
  validatedBy: 'algorithmic' | 'template' | 'ai'
  fix?: FixSuggestion                       // Autofix if available
  templateCandidate?: boolean               // Can this become a template?
}

export interface TokenDrift {
  tokenName: string                         // "primary"
  desiredValue: string                      // "#0066CC"
  actualValues: Array<{
    value: string                           // "#4597F7"
    locations: CodeLocation[]
    count: number
  }>
  severity: 'error' | 'warning'
  message: string
}
```

---

## 4. Rule System

### 4.1 Rule Definition Schema

Rules use biome/eslint-style configuration. Validation strategy is inferred
from the super-section the rule lives in (`tokens` → algorithmic,
`patterns` → algorithmic+template+AI, `intent` → AI+template).

```typescript
// packages/ds-core/src/types/rule.ts

import { z } from 'zod'

export const SeveritySchema = z.enum(['error', 'warning', 'info', 'off'])
export type Severity = z.infer<typeof SeveritySchema>

/**
 * Config value for a rule — biome/eslint convention:
 *   'error'                     — enable with default params
 *   ['error']                   — same
 *   ['error', { ...opts }]      — enable with custom params
 *   'off'                       — disable
 */
export const RuleConfigSchema = z.union([
  SeveritySchema,
  z.tuple([SeveritySchema]),
  z.tuple([SeveritySchema, z.record(z.unknown())]),
])
export type RuleConfig = z.infer<typeof RuleConfigSchema>

/** Super-section determines validation strategy */
export const SuperSectionSchema = z.enum(['tokens', 'patterns', 'intent'])
export type SuperSection = z.infer<typeof SuperSectionSchema>

/**
 * Internal rule definition (built-in rules).
 * No `section` or `validation` fields — derived from registry position.
 */
export const RuleDefinitionSchema = z.object({
  /** Rule name (unique within its section): "contrast-min" */
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),

  /** Human-readable name */
  name: z.string(),

  /** Description of what this rule checks */
  description: z.string(),

  /** Default severity */
  defaultSeverity: SeveritySchema,

  /** Parameter schema — Zod schema for rule-specific opts */
  paramsSchema: z.instanceof(z.ZodType).optional(),

  /** Default parameter values */
  defaultParams: z.record(z.unknown()).optional(),

  /** Tags for filtering and preset selection */
  tags: z.array(z.string()).optional(),

  /** Source design system (for preset provenance) */
  origin: z.string().optional(),

  /** Whether this rule can produce autofixes */
  autofixable: z.boolean().default(false),
})

export type RuleDefinition = z.infer<typeof RuleDefinitionSchema>

/**
 * Resolved rule — after merging preset + user config.
 * Full path = `superSection.section.id` (e.g., "tokens.color.contrast-min").
 */
export interface ResolvedRule {
  fullId: string                            // "tokens.color.contrast-min"
  definition: RuleDefinition
  severity: Severity
  params: Record<string, unknown>
  superSection: SuperSection                // Determines validation strategy
  section: string
  enabled: boolean
}
```

### 4.2 Rule Sections

Each section groups related rules and provides its own param schemas.

```typescript
// packages/ds-core/src/rules/sections/color.ts

import { z } from 'zod'
import { defineSection } from '../registry'

export const colorSection = defineSection({
  id: 'color',
  name: 'Color',
  description: 'Color tokens, contrast, palette consistency, semantic usage',

  rules: [
    // --- Algorithmic rules ---
    {
      id: 'color.contrast-min',
      name: 'Minimum contrast ratio',
      description: 'Text must have sufficient contrast against its background',
      defaultSeverity: 'error',
      validation: ['algorithmic'],
      autofixable: true,
      paramsSchema: z.object({
        /** WCAG level */
        standard: z.enum(['AA', 'AAA']).default('AA'),
        /** Min ratio for normal text (auto-set from standard if omitted) */
        normalText: z.number().min(1).default(4.5),
        /** Min ratio for large text (>= 18pt or 14pt bold) */
        largeText: z.number().min(1).default(3),
        /** Min ratio for non-text elements (icons, borders) */
        nonText: z.number().min(1).default(3),
      }),
    },

    {
      id: 'color.no-hardcoded',
      name: 'No hardcoded color values',
      description: 'Colors must reference design tokens, not hardcoded hex/rgb values',
      defaultSeverity: 'warning',
      validation: ['algorithmic'],
      autofixable: true,
      paramsSchema: z.object({
        /** Allow hardcoded black/white */
        allowBlackWhite: z.boolean().default(false),
        /** Allow hardcoded in specific file patterns */
        ignoreFiles: z.array(z.string()).default([]),
        /** Allow specific hardcoded values (e.g., transparent, currentColor) */
        allowValues: z.array(z.string()).default(['transparent', 'currentColor', 'inherit']),
      }),
    },

    {
      id: 'color.palette-size',
      name: 'Palette size limit',
      description: 'Limit total number of unique colors to prevent palette bloat',
      defaultSeverity: 'warning',
      validation: ['algorithmic'],
      paramsSchema: z.object({
        maxUniqueColors: z.number().min(1).default(32),
        /** Ignore near-duplicates within this distance */
        dedupeThreshold: z.number().min(0).default(10),
      }),
    },

    {
      id: 'color.semantic-roles',
      name: 'Semantic color roles defined',
      description: 'Design system must define semantic color roles (primary, error, etc.)',
      defaultSeverity: 'warning',
      validation: ['algorithmic'],
      paramsSchema: z.object({
        requiredRoles: z.array(z.string()).default([
          'primary', 'secondary', 'background', 'surface',
          'error', 'on-primary', 'on-background', 'on-surface',
        ]),
      }),
    },

    {
      id: 'color.dark-mode',
      name: 'Dark mode color variants',
      description: 'All custom colors must have dark mode variants',
      defaultSeverity: 'warning',
      validation: ['algorithmic', 'ai'],
      paramsSchema: z.object({
        requireDarkVariant: z.boolean().default(true),
        /** Check contrast in dark mode independently */
        checkDarkContrast: z.boolean().default(true),
      }),
    },

    // --- AI-validated rules ---
    {
      id: 'color.harmony',
      name: 'Color harmony',
      description: 'Color palette should follow a coherent harmony model',
      defaultSeverity: 'info',
      validation: ['template', 'ai'],
      paramsSchema: z.object({
        /** Preferred harmony model */
        model: z.enum([
          'complementary', 'analogous', 'triadic',
          'split-complementary', 'monochromatic', 'custom',
        ]).default('custom'),
      }),
    },

    {
      id: 'color.independence',
      name: 'Information not conveyed by color alone',
      description: 'Status, selection, errors must use shape/icon/text in addition to color',
      defaultSeverity: 'error',
      validation: ['ai'],
      paramsSchema: z.object({
        /** Check grayscale usability */
        grayscaleTest: z.boolean().default(true),
        /** Check red-green independence */
        redGreenTest: z.boolean().default(true),
      }),
    },
  ],
})
```

### 4.3 User Config Format

Rule format follows biome/eslint convention:

```
'severity'                   — enable with severity, default params
['severity']                 — same as above (array form)
['severity', { ...opts }]    — enable with severity + custom params
'off'                        — disable rule
```

Rules are grouped into three super-sections that determine validation strategy:

- **`tokens`** — concrete values (colors, sizes, spacing, shape, elevation).
  Validated algorithmically via AST/computed styles. Deterministic.
- **`patterns`** — usage patterns (accessibility, navigation, state, components, motion).
  Algorithmic first, then template-matched, AI as fallback.
- **`intent`** — meaning and purpose (tone of voice, design quality).
  AI-validated, with learned templates as shortcuts.

```typescript
// .hyperide/ds.config.ts

import { defineDS } from '@hyperide/ds-core'

export default defineDS({
  preset: 'minimal',

  /** Token values (Layer 3 — explicit overrides) */
  values: {
    colors: {
      primary: {
        base: '#0066CC',
        'on-base': '#FFFFFF',
        scale: {
          50: '#E6F0FF', 100: '#CCE0FF', 200: '#99C2FF',
          300: '#66A3FF', 400: '#3385FF', 500: '#0066CC',
          600: '#0052A3', 700: '#003D7A', 800: '#002952',
          900: '#001429',
        },
      },
      error: { base: '#DC2626', 'on-base': '#FFFFFF' },
    },
    typography: {
      fontFamilies: { display: 'Cal Sans', body: 'Inter', mono: 'JetBrains Mono' },
      typeScale: [
        { name: 'display-lg', fontSize: '3rem', lineHeight: '1.1', fontWeight: 700 },
        { name: 'body', fontSize: '1rem', lineHeight: '1.5', fontWeight: 400 },
        { name: 'caption', fontSize: '0.75rem', lineHeight: '1.4', fontWeight: 400 },
        // ...
      ],
    },
    spacing: {
      baseUnit: 4,
      scale: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px' },
    },
  },

  /** Figma import (Layer 2) */
  figma: {
    fileId: 'abc123',
    tokensPluginFormat: 'tokens-studio',
    importOnInit: true,
    syncInterval: 'manual',
  },

  /** Rules — biome/eslint style */
  rules: {
    // ── tokens: algorithmic validation ──────────────────────
    tokens: {
      color: {
        'contrast-min': ['error', { standard: 'AA' }],
        'contrast-enhanced': 'off',
        'no-hardcoded': ['warning', { allowBlackWhite: true, ignoreFiles: ['**/*.test.*'] }],
        'palette-size': ['warning', { maxUniqueColors: 24 }],
        'semantic-roles': 'warning',
        'on-color-pairing': 'error',
        'dark-mode-variants': 'warning',
        'dark-mode-contrast': 'error',
        'surface-hierarchy': 'warning',
        'tonal-palette': 'error',
      },
      typography: {
        'scale-usage': 'error',
        'min-size': ['error', { minPx: 11 }],
        'no-fixed-sizes': 'warning',
        'line-height-ratio': 'warning',
        'weight-consistency': 'warning',
        'hierarchy-present': 'warning',
        'sentence-case': ['warning', { style: 'sentence' }],
        'font-family-roles': 'info',
      },
      spacing: {
        'grid-alignment': ['warning', { baseUnit: 4 }],
        'scale-usage': 'warning',
        'consistent-gaps': 'warning',
        'content-margins': 'warning',
      },
      shape: {
        'token-usage': 'warning',
        'no-arbitrary-radius': 'warning',
        'component-consistency': 'error',
      },
      elevation: {
        'level-tokens': 'warning',
        'disabled-flat': 'warning',
        'system-values': 'info',
      },
    },

    // ── patterns: algorithmic + template + AI fallback ─────
    patterns: {
      accessibility: {
        'tap-target-min': ['error', { minSize: 44 }],
        'tap-target-spacing': 'warning',
        'labels-present': 'error',
        'focus-visible': 'error',
        'focus-contrast': 'error',
        'focus-order': 'error',
        'keyboard-accessible': 'error',
        'escape-dismisses': 'error',
        'reduce-motion': 'error',
        'dark-mode-support': 'warning',
        'text-resize-200': 'error',
        'no-horizontal-scroll': 'error',
      },
      navigation: {
        'tab-count': ['warning', { min: 3, max: 5 }],
        'depth-limit': ['warning', { max: 4 }],
        'back-button': 'error',
        'modal-explicit-dismiss': 'warning',
        'no-nested-modals': 'warning',
        'responsive-pattern': 'warning',
      },
      state: {
        'hover-feedback': 'error',
        'focus-feedback': 'error',
        'press-feedback': 'warning',
        'disabled-no-interaction': 'warning',
      },
      motion: {
        'duration-range': ['warning', { min: 50, max: 1000 }],
        'duration-tokens': 'warning',
        'easing-tokens': 'warning',
        'no-linear': 'warning',
        'gpu-friendly': 'warning',
        'no-layout-thrash': 'warning',
      },
      components: {
        'button-min-size': 'error',
        'input-label-present': 'error',
        'dialog-min-width': 'error',
        'alert-max-buttons': 'warning',
        'alert-destructive-not-default': 'error',
      },
    },

    // ── intent: AI-validated + template shortcuts ──────────
    intent: {
      tone: {
        'writing-style': ['info', { style: 'friendly-professional' }],
        'no-jargon': 'warning',
        'no-blame': 'warning',
        'actionable-errors': 'warning',
        'specific-actions': 'warning',
        'consistent-voice': 'info',
      },
      quality: {
        'no-generic-fonts': 'info',
        'cohesive-aesthetic': 'info',
        'intentional-composition': 'info',
        'atmosphere-backgrounds': 'info',
      },
    },
  },

  /** Custom rules (user-defined) */
  customRules: [
    {
      id: 'no-comic-sans',
      superSection: 'tokens',
      section: 'typography',
      name: 'No Comic Sans',
      description: 'Comic Sans is banned from this project',
    },
  ],

  /** AI provider config */
  ai: {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    templateModel: 'claude-sonnet-4-6',
    maxAICalls: 50,
    templateApproval: 'required',
  },
})
```

---

## 5. Decision Template System

Adapted from the hypercalendarbot learner architecture. AI decisions are
captured, generalized into reusable templates, and approved by humans.

### 5.1 Template Structure

```typescript
// packages/ds-core/src/types/template.ts

import { z } from 'zod'

export const TemplateStatusSchema = z.enum(['pending', 'approved', 'rejected'])

/**
 * A decision template captures a reusable validation pattern.
 * Generated by AI from a concrete violation, generalized for reuse.
 */
export const DecisionTemplateSchema = z.object({
  /** Unique template ID */
  id: z.string().uuid(),

  /** Rule this template applies to */
  ruleId: z.string(),

  /** Human-readable name */
  name: z.string(),

  /** When to apply this template */
  match: z.object({
    /** CSS selector pattern (supports wildcards) */
    selector: z.string().optional(),

    /** CSS property being checked */
    property: z.string().optional(),

    /** File path glob pattern */
    fileGlob: z.string().optional(),

    /** AST node type pattern */
    nodeType: z.string().optional(),

    /** Component name pattern */
    componentName: z.string().optional(),

    /** Additional conditions (DSL expressions) */
    when: z.string().optional(),
  }),

  /** The decision this template produces */
  decision: z.enum(['pass', 'violation']),

  /** Confidence level when this template was generated (0-1) */
  confidence: z.number().min(0).max(1),

  /** Human-readable reasoning (why this decision) */
  reasoning: z.string(),

  /** Violation details (if decision === 'violation') */
  violation: z.object({
    message: z.string(),
    severity: RuleSeveritySchema.optional(),  // Override rule default
  }).optional(),

  /** Autofix recipe (if applicable) */
  fix: z.object({
    /** Fix strategy */
    type: z.enum([
      'replace-value',     // Replace a CSS value
      'add-class',         // Add a CSS class
      'remove-class',      // Remove a CSS class
      'replace-class',     // Replace one class with another
      'add-prop',          // Add a JSX prop
      'remove-prop',       // Remove a JSX prop
      'replace-prop',      // Replace a prop value
      'wrap-component',    // Wrap in a component
      'add-attribute',     // Add an HTML attribute
    ]),
    /** Target (CSS property, class name, prop name) */
    target: z.string(),
    /** New value (supports template variables: {{token.primary}}) */
    value: z.string().optional(),
    /** Description of what the fix does */
    description: z.string(),
  }).optional(),

  /** Provenance */
  status: TemplateStatusSchema,
  createdAt: z.string().datetime(),
  approvedAt: z.string().datetime().optional(),
  approvedBy: z.string().optional(),

  /** Original violation that generated this template */
  sourceViolationId: z.string().optional(),

  /** How many times this template has been applied */
  applyCount: z.number().default(0),

  /** Last time this template was applied */
  lastApplied: z.string().datetime().optional(),
})

export type DecisionTemplate = z.infer<typeof DecisionTemplateSchema>
```

### 5.2 Template Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                   AI validates a rule                         │
│                                                               │
│  1. AI analyzes code against rule                             │
│  2. AI produces: decision + reasoning + fix suggestion        │
│  3. System checks: is this generalizable?                     │
│     ├─ Skip if: too context-dependent, one-off code pattern   │
│     └─ Proceed if: repeating pattern, deterministic decision  │
│  4. AI generates candidate template:                          │
│     ├─ Generalize concrete values → patterns/wildcards        │
│     ├─ Extract match conditions                               │
│     └─ Formalize fix recipe                                   │
│  5. Template saved as status='pending'                        │
│                                                               │
│  ── Admin review ──                                          │
│                                                               │
│  6. Admin sees: template definition + source violation + AI   │
│     reasoning                                                 │
│  7. Admin: Approve / Edit / Reject                            │
│     ├─ Approve → status='approved', loaded into matcher       │
│     ├─ Edit → admin modifies match/fix, then approve          │
│     └─ Reject → status='rejected', not loaded                 │
│                                                               │
│  ── Production use ──                                        │
│                                                               │
│  8. Next reconciliation: template matcher runs BEFORE AI      │
│  9. If template matches: apply decision, skip AI call         │
│ 10. Optional: AI double-check (configurable per-rule)         │
│ 11. applyCount++ for analytics                                │
│                                                               │
│  ── Feedback loop ──                                         │
│                                                               │
│ 12. If template produces wrong result (user reports):         │
│     ├─ Template → status='rejected'                           │
│     └─ AI re-validates, generates improved template           │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 Template Match DSL

The `when` field in templates supports a safe expression language
(no eval, parsed and evaluated deterministically):

```
// Property comparisons
"property == 'background-color'"
"value.startsWith('#')"
"value.match(/^#[0-9a-f]{6}$/i)"

// Numeric comparisons
"contrastRatio < 4.5"
"fontSize < 12"
"spacing % 4 != 0"

// Context checks
"isInsideComponent('Button')"
"hasParent('.dark-mode')"
"fileMatches('**/components/**')"

// Boolean logic
"property == 'color' && !isToken(value)"
"severity == 'error' || (severity == 'warning' && confidence > 0.9)"
```

Available functions in template expressions:

| Function | Description |
|----------|-------------|
| `isToken(value)` | Value references a known design token |
| `contrastRatio(fg, bg)` | WCAG contrast ratio between two colors |
| `isInsideComponent(name)` | AST node is inside a named component |
| `hasParent(selector)` | DOM/AST node has a matching parent |
| `fileMatches(glob)` | Current file matches glob pattern |
| `nearestToken(value)` | Find nearest token for a value |
| `tokenDistance(value, token)` | Color distance between value and token |

---

## 6. Reconciliation Engine

### 6.1 Reconciliation Flow

```
                    ┌──────────────┐
                    │  DSCore.     │
                    │ reconcile()  │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ↓            ↓            ↓
     ┌────────────┐ ┌───────────┐ ┌──────────┐
     │ Load       │ │ Extract   │ │ Load     │
     │ Desired    │ │ Actual    │ │ Templates│
     │ State      │ │ State     │ │          │
     └─────┬──────┘ └─────┬─────┘ └────┬─────┘
           │               │            │
           └───────┬───────┘            │
                   ↓                    │
          ┌────────────────┐            │
          │ Token Drift    │←───────────┘
          │ Detection      │
          │ (algorithmic)  │
          └────────┬───────┘
                   ↓
          ┌────────────────┐
          │ Per-file rule  │
          │ validation     │
          │ loop           │
          └────────┬───────┘
                   │
        ┌──────────┼──────────┐
        ↓          ↓          ↓
   ┌─────────┐ ┌────────┐ ┌──────┐
   │Algorith-│ │Template│ │  AI  │
   │mic      │ │Match   │ │Valid-│
   │Validate │ │        │ │ation │
   └────┬────┘ └───┬────┘ └──┬───┘
        │          │         │
        └──────┬───┘         │
               │    ┌────────┘
               ↓    ↓
        ┌──────────────┐
        │ Collect      │
        │ Violations   │
        └──────┬───────┘
               ↓
        ┌──────────────┐
        │ Generate     │
        │ candidate    │
        │ templates    │
        └──────┬───────┘
               ↓
        ┌──────────────────┐
        │ Reconciliation   │
        │ Report           │
        └──────────────────┘
```

### 6.2 Validation Priority Chain

For each rule on each file/element:

```typescript
async function validateRule(
  rule: ResolvedRule,
  target: ValidationTarget,
  adapters: AdapterSet,
): Promise<RuleResult> {
  for (const strategy of rule.validation) {
    switch (strategy) {
      case 'algorithmic': {
        const validator = algorithmicValidators.get(rule.id)
        if (!validator) continue            // No algorithmic validator for this rule
        const result = validator.check(target, rule.params, adapters)
        if (result.conclusive) return result // Definitive answer
        continue                             // Inconclusive, try next strategy
      }

      case 'template': {
        const templates = await templateStore.findMatching({
          ruleId: rule.id,
          target,
        })
        if (templates.length === 0) continue // No matching template
        const best = templates[0]            // Highest confidence match
        return {
          decision: best.decision,
          validatedBy: 'template',
          templateId: best.id,
          fix: best.fix,
        }
      }

      case 'ai': {
        if (!aiProvider) continue             // No AI provider registered
        const result = await aiProvider.validate({
          rule,
          target,
          context: buildContext(target, adapters),
        })
        // Attempt template generation from AI result
        if (result.conclusive && result.confidence > 0.8) {
          const candidate = await aiProvider.generateTemplate(result, context)
          if (candidate) pendingTemplates.push(candidate)
        }
        return result
      }
    }
  }

  return { decision: 'pass', validatedBy: 'none', reason: 'No validator matched' }
}
```

### 6.3 Incremental Validation (Pre-commit)

Full reconciliation scans the entire project. Pre-commit mode validates
only changed files:

```typescript
async function validatePreCommit(
  changedFiles: string[],
): Promise<Violation[]> {
  // 1. Filter to relevant files (skip assets, configs, tests if configured)
  const relevantFiles = filterRelevant(changedFiles)

  // 2. Extract actual state for changed files only
  const partialActual = await extractor.extractFiles(relevantFiles)

  // 3. Load desired state (cached from last full reconciliation)
  const desired = await cache.getDesiredState()

  // 4. Run token drift detection on changed files
  const drift = detectTokenDrift(desired.tokens, partialActual)

  // 5. Run per-rule validation on changed files
  const violations = await validateFiles(relevantFiles, desired.rules)

  // 6. Return only new violations (not pre-existing)
  return filterNew(violations)
}
```

---

## 7. Surfaces

DS Core exposes the same engine through multiple surfaces.

### 7.1 SDK (Programmatic)

```typescript
import { DSCore } from '@hyperide/ds-core'
import { TailwindStyleAdapter } from '@hyperide/ds-tailwind-adapter'

const ds = new DSCore({ configPath: '.hyperide/ds.config.ts' })
ds.registerStyleAdapter(new TailwindStyleAdapter())

const report = await ds.reconcile()
console.log(`${report.summary.errors} errors, ${report.summary.warnings} warnings`)

for (const v of report.violations.filter(v => v.severity === 'error')) {
  console.log(`${v.location.filePath}:${v.location.line} — ${v.message}`)
}
```

### 7.2 CLI

```bash
# Full reconciliation
ds-core lint

# Lint specific files
ds-core lint src/components/Button.tsx

# Show token drift
ds-core drift

# Show desired vs actual state diff
ds-core diff

# Import from Figma
ds-core import figma --file-id abc123

# Manage templates
ds-core templates list
ds-core templates approve <id>
ds-core templates reject <id>

# Export tokens
ds-core export dtcg --out tokens.tokens.json
ds-core export css --out tokens.css
ds-core export tailwind --merge tailwind.config.ts
ds-core export figma --file-id abc123

# Init config
ds-core init
```

### 7.3 MCP Tools

```typescript
// Exposed as MCP tools for AI agents

/** Check design system compliance for a file or component */
hyper_ds_validate({ filePath: string, component?: string })

/** Get current design tokens */
hyper_ds_tokens({ category?: string })

/** Suggest the correct token for a value */
hyper_ds_suggest_token({ value: string, context?: string })

/** Get design system violations for recent changes */
hyper_ds_violations({ scope?: 'all' | 'uncommitted' | 'staged' })

/** Apply autofix for a violation */
hyper_ds_fix({ violationId: string })

/** Get the full desired state as JSON (for AI context) */
hyper_ds_spec()

/** Export design tokens to a format */
hyper_ds_export({ format: ExportFormat, fileId?: string })
```

### 7.4 Pre-commit Hook

```yaml
# lefthook.yml
pre-commit:
  commands:
    ds-lint:
      glob: "*.{tsx,jsx,ts,css,scss}"
      run: ds-core lint --pre-commit {staged_files}
      fail_text: "Design system violations found"
```

### 7.5 UI (HyperCanvas Integration)

Not in `packages/ds-core` — lives in `client/` as a consumer:

- **Token Library Panel** (HYP-313) — browse/edit tokens, see drift
- **Inspector integration** — show violations inline on selected element
- **Violation sidebar** — list all violations with quick-fix buttons
- **Template approval UI** — review/approve/reject pending templates

---

## 8. Figma Import

### 8.1 Import Sources

| Source | Format | What we extract |
|--------|--------|-----------------|
| Figma Variables API | REST API | Color variables, number variables (spacing), string vars |
| Tokens Studio plugin | JSON export | Full token set (color, typography, spacing, shadow, etc.) |
| Figma Styles | REST API | Color styles, text styles, effect styles |
| Figma file inspection | REST API | Component structure, layout constraints, auto-layout params |

### 8.2 Import Flow

```
Figma Source
    ↓
[Figma Importer]
    ├─ Parse tokens/variables into DesignTokenSet format
    ├─ Detect naming conventions (map "Primary/500" → role "primary.base")
    ├─ Resolve aliases ($primary → #0066CC)
    └─ Output: FigmaDesiredState (partial DesiredState)
        ↓
[Three-way diff]
    ├─ Figma desired state (Layer 2)
    ├─ Config desired state (Layer 3)
    ├─ Actual code state
    └─ Output:
        ├─ Tokens only in Figma (need code adoption)
        ├─ Tokens only in code (need Figma addition or removal)
        ├─ Tokens in both but different values (drift!)
        ├─ Tokens matching (good)
        └─ Config overrides (intentional divergence)
```

### 8.3 Figma Layout Import

Import layout constraints from Figma frames to validate that code
matches Figma's intended layout:

- Auto-layout → flex direction, gap, padding
- Constraints → position, sizing behavior
- Component sets → variant structure
- Frame hierarchy → component composition

### 8.4 Export — Design System as Output

DS Core is not just a reader/validator — it can **export** the desired state
to multiple formats. This makes it a bidirectional bridge: Figma → DS Core → Code,
but also Code → DS Core → Figma.

Comparable to what design-system.studio does, but generated from the reconciled
desired state rather than a standalone editor.

#### Export Targets

| Target | Format | Use case |
|--------|--------|----------|
| **W3C DTCG** | `.tokens.json` ([spec 2025.10](https://www.designtokens.org/tr/drafts/format/)) | Industry standard, vendor-neutral interchange |
| **Figma Variables** | Figma REST API `POST /variables` | Push tokens back to Figma (code → design sync) |
| **Tokens Studio** | Tokens Studio JSON | Import into Tokens Studio Figma plugin |
| **CSS Variables** | `:root { --color-primary: #0066CC; }` | Any web project |
| **Tailwind config** | `theme.extend.colors` / `theme.extend.spacing` in `tailwind.config.ts` | Tailwind projects |
| **Tamagui config** | `createTamagui({ tokens })` shape | Tamagui projects |
| **Style Dictionary** | Style Dictionary JSON tokens | Amazon/cross-platform token pipeline |
| **JSON** | Raw `DesiredState` as JSON | Custom tooling, AI context |

#### W3C DTCG as Native Format

The W3C Design Tokens Community Group released the first stable specification
in October 2025. Backed by Adobe, Amazon, Google, Microsoft, Meta, Figma,
Sketch, Shopify, and others.

DS Core uses DTCG as its **native interchange format**:

```json
{
  "$name": "HyperIDE Design System",
  "$description": "Auto-exported from DS Core desired state",
  "color": {
    "primary": {
      "$type": "color",
      "$value": "#0066CC",
      "$description": "Primary brand color"
    },
    "on-primary": {
      "$type": "color",
      "$value": "#FFFFFF"
    },
    "error": {
      "$type": "color",
      "$value": "#DC2626"
    }
  },
  "spacing": {
    "sm": {
      "$type": "dimension",
      "$value": "8px"
    },
    "md": {
      "$type": "dimension",
      "$value": "16px"
    }
  },
  "typography": {
    "body": {
      "$type": "typography",
      "$value": {
        "fontFamily": "Inter",
        "fontSize": "16px",
        "fontWeight": 400,
        "lineHeight": 1.5
      }
    }
  }
}
```

#### Export DI Adapter

```typescript
/**
 * Writes design tokens to external targets.
 * Each export format gets its own adapter implementation.
 */
export interface TokenExporter {
  readonly format: ExportFormat

  /** Export full desired state */
  exportAll(state: DesiredState): Promise<ExportResult>

  /** Export a subset (e.g., only colors) */
  exportCategory(state: DesiredState, category: TokenCategory): Promise<ExportResult>

  /** Dry-run — show what would be exported */
  preview(state: DesiredState): Promise<string>
}

type ExportFormat =
  | 'dtcg'              // W3C Design Tokens (.tokens.json)
  | 'figma-variables'   // Figma REST API
  | 'tokens-studio'     // Tokens Studio JSON
  | 'css-variables'     // CSS custom properties
  | 'tailwind'          // tailwind.config.ts theme section
  | 'tamagui'           // createTamagui tokens
  | 'style-dictionary'  // Style Dictionary JSON
  | 'json'              // Raw DesiredState JSON
```

#### CLI & MCP

```bash
# Export to W3C DTCG
ds-core export dtcg --out design-tokens.tokens.json

# Export to CSS variables
ds-core export css --out tokens.css

# Export to Tailwind config (merge into existing)
ds-core export tailwind --merge tailwind.config.ts

# Push to Figma
ds-core export figma --file-id abc123

# Preview what would be exported
ds-core export dtcg --dry-run
```

```typescript
// MCP tools
hyper_ds_export({ format: 'dtcg' })
hyper_ds_export({ format: 'figma-variables', fileId: 'abc123' })
hyper_ds_export({ format: 'css-variables' })
```

#### Bidirectional Sync

```
Figma ──import──→ DS Core ──export──→ Figma
                     ↕
Code  ←──extract──  DS Core ──export──→ Code configs
                     ↕
              .hyperide/ds.config.ts
```

Import and export use the same token model (`DesignTokenSet`), so
round-tripping is lossless for supported token types.

---

## 9. Existing Code to Consume (Not Move)

These modules stay where they are. DS Core uses them through DI adapters.

| Module | Location | DS Core adapter |
|--------|----------|-----------------|
| TailwindAdapter | `client/lib/canvas-engine/adapters/` | `StyleReadAdapter` |
| TamaguiAdapter | `client/lib/canvas-engine/adapters/` | `StyleReadAdapter` |
| ColorTokenProvider (TW) | `vscode-extension/.../color-token-provider.ts` | `TokenProvider` |
| ColorTokenProvider (Tamagui) | `vscode-extension/.../color-token-provider.ts` | `TokenProvider` |
| ComponentScanner | `lib/component-scanner/` | `ComponentIntrospector` |
| WCAG contrast utils | `shared/utils/color.ts` | Used directly (shared/) |
| Figma binary importer | `packages/vector-engine/src/import/` | Separate — vector, not DS |

Phase 2a (`lib/style-adapters/`) will unify StyleAdapter interfaces — DS Core
adapters will wrap those once Phase 2a lands.

---

## 10. Related Linear Tickets

| Ticket | Relation |
|--------|----------|
| HYP-123 | Parent — "think about UX/UI design with AI" |
| HYP-267 | Generate different design options by AI — uses DS spec as constraints |
| HYP-294 | Token table UI — consumer of DS Core token data |
| HYP-313 | Token Library Panel — consumer of DS Core |
| HYP-314 | Full context to AI/MCP — DS spec is part of AI context |
| HYP-316 | Hardcoded toolbar colors — exactly what `color.no-hardcoded` catches |
| HYP-320 | Gray classes → semantic tokens — exactly what `color.no-hardcoded` catches |
| HYP-288 | Load Tamagui palette from config — DS Core infers from project |
| HYP-289 | Semantic token fallback — DS Core `TokenProvider.findNearest()` |
| HYP-299 | Phase 2a: StyleAdapter unification — DS Core adapters wrap these |
| HYP-341 | Google Stitch ideas — AI generation within DS constraints |

---

## 11. Rule Catalog

Universal rule set synthesized from three major design systems and web standards:

- **Apple HIG** — 224 rules (`2026-04-01-apple-hig-design-rules.md`)
- **Material Design 3** — 180 rules (`2026-04-01-material-design-rules.md`)
- **Microsoft Fluent 2** — 108 rules (`2026-04-01-fluent2-design-rules.md`)
- **WCAG 2.1** — accessibility standards
- **`/frontend-design` skill** — design quality guidelines

Rules are framework-agnostic — presets enable/configure subsets with
framework-specific default values.

Validation strategy is determined by super-section placement:

- **`tokens.*`** — algorithmic (AST/computed styles, deterministic)
- **`patterns.*`** — algorithmic → template → AI fallback
- **`intent.*`** — AI → template shortcut

### 11.1 `tokens.color`

| ID | Rule | Description | Default | Fix |
|----|------|-------------|---------|-----|
| `color.contrast-min` | Min contrast ratio | Text ≥ 4.5:1 (AA), large text ≥ 3:1, non-text ≥ 3:1 | error | yes |
| `color.contrast-enhanced` | Enhanced contrast | Text ≥ 7:1 (AAA), large text ≥ 4.5:1 | info | yes |
| `color.no-hardcoded` | No hardcoded colors | All colors must reference design tokens, not hex/rgb literals | warning | yes |
| `color.palette-size` | Palette size limit | Max N unique colors (default 32), with dedup threshold | warning | |
| `color.semantic-roles` | Semantic roles defined | DS must define primary, secondary, error, background, surface, on-* | warning | |
| `color.on-color-pairing` | On-color pairing | Text on `primary` uses `on-primary`, etc. | error | yes |
| `color.dark-mode-variants` | Dark mode variants | All custom colors must have dark appearance variants | warning | |
| `color.dark-mode-contrast` | Dark mode contrast | Contrast ratios must pass independently in dark mode | error | yes |
| `color.surface-hierarchy` | Surface elevation order | Surface container tokens ordered by luminance | warning | |
| `color.independence` | Info not by color alone | Status/selection/errors use shape/icon/text in addition to color | error | |
| `color.grayscale-usability` | Grayscale usability | UI remains functional in grayscale | warning | |
| `color.red-green-independence` | Red-green safe | Never rely solely on red vs green distinction | error | |
| `color.tonal-palette` | Tonal palette completeness | Each key color has all tones (0-100 in M3, light/dark in HIG) | error | |
| `color.harmony` | Color harmony | Palette follows a coherent harmony model | info | |
| `color.error-reserved` | Error color reserved | Error/destructive color not used for non-error purposes | warning | |
| `color.system-materials` | System materials usage | Overlays use system materials, not custom opacity | info | |
| `color.reduce-transparency` | Reduce transparency support | Translucent falls back to opaque when accessibility setting enabled | warning | |

**Params (configurable per-rule):**

- `contrast-min`: `{ standard: 'AA'|'AAA', normalText: number, largeText: number, nonText: number }`
- `no-hardcoded`: `{ allowBlackWhite: boolean, ignoreFiles: string[], allowValues: string[] }`
- `palette-size`: `{ maxUniqueColors: number, dedupeThreshold: number }`
- `semantic-roles`: `{ requiredRoles: string[] }`
- `harmony`: `{ model: 'complementary'|'analogous'|'triadic'|'split-complementary'|'monochromatic'|'custom' }`

### 11.2 `tokens.typography`

| ID | Rule | Description | Default | Fix |
|----|------|-------------|---------|-----|
| `type.scale-usage` | Type scale token usage | All text uses defined type scale tokens, not arbitrary sizes | warning | yes |
| `type.min-size` | Minimum readable size | No text smaller than minimum (11sp M3, 11pt HIG) | error | yes |
| `type.no-fixed-sizes` | No fixed font sizes | Font sizes derived from scale/tokens, not hardcoded points | warning | yes |
| `type.line-height-ratio` | Line height consistency | Line heights follow scale ratios (tight/normal/loose) | warning | yes |
| `type.weight-consistency` | Weight consistency | Font weights match type scale definition | warning | yes |
| `type.hierarchy-present` | Type hierarchy | Page has ≥ 2-3 distinct type scale levels | warning | |
| `type.display-for-hero` | Display for hero only | Display styles not used for body content | warning | |
| `type.body-for-content` | Body for long-form | Paragraphs use body tokens, not title/display | warning | |
| `type.label-for-ui` | Label for UI controls | Buttons/tabs/chips use label tokens | warning | |
| `type.dynamic-scaling` | Dynamic type support | Text scales with user preference (200% min) | error | |
| `type.bold-text-support` | Bold text setting | App responds to system bold text setting | warning | |
| `type.no-overlap` | No overlapping text | At all sizes, text must not overlap other elements | error | |
| `type.truncation-avoidance` | Text truncation | Prefer wrapping over truncating; truncated text accessible elsewhere | warning | |
| `type.sentence-case` | Sentence case for UI | UI text uses sentence case (M3) or title case (HIG) per preset | warning | yes |
| `type.font-family-roles` | Font family roles | Display/brand vs body/plain font distinction | info | |

**Params:**

- `scale-usage`: `{ scale: TypeScaleEntry[], tolerance: number }`
- `min-size`: `{ minPx: number }`
- `sentence-case`: `{ style: 'sentence'|'title', exceptions: string[] }`
- `dynamic-scaling`: `{ minScaleFactor: number }`

### 11.3 `tokens.spacing`

| ID | Rule | Description | Default | Fix |
|----|------|-------------|---------|-----|
| `space.grid-alignment` | Grid alignment | All spacing values are multiples of base unit (4dp/8pt) | warning | yes |
| `space.scale-usage` | Spacing scale usage | Spacing uses defined scale tokens, not arbitrary values | warning | yes |
| `space.consistent-gaps` | Consistent gaps | Same-level gaps use same token (sibling elements) | warning | yes |
| `space.content-margins` | Content margins | Content respects min margins per breakpoint | warning | |
| `space.section-spacing` | Section spacing | Consistent spacing between major sections | info | |
| `space.card-padding` | Container padding | Cards/containers use consistent internal padding | info | yes |
| `space.responsive-margins` | Responsive margins | Margins adapt to window size class | warning | |
| `space.max-content-width` | Max content width | Body content has max-width at large breakpoints | warning | |

**Params:**

- `grid-alignment`: `{ baseUnit: number, allowHalf: boolean }`
- `scale-usage`: `{ scale: Record<string, string>, tolerance: number }`
- `content-margins`: `{ compact: number, medium: number, expanded: number }`

### 11.4 `patterns.accessibility`

| ID | Rule | Description | Default | Fix |
|----|------|-------------|---------|-----|
| `a11y.tap-target-min` | Min tap target | Interactive elements ≥ 44x44pt (HIG) / 48x48dp (M3) | error | |
| `a11y.tap-target-spacing` | Tap target spacing | Adjacent targets ≥ 8dp apart | warning | |
| `a11y.labels-present` | All controls labeled | Every interactive element has accessibility label | error | yes |
| `a11y.labels-no-type` | Labels exclude type | Labels don't include "button", "checkbox" etc. | warning | yes |
| `a11y.labels-context-free` | Labels context-free | No "Click here", "Learn more", generic labels | warning | |
| `a11y.images-described` | Images described | Non-decorative images have alt text | error | |
| `a11y.decorative-hidden` | Decorative hidden | Decorative images marked aria-hidden | warning | yes |
| `a11y.focus-visible` | Focus indicator | All focusable elements have visible :focus-visible | error | |
| `a11y.focus-contrast` | Focus indicator contrast | Focus ring ≥ 3:1 against adjacent colors | error | |
| `a11y.focus-order` | Logical focus order | Tab order follows visual reading order | error | |
| `a11y.focus-trap-modal` | Modal focus trap | Tab cycles within dialog/modal | error | |
| `a11y.keyboard-accessible` | Keyboard accessible | All interactions reachable via keyboard | error | |
| `a11y.escape-dismisses` | Escape closes overlays | Dialogs, menus, sheets close on Escape | error | |
| `a11y.reduce-motion` | Reduce motion support | Respects prefers-reduced-motion | error | |
| `a11y.reduce-motion-replace` | Replace, don't remove | Motion replaced with dissolve/fade, not just removed | warning | |
| `a11y.dark-mode-support` | Dark mode support | App supports system dark mode | warning | |
| `a11y.text-resize-200` | Text resize to 200% | Content usable at 200% text scaling | error | |
| `a11y.no-horizontal-scroll` | No horizontal scroll | At any breakpoint | error | |
| `a11y.chart-alternatives` | Chart text alternatives | Charts include accessible data or text summary | warning | |
| `a11y.gesture-alternatives` | Gesture alternatives | Complex gestures have non-gesture alternatives | warning | |

**Params:**

- `tap-target-min`: `{ minSize: number, platform: 'ios'|'android'|'web' }`
- `text-resize-200`: `{ minScaleFactor: number }`

### 11.5 `patterns.motion`

| ID | Rule | Description | Default | Fix |
|----|------|-------------|---------|-----|
| `motion.duration-range` | Duration bounds | UI animations between 50ms-1000ms | warning | yes |
| `motion.duration-tokens` | Duration token usage | Durations use defined tokens, not arbitrary values | warning | yes |
| `motion.easing-tokens` | Easing token usage | Easing uses defined tokens (standard, emphasized, etc.) | warning | yes |
| `motion.no-linear` | No linear easing for UI | Linear reserved for continuous progress only | warning | yes |
| `motion.enter-decelerate` | Decelerate on enter | Elements entering use ease-out / decelerate | info | |
| `motion.exit-accelerate` | Accelerate on exit | Elements leaving use ease-in / accelerate | info | |
| `motion.spring-default` | Spring as default | Prefer spring over ease for interactive animations | info | |
| `motion.velocity-preserve` | Velocity continuity | Interrupted animations preserve velocity | warning | |
| `motion.gpu-friendly` | GPU-friendly properties | Animate transform/opacity, not width/height/margin | warning | yes |
| `motion.no-layout-thrash` | No layout thrashing | Don't trigger layout recalc in animation loop | warning | |
| `motion.purpose-driven` | Purpose-driven | Every animation serves feedback/state/orientation/delight | info | |
| `motion.no-load-animation` | No flashy load anim | Content appears promptly on initial load | info | |
| `motion.distance-scaling` | Duration scales with distance | Larger traversal = longer duration | info | |
| `motion.auto-advance-control` | Auto-advance control | Carousels have stop/pause control | warning | |

**Params:**

- `duration-range`: `{ min: number, max: number, unit: 'ms' }`
- `duration-tokens`: `{ tokens: Record<string, number> }`
- `easing-tokens`: `{ tokens: Record<string, string> }`

### 11.6 `tokens.elevation`

| ID | Rule | Description | Default | Fix |
|----|------|-------------|---------|-----|
| `elevation.level-tokens` | Elevation level usage | Shadows use defined levels (0-5), not arbitrary values | warning | yes |
| `elevation.dark-tonal` | Tonal elevation in dark mode | Dark mode uses lighter surface tones, not shadows | warning | |
| `elevation.consistent-direction` | Consistent shadow direction | All shadows share same light source direction | info | |
| `elevation.interaction-increase` | Elevation on interaction | Elevation increases on hover/press (card 1→2) | info | |
| `elevation.disabled-flat` | Disabled = no elevation | Disabled components drop to level 0 | warning | yes |
| `elevation.system-values` | System shadow values | Use system-provided shadows, not custom | info | yes |
| `elevation.reduced-dark` | Reduced shadows dark | Dark mode reduces or eliminates drop shadows | warning | |

**Params:**

- `level-tokens`: `{ levels: Record<number, { offsetY: number, blur: number, spread: number }> }`

### 11.7 `tokens.shape`

| ID | Rule | Description | Default | Fix |
|----|------|-------------|---------|-----|
| `shape.token-usage` | Shape token usage | Border-radius uses defined tokens (4, 8, 12, 16, 28dp) | warning | yes |
| `shape.no-arbitrary-radius` | No arbitrary radius | Border-radius must be from scale | warning | yes |
| `shape.component-consistency` | Consistent per component | Same component type uses same shape | error | |
| `shape.button-pill` | Buttons use pill shape | Buttons use shape-full (M3) | info | yes |
| `shape.card-medium` | Cards use medium shape | Cards use medium radius | info | yes |
| `shape.dialog-large` | Dialogs use large shape | Dialogs use extra-large radius | info | yes |

**Params:**

- `token-usage`: `{ tokens: Record<string, number> }`

### 11.8 `patterns.state`

| ID | Rule | Description | Default | Fix |
|----|------|-------------|---------|-----|
| `state.hover-feedback` | Hover feedback | All interactive elements show hover state | error | |
| `state.focus-feedback` | Focus feedback | All focusable elements show focus state | error | |
| `state.press-feedback` | Press feedback | All tappable elements show pressed state | warning | |
| `state.layer-opacity` | State layer opacity | Hover 8%, focus 10%, pressed 10%, dragged 16% (M3) | info | yes |
| `state.disabled-opacity` | Disabled opacity | Content 38%, container 12% of on-surface (M3) | warning | yes |
| `state.disabled-no-interaction` | Disabled no interaction | Disabled elements have no hover/focus/pressed states | warning | |
| `state.not-additive` | States not additive | Only one state layer active at a time | info | |

### 11.9 `patterns.navigation`

| ID | Rule | Description | Default | Fix |
|----|------|-------------|---------|-----|
| `nav.tab-count` | Tab/nav count | 3-5 items in tab bar / bottom nav | warning | |
| `nav.tab-top-level` | Tabs for top-level only | Tab bar for top-level sections, not actions | warning | |
| `nav.tab-always-visible` | Tab bar persistent | Tab bar visible during push navigation | warning | |
| `nav.back-button` | Back button present | Every pushed view has back navigation | error | |
| `nav.depth-limit` | Navigation depth | Hierarchy ≤ 3-4 levels deep | warning | |
| `nav.modal-explicit-dismiss` | Modal explicit dismiss | Modals require Done/Cancel/Save or swipe-down | warning | |
| `nav.no-nested-modals` | No nested modals | No modal on top of modal | warning | |
| `nav.discard-confirmation` | Unsaved changes guard | Modal with edits confirms before dismissal | warning | |
| `nav.responsive-pattern` | Responsive nav pattern | Bottom nav → rail → drawer at breakpoints | warning | |
| `nav.breadcrumbs-deep` | Breadcrumbs at depth | Breadcrumbs when depth > 2 | info | |

### 11.10 `intent.tone`

All rules in this section are AI-validated by default, with template learning.

| ID | Rule | Description | Default | Fix |
|----|------|-------------|---------|-----|
| `tone.writing-style` | Writing style | UI copy matches defined style (friendly/professional/casual/formal) | info | |
| `tone.concise-labels` | Concise labels | Interface labels brief and direct | warning | |
| `tone.no-jargon` | No jargon | No technical jargon in user-facing text | warning | |
| `tone.no-blame` | No blame language | Error messages never blame the user | warning | yes |
| `tone.positive-framing` | Positive framing | Describe what user CAN do, not what they can't | info | |
| `tone.actionable-errors` | Actionable errors | Error messages say what went wrong + what to do | warning | |
| `tone.specific-actions` | Specific action labels | "Delete Photo" not "OK", "Save Changes" not "Yes" | warning | yes |
| `tone.consistent-voice` | Consistent voice | Same voice across all text in the app | info | |
| `tone.max-sentence-length` | Sentence length limit | UI sentences ≤ N words (configurable) | info | |
| `tone.gender-neutral` | Gender-neutral | they/their for unknown gender | info | yes |
| `tone.cancel-present` | Cancel always present | Destructive actions always include Cancel option | warning | |

**Params:**

- `writing-style`: `{ style: string, maxSentenceLength: number, examples: string[] }`

### 11.11 `patterns.components`

Component-specific rules are organized by component type. These validate
structure, sizing, and composition — not styling (that's color/typography/shape).

| ID | Rule | Description | Default | Fix |
|----|------|-------------|---------|-----|
| `comp.button-min-size` | Button min size | Buttons ≥ 44pt (HIG) / 40dp (M3) height | error | |
| `comp.button-padding` | Button padding | Min horizontal padding (16-24dp) | warning | yes |
| `comp.button-label-verb` | Button labels are verbs | Save, Delete, Share — not nouns | warning | |
| `comp.alert-max-buttons` | Alert max buttons | ≤ 3 buttons in alerts | warning | |
| `comp.alert-destructive-style` | Destructive button style | Destructive action uses error/red styling | warning | yes |
| `comp.alert-destructive-not-default` | Destructive not default | Default/bold button is never destructive | error | |
| `comp.input-label-present` | Input has label | Text fields have persistent visible label | error | |
| `comp.input-label-not-placeholder` | Label not placeholder | Placeholder doesn't replace label | warning | |
| `comp.input-keyboard-type` | Input keyboard type | Text fields specify correct keyboard type | warning | |
| `comp.list-row-min-height` | List row min height | Table/list rows ≥ 44pt / 48dp | warning | |
| `comp.list-consistent-height` | List consistent height | Rows within section maintain consistent height | warning | |
| `comp.list-disclosure` | Disclosure indicator | Drill-down rows show chevron | warning | |
| `comp.dialog-min-width` | Dialog min width | ≥ 280dp | error | |
| `comp.dialog-max-width` | Dialog max width | ≤ 560dp | warning | |
| `comp.dialog-scrim` | Dialog scrim | Backdrop overlay required behind dialog | warning | |
| `comp.toggle-binary` | Toggle for binary | Toggles for on/off only, not actions | warning | |
| `comp.progress-type` | Progress indicator type | Determinate for known duration, indeterminate for unknown | warning | |
| `comp.search-cancel` | Search cancel button | Active search shows Cancel | warning | |
| `comp.snackbar-auto-dismiss` | Snackbar auto-dismiss | 4-10 seconds, max 1 action | warning | |
| `comp.icon-size` | Standard icon size | 24dp default, matching text weight | warning | |
| `comp.icon-decorative-hidden` | Decorative icons hidden | aria-hidden on non-informative icons | warning | yes |

### 11.12 `tokens.iconography`

| ID | Rule | Description | Default | Fix |
|----|------|-------------|---------|-----|
| `icon.standard-size` | Standard icon sizes | 20, 24, 40, or 48dp — not arbitrary | warning | yes |
| `icon.weight-matches-text` | Weight matches text | Icon weight matches adjacent text weight | warning | yes |
| `icon.color-matches-content` | Color matches content | Icon uses same color token as adjacent text | warning | yes |
| `icon.rendering-consistency` | Rendering mode consistent | Within a view, icons use same rendering mode | info | |
| `icon.no-text-in-icons` | No text in icons | Icons avoid embedded text | info | |
| `icon.app-icon-size` | App icon size | 1024x1024px PNG provided | error | |
| `icon.app-icon-opaque` | App icon opaque | No transparency in app icon (iOS) | error | |

### 11.13 `intent.quality`

These rules validate distinctive design quality, combating "AI slop" aesthetics.
All AI-validated.

| ID | Rule | Description | Default | Fix |
|----|------|-------------|---------|-----|
| `quality.no-generic-fonts` | No generic fonts | No Inter, Roboto, Arial as primary — use distinctive choices | info | |
| `quality.no-purple-gradient` | No cliche color schemes | Avoid overused purple gradient on white | info | |
| `quality.intentional-composition` | Intentional spatial composition | Layouts show intentionality — asymmetry, grid-breaking, negative space | info | |
| `quality.atmosphere-backgrounds` | Atmospheric backgrounds | Backgrounds create depth — gradients, textures, patterns, not just solids | info | |
| `quality.distinctive-typography` | Distinctive typography | Display font is characterful, not generic | info | |
| `quality.motion-high-impact` | High-impact motion | One well-orchestrated animation > many micro-interactions | info | |
| `quality.cohesive-aesthetic` | Cohesive aesthetic | All elements follow a clear aesthetic direction | info | |
| `quality.dark-light-variation` | Theme variation | Light and dark themes both thoughtfully designed | info | |

### Rule Count Summary

| Section | Rules | Super-section |
|---------|-------|---------------|
| Color | 17 | tokens |
| Typography | 15 | tokens |
| Spacing | 8 | tokens |
| Accessibility | 20 | patterns |
| Motion | 14 | patterns |
| Elevation | 7 | tokens |
| Shape | 6 | tokens |
| State | 7 | patterns |
| Navigation | 10 | patterns |
| Tone of Voice | 11 | intent |
| Components | 21 | patterns |
| Iconography | 7 | tokens |
| Design Quality | 8 | intent |
| **Total** | **151** | |

### Presets

Presets configure which rules are enabled and with what default values.

| Preset | Description | Rules enabled | Key overrides |
|--------|-------------|---------------|---------------|
| `minimal` | Sensible defaults for any web project | ~80 core rules | AA contrast, 4px grid, basic a11y |
| `strict` | All rules, high severity | All 151 | Errors for most warnings |
| `web-accessibility` | WCAG 2.1 AA/AAA focus | a11y + color contrast + keyboard | AAA contrast, full a11y suite |
| `apple-hig` | Apple HIG (224 rules, see `2026-04-01-apple-hig-design-rules.md`) | All + HIG-specific params | 44pt targets, SF system, title case |
| `material-design` | Material Design 3 (180 rules, see `2026-04-01-material-design-rules.md`) | All + M3-specific params | 48dp targets, M3 tokens, sentence case |
| `fluent` | Microsoft Fluent 2 (108 rules, see `2026-04-01-fluent2-design-rules.md`) | All + Fluent-specific params | Fluent tokens, spacing, type ramp |
| `editorial` | Content-heavy sites | tone + type + quality | Strict writing rules, type hierarchy |
| `app-store` | Pre-submission check | a11y + HIG + icon | All HIG error-level rules |

---

## 12. AI Linter System

DS Core's AI linter is not a single monolith — it's a pipeline of specialized
validators orchestrated by the reconciler. Each `intent.*` and some `patterns.*`
rules delegate to AI when algorithmic checks are inconclusive.

### 12.1 AI Validator Architecture

```
Rule needs AI validation
    ↓
┌──────────────────┐
│ AI Validator      │
│ Orchestrator      │
└──────┬───────────┘
       │
       ├─ 1. Build context (code snippet, surrounding AST, computed styles)
       ├─ 2. Select prompt template for rule's section
       ├─ 3. Inject: rule definition + params + desired state excerpt + context
       ├─ 4. Call AIProvider.validate()
       ├─ 5. Parse structured response (Zod-validated)
       ├─ 6. If violation: attempt autofix suggestion
       ├─ 7. If generalizable: generate candidate template
       └─ 8. Return AIValidationResult
```

### 12.2 Context Building

The AI validator receives a focused context window, not the whole codebase:

```typescript
interface AIValidationContext {
  /** The code being validated */
  code: {
    snippet: string                         // 20-50 lines around the target
    filePath: string
    language: 'tsx' | 'jsx' | 'css' | 'html'
  }

  /** AST context (if ASTProvider registered) */
  ast?: {
    componentName: string                   // Enclosing component
    parentChain: string[]                   // ['App', 'Layout', 'Sidebar', 'NavItem']
    siblingCount: number
    props: Record<string, string>           // Relevant props
  }

  /** Computed styles (if StyleReadAdapter registered) */
  styles?: {
    computed: Record<string, string>        // CSS property → resolved value
    tokens: string[]                        // Token references found
    framework: string                       // 'tailwind-v3', 'emotion', etc.
  }

  /** Design system context (from desired state) */
  designSystem: {
    relevantTokens: DesignToken[]           // Tokens relevant to this rule
    ruleDescription: string                 // Full rule description
    ruleParams: Record<string, unknown>     // User-configured params
    preset: string                          // Active preset name
  }

  /** DOM context (if available — e.g. from HyperCanvas preview) */
  dom?: {
    screenshot?: string                     // Base64 JPEG of element region
    computedStyles: Record<string, string>
    boundingBox: { x: number; y: number; width: number; height: number }
    textContent?: string                    // For tone-of-voice rules
    ariaAttributes?: Record<string, string> // For a11y rules
  }
}
```

### 12.3 Prompt Templates

Each rule section has a specialized system prompt. Prompts are stored as
TypeScript template functions, not raw strings — they receive the context
and produce a structured prompt.

```typescript
// packages/ds-core/src/validators/ai/prompts/tone-prompt.ts

export function buildTonePrompt(
  rule: ResolvedRule,
  context: AIValidationContext,
): AIPrompt {
  return {
    system: `You are a UI copy linter. You validate text against design system
writing guidelines. You respond with structured JSON only.

Design system style: ${rule.params.style}
Max sentence length: ${rule.params.maxSentenceLength ?? 'not set'} words

Rules:
- ${rule.definition.description}
- Consider the component context: ${context.ast?.componentName ?? 'unknown'}
- Consider the UI element type: button/label/heading/body/error/placeholder

Respond with:
{
  "decision": "pass" | "violation",
  "confidence": 0.0-1.0,
  "reasoning": "why this passes or fails",
  "violations": [{ "text": "...", "issue": "...", "suggestion": "..." }],
  "generalizable": true/false
}`,

    user: `Validate this UI text against the "${rule.id}" rule:

File: ${context.code.filePath}
Component: ${context.ast?.componentName ?? 'unknown'}

Text content found:
${context.dom?.textContent ?? extractTextFromCode(context.code.snippet)}

Code context:
\`\`\`${context.code.language}
${context.code.snippet}
\`\`\``,
  }
}
```

Section-specific prompt builders:

| Section | Prompt focus | Key context inputs |
|---------|-------------|-------------------|
| `intent.tone` | UI copy quality, writing style, jargon detection | `textContent`, component type, style param |
| `intent.quality` | Design distinctiveness, aesthetic cohesion | `screenshot`, computed styles, font families |
| `patterns.accessibility` (AI rules) | Complex a11y: color independence, gesture alternatives | `screenshot`, aria attributes, interaction patterns |
| `patterns.navigation` (AI rules) | Navigation depth, pattern appropriateness | Component tree, route structure |
| `patterns.motion` (AI rules) | Animation purpose, reduce-motion compliance | Animation declarations, media queries |
| `tokens.color` (AI rules) | Color harmony, dark mode quality | Full palette, computed bg/fg pairs |

### 12.4 AI Response Schema

```typescript
const AIValidationResultSchema = z.object({
  decision: z.enum(['pass', 'violation', 'inconclusive']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),

  violations: z.array(z.object({
    message: z.string(),
    location: z.object({
      line: z.number().optional(),
      column: z.number().optional(),
      text: z.string().optional(),
    }).optional(),
    suggestion: z.string().optional(),
  })).default([]),

  /** Can this decision be generalized into a template? */
  generalizable: z.boolean().default(false),

  /** If generalizable, what pattern does it match? */
  pattern: z.object({
    matchDescription: z.string(),
    matchCondition: z.string().optional(),       // Template DSL expression
  }).optional(),
})
```

### 12.5 Rate Limiting and Cost Control

```typescript
interface AILimits {
  /** Max AI calls per full reconciliation */
  maxCallsPerRun: number                        // default: 50

  /** Max AI calls per pre-commit (subset of files) */
  maxCallsPerPreCommit: number                  // default: 10

  /** Daily budget cap (across all runs) */
  dailyBudget: number                           // default: 200

  /** Skip AI if template coverage > threshold */
  templateCoverageThreshold: number             // default: 0.8 (80%)

  /** Model for validation (fast, cheap) */
  validationModel: string                       // default: haiku

  /** Model for template generation (smart, thorough) */
  templateModel: string                         // default: sonnet
}
```

When the budget is exhausted, AI-only rules are skipped with a warning
in the report. Algorithmic and template validations are unaffected.

---

## 13. Template DSL

The decision template DSL is a safe, sandboxed expression language for
matching code patterns and applying decisions. Adapted from the
hypercalendarbot intent system but specialized for code analysis.

### 13.1 Match Expressions

Templates match against a `MatchContext` — a structured snapshot of the
code element being validated.

```typescript
interface MatchContext {
  // Code location
  file: { path: string; language: string }

  // AST context
  node: { type: string; name: string; parent: string }
  component: { name: string; props: Record<string, string> }

  // Style context
  style: {
    property: string                        // CSS property being checked
    value: string                           // Current value
    resolvedValue: string                   // Computed value
    isToken: boolean                        // References a design token?
    tokenRef: string | null                 // Token name if isToken
    framework: string                       // 'tailwind-v3', etc.
  }

  // Content context (for tone rules)
  text: { content: string; elementType: string }

  // Numeric helpers (pre-computed)
  computed: {
    contrastRatio: number | null
    fontSize: number | null
    spacing: number | null
    tapTargetSize: number | null
  }
}
```

### 13.2 Expression Language

Safe subset — no eval, no arbitrary JS. Parsed and evaluated deterministically.

**Literals and comparisons:**

```
style.property == 'background-color'
style.value == '#4597F7'
computed.contrastRatio < 4.5
computed.fontSize >= 11
computed.spacing % 4 != 0
```

**String operations:**

```
style.value.startsWith('#')
style.value.endsWith('px')
style.value.includes('rgb')
style.value.match(/^#[0-9a-f]{6}$/i)
file.path.includes('/components/')
text.content.length > 100
```

**Boolean logic:**

```
style.property == 'color' && !style.isToken
computed.contrastRatio < 4.5 || computed.contrastRatio == null
(node.type == 'button' || node.type == 'a') && computed.tapTargetSize < 44
```

**Built-in functions:**

| Function | Returns | Description |
|----------|---------|-------------|
| `isToken(value)` | boolean | Value references a known design token |
| `nearestToken(value)` | string | Find nearest token name for a value |
| `tokenDistance(value, token)` | number | Color/numeric distance |
| `contrastRatio(fg, bg)` | number | WCAG contrast ratio |
| `isInsideComponent(name)` | boolean | AST ancestor check |
| `hasParent(selector)` | boolean | Parent element matches |
| `fileMatches(glob)` | boolean | File path glob match |
| `hasClass(name)` | boolean | Element has CSS class |
| `hasProp(name)` | boolean | JSX element has prop |
| `hasAriaLabel()` | boolean | Element has accessible name |
| `isInteractive()` | boolean | Element is interactive (button, a, input, etc.) |
| `textWordCount()` | number | Word count of text content |
| `gridAligned(value, base)` | boolean | Value is multiple of base |

### 13.3 Fix Recipes

Templates can include deterministic fix recipes:

```typescript
const FixRecipeSchema = z.object({
  type: z.enum([
    'replace-value',       // Replace a CSS/token value
    'add-class',           // Add a CSS class
    'remove-class',        // Remove a CSS class
    'replace-class',       // Swap one class for another
    'add-prop',            // Add a JSX prop
    'remove-prop',         // Remove a JSX prop
    'replace-prop-value',  // Change a prop's value
    'add-attribute',       // Add an HTML attribute (aria-*, role, etc.)
    'wrap-element',        // Wrap in a component/element
    'insert-sibling',      // Insert element before/after
  ]),

  /** What to target */
  target: z.string(),

  /** New value — supports template variables */
  value: z.string().optional(),

  /** Human-readable description */
  description: z.string(),
})
```

**Template variables in fix values:**

```
{{nearestToken}}           — nearest design token for current value
{{desiredValue}}           — value from desired state
{{contrastFix}}            — auto-computed color that meets contrast
{{semantic('background')}} — semantic token for role 'background'
{{currentValue}}           — current value (for partial transforms)
```

### 13.4 Template Example

A learned template for `tokens.color.no-hardcoded`:

```json
{
  "id": "a1b2c3d4-...",
  "ruleId": "no-hardcoded",
  "name": "Hardcoded hex in Tailwind className → nearest token",
  "match": {
    "when": "style.framework == 'tailwind-v3' && style.value.match(/^#[0-9a-f]{6}$/i) && !style.isToken"
  },
  "decision": "violation",
  "confidence": 0.95,
  "reasoning": "Hardcoded hex color in Tailwind project should use a color token. Tailwind provides a complete palette, so arbitrary hex values indicate a token is missing or not being used.",
  "violation": {
    "message": "Hardcoded color {{style.value}} — use token {{nearestToken(style.value)}} instead"
  },
  "fix": {
    "type": "replace-class",
    "target": "{{currentClass}}",
    "value": "{{nearestToken(style.value)}}",
    "description": "Replace hardcoded hex with nearest Tailwind color token"
  },
  "status": "approved",
  "createdAt": "2026-04-01T12:00:00Z",
  "approvedBy": "alex",
  "applyCount": 47
}
```

A learned template for `intent.tone.no-jargon`:

```json
{
  "id": "e5f6g7h8-...",
  "ruleId": "no-jargon",
  "name": "Technical error message with HTTP status code",
  "match": {
    "when": "text.elementType == 'error' && text.content.match(/\\b[45]\\d{2}\\b/)"
  },
  "decision": "violation",
  "confidence": 0.88,
  "reasoning": "Error messages shown to users should not contain HTTP status codes. Users don't know what 403 or 500 means.",
  "violation": {
    "message": "Error message contains HTTP status code — use human-readable description instead"
  },
  "status": "approved",
  "createdAt": "2026-04-02T09:30:00Z",
  "approvedBy": "alex",
  "applyCount": 12
}
```

### 13.5 Template Generation Flow

When AI validates a rule and produces a confident decision:

```
AI Validation Result
    ↓
confidence > 0.8 AND generalizable == true?
    ├─ No → skip template generation
    └─ Yes ↓
        ┌────────────────────────────┐
        │ Call AIProvider with        │
        │ template generation prompt: │
        │                             │
        │ "Given this validation      │
        │  result, generate a         │
        │  reusable template that     │
        │  matches similar patterns.  │
        │  Use the match DSL."        │
        └────────────┬───────────────┘
                     ↓
        Parse response → CandidateTemplate
                     ↓
        Validate match expression (syntax check)
                     ↓
        Validate fix recipe (if present)
                     ↓
        Test against N recent similar violations (backtest)
            ├─ Accuracy < 80% → discard, too specific/wrong
            └─ Accuracy ≥ 80% ↓
                Save as status='pending'
                     ↓
                Notify admin for review
```

### 13.6 Template Backtest

Before presenting a template for admin approval, the system backtests it
against historical violations:

```typescript
async function backtestTemplate(
  candidate: CandidateTemplate,
  history: Violation[],
): Promise<BacktestResult> {
  const relevant = history.filter(v => v.ruleId === candidate.ruleId)
  const recent = relevant.slice(-20)                // Last 20 violations

  let matches = 0
  let correctDecisions = 0

  for (const violation of recent) {
    const context = rebuildMatchContext(violation)
    const matched = evaluateExpression(candidate.match.when, context)
    if (matched) {
      matches++
      if (candidate.decision === 'violation') correctDecisions++
    }
  }

  return {
    totalTested: recent.length,
    matched: matches,
    accuracy: matches > 0 ? correctDecisions / matches : 0,
    coverage: recent.length > 0 ? matches / recent.length : 0,
  }
}
```

---

## 14. HyperCanvas UI Integration

DS Core lives in `packages/ds-core`. HyperCanvas consumes it through
adapter wiring in `client/` and `vscode-extension/`.

### 14.1 Token Library Panel (HYP-313)

Existing ticket — extends to become the DS Core UI surface:

- **Token browser tab**: Lists all tokens from desired state, grouped by category
- **Drift indicators**: Token values that differ between desired and actual are
  highlighted with a diff view
- **Figma sync status**: Shows which tokens came from Figma, which from config,
  which were inferred
- **Alias editor**: Create/edit token aliases stored in `.hyperide/ds.config.ts`

### 14.2 Inspector Integration

When an element is selected in the canvas:

- **Violation badges**: Small error/warning icons next to style properties that
  have violations
- **Quick fix**: Click violation → see suggestion → apply autofix with one click
- **Token suggestion**: When typing a hardcoded value, autocomplete suggests
  nearest tokens from desired state

### 14.3 Violations Panel

Sidebar panel (like Comments panel) showing:

- **Violation list**: Grouped by file, sortable by severity/section/file
- **Inline preview**: Code snippet with violation highlighted
- **Batch fix**: Select multiple violations → apply all autofixes
- **Filter by section**: tokens / patterns / intent tabs
- **Template status**: Shows when a violation was caught by template vs AI

### 14.4 Template Approval UI

Admin-facing panel for reviewing pending templates:

- **Template queue**: List of pending templates with AI confidence score
- **Preview**: Shows the match expression, fix recipe, and backtest results
- **Edit**: Modify match expression or fix recipe before approving
- **Approve/Reject**: Changes template status, updates matcher
- **Analytics**: Per-template apply count, false positive rate

---

## 15. Biome Integration

DS Core is a standalone TypeScript engine that uses Biome WASM for
high-performance parsing and GritQL pattern matching. Not a biome plugin
(plugin API too limited), not a fork (96 Rust crates, wrong language).

### 15.1 Architecture

```
┌─────────────────────────────────────────────────┐
│                   DS Core (TypeScript)            │
│                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Reconciler│ │ Template │ │ AI Validator      │ │
│  │          │ │ Matcher  │ │ (LLM calls)       │ │
│  └────┬─────┘ └────┬─────┘ └────────┬─────────┘ │
│       │            │                │             │
│  ┌────┴────────────┴────────────────┴──────────┐ │
│  │          Validation Orchestrator             │ │
│  └──────────────────┬──────────────────────────┘ │
│                     │                             │
│       ┌─────────────┼─────────────┐              │
│       ↓             ↓             ↓              │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐        │
│  │ GritQL  │  │ TS-based │  │ AI-based │        │
│  │ rules   │  │ rules    │  │ rules    │        │
│  │ (fast)  │  │ (complex)│  │ (smart)  │        │
│  └────┬────┘  └────┬─────┘  └──────────┘        │
│       │            │                              │
│  ┌────┴────────────┴─────────────────────┐       │
│  │    @biomejs/js-api (WASM)             │       │
│  │    - CSS/JS/TS parsing → CST          │       │
│  │    - searchPattern() for GritQL       │       │
│  │    - lintContent() for standard rules │       │
│  └───────────────────────────────────────┘       │
└─────────────────────────────────────────────────┘
```

### 15.2 Three Rule Execution Tiers

**Tier 1 — GritQL (Biome WASM, Rust-speed)**

Simple token-level pattern matching. No TypeScript overhead.

```grit
language css

// tokens.color.no-hardcoded — detect hardcoded hex in CSS values
`$prop: $val;` where {
    $val <: r"#[0-9a-fA-F]{3,8}",
    not $prop <: r"^--",
    register_diagnostic(
      span=$val,
      message="Hardcoded color — use a design token",
      severity="warning"
    )
}
```

```grit
language js

// tokens.spacing.grid-alignment — detect non-grid-aligned px values
`$prop: '$val'` where {
    $val <: r"(\d+)px",
    not $val <: r"^(0|4|8|12|16|20|24|32|40|48|64)px$",
    register_diagnostic(
      span=$val,
      message="Spacing value not on 4px grid",
      severity="warning"
    )
}
```

Ideal for: `tokens.color.no-hardcoded`, `tokens.spacing.grid-alignment`,
`tokens.shape.no-arbitrary-radius`, `tokens.elevation.level-tokens`.

**Tier 2 — TypeScript (DS Core engine)**

Complex rules needing cross-file state, token resolution, or computed values.

```typescript
// tokens.color.contrast-min — needs computed bg/fg + WCAG math
class ContrastValidator implements AlgorithmicValidator {
  check(target: ValidationTarget, params: ContrastParams): RuleResult {
    const fg = target.styles.computed.color
    const bg = target.styles.computed.backgroundColor
    const ratio = contrastRatio(fg, bg)
    if (ratio < params.normalText) {
      return violation(`Contrast ratio ${ratio.toFixed(1)}:1 < ${params.normalText}:1`)
    }
    return pass()
  }
}
```

Ideal for: contrast calculations, palette analysis, type scale consistency,
cross-file token drift, component pattern matching.

**Tier 3 — AI (via AIProvider)**

Semantic understanding, subjective judgment, visual analysis.

Ideal for: `intent.tone.*`, `intent.quality.*`, complex `patterns.accessibility.*`.

### 15.3 GritQL Pattern Generation

DS Core can **generate** GritQL patterns from its rule definitions and
desired state tokens. This means token-level rules don't need hand-written
GritQL — the engine produces it from config:

```typescript
function generateTokenGritPatterns(desiredState: DesiredState): GritPattern[] {
  const patterns: GritPattern[] = []

  // Generate "no-hardcoded" pattern from allowed tokens
  const allowedHexes = desiredState.tokens.colors
    .flatMap(g => Object.values(g.roles))
    .map(t => t.toLowerCase())
  const hexRegex = allowedHexes.join('|')

  patterns.push({
    ruleId: 'tokens.color.no-hardcoded',
    language: 'css',
    pattern: `\`$prop: $val;\` where {
      $val <: r"#[0-9a-fA-F]{3,8}",
      not $val <: r"^(${hexRegex})$",
      register_diagnostic(span=$val, message="Unknown color — not in design tokens")
    }`,
  })

  return patterns
}
```

### 15.4 Biome Co-runner Mode

DS Core can optionally run biome's standard lint rules alongside its own
and merge diagnostics into a single report:

```typescript
const biome = await loadBiomeWasm()

// Run biome standard lint
const biomeDiags = biome.lintContent(code, { filePath })

// Run DS Core GritQL patterns
const dsGritDiags = dsPatterns.flatMap(p =>
  biome.searchPattern(code, { filePath, pattern: p.pattern })
)

// Run DS Core TypeScript validators
const dsCoreDiags = await reconciler.validateFile(filePath, code)

// Merge all diagnostics
return mergeDiagnostics(biomeDiags, dsGritDiags, dsCoreDiags)
```

---

## 16. AI Provider Adapter

DS Core's `AIProvider` interface stacks with HyperCanvas's existing AI system.

### 16.1 Existing HyperCanvas AI Architecture

The codebase already has a well-structured, pluggable AI system:

| Layer | Location | Purpose |
|-------|----------|---------|
| Config normalization | `lib/ai-client/config.ts` | Normalizes 5 providers → 2 protocols |
| Unified client | `lib/ai-client/client.ts` | `callAI()`, `callAIStream()` |
| Stream provider | `shared/ai-agent-core.ts` | `StreamProvider` + `ToolExecutor` interfaces |
| Provider defaults | `shared/ai-provider-defaults.ts` | Default URLs, models per provider |
| Server resolution | `server/services/ai-config-resolver.ts` | DB config → `ResolvedAIConfig` |

Five providers, two protocols:

| Provider | Protocol | Default model |
|----------|----------|---------------|
| claude | anthropic | claude-sonnet-4 |
| glm | anthropic | glm-4.7 |
| openai | openai | gpt-4o |
| proxy | anthropic | gemini-2.5-pro (via litellm) |
| opencode | openai | gemini-2.5-pro |

### 16.2 DS Core AIProvider Adapters

DS Core provides ready-made adapters that wrap the existing system:

```typescript
// packages/ds-core/src/adapters/anthropic-ai-adapter.ts

import type { AIProvider, AIValidationRequest, AIValidationResult } from '../types/adapters'

/**
 * Direct Anthropic SDK adapter — for standalone CLI/SDK usage.
 */
export class AnthropicAIAdapter implements AIProvider {
  constructor(private config: { apiKey: string; model?: string }) {}

  async validate(request: AIValidationRequest): Promise<AIValidationResult> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model ?? 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: request.prompt }],
        system: request.systemPrompt,
      }),
    })
    return parseAIResponse(await response.json())
  }

  async suggestFix(violation, context) { /* ... */ }
  async generateTemplate(result, context) { /* ... */ }
}
```

```typescript
// packages/ds-core/src/adapters/hypercanvas-ai-adapter.ts

import type { ResolvedAIConfig } from '@lib/ai-client/config'
import { callAI } from '@lib/ai-client/client'
import type { AIProvider } from '../types/adapters'

/**
 * HyperCanvas-native adapter — reuses existing provider resolution,
 * stacks with all 5 configured providers (claude, glm, openai, proxy, opencode).
 */
export class HyperCanvasAIAdapter implements AIProvider {
  constructor(private config: ResolvedAIConfig) {}

  async validate(request: AIValidationRequest): Promise<AIValidationResult> {
    const raw = await callAI(this.config, request.prompt, {
      system: request.systemPrompt,
      maxTokens: 2048,
    })
    return parseAIResponse(raw)
  }

  async suggestFix(violation, context) { /* ... */ }
  async generateTemplate(result, context) { /* ... */ }
}
```

```typescript
// packages/ds-core/src/adapters/openai-ai-adapter.ts

/**
 * Direct OpenAI adapter — for standalone usage with OpenAI API.
 */
export class OpenAIAIAdapter implements AIProvider {
  constructor(private config: { apiKey: string; model?: string; baseURL?: string }) {}
  // ... fetch to OpenAI chat completions API
}
```

### 16.3 Adapter Selection

```typescript
// Usage in HyperCanvas (server-side)
import { resolveServerAIConfig } from '@server/services/ai-config-resolver'
import { HyperCanvasAIAdapter } from '@hyperide/ds-core/adapters/hypercanvas-ai-adapter'

const aiConfig = await resolveServerAIConfig(workspaceId)
const dsCore = new DSCore({ configPath: '.hyperide/ds.config.ts' })
dsCore.registerAIProvider(new HyperCanvasAIAdapter(aiConfig))

// Usage standalone (CLI)
import { AnthropicAIAdapter } from '@hyperide/ds-core/adapters/anthropic-ai-adapter'

const dsCore = new DSCore({ configPath: '.hyperide/ds.config.ts' })
dsCore.registerAIProvider(new AnthropicAIAdapter({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-haiku-4-5-20251001',
}))

// Usage without AI (algorithmic + templates only)
const dsCore = new DSCore({ configPath: '.hyperide/ds.config.ts' })
// No AI provider registered — intent.* rules skipped, patterns.* use templates only
```

### 16.4 Model Selection Strategy

| Task | Model tier | Why |
|------|-----------|-----|
| Rule validation | Fast/cheap (Haiku) | High volume, simple structured output |
| Template generation | Smart (Sonnet) | Needs generalization ability, low volume |
| Fix suggestion | Fast (Haiku) | Structured output, per-violation |
| Template backtest verification | Smart (Sonnet) | Accuracy matters, low volume |

Configurable in `ds.config.ts`:

```typescript
ai: {
  provider: 'anthropic',
  model: 'claude-haiku-4-5-20251001',         // Validation
  templateModel: 'claude-sonnet-4-6',          // Template generation
  // Or use HyperCanvas workspace config:
  useWorkspaceConfig: true,                     // Inherit from AISettings
}
```

---

## 17. Ecosystem Integration Layer

DS Core is one of four packages in the UI quality ecosystem. All four share
DI adapter patterns, config format conventions, and AI provider infrastructure.

### 17.1 The Four Systems

```
Level 1: LINTERS              Level 2: AI TESTS              Level 3: MONKEY TESTS
────────────────              ───────────────                ─────────────────────
packages/ds-core              packages/ai-test               packages/ai-test
Fast, universal               Product-specific               Unscripted, staging
tokens/patterns/intent        snapshots + spec-based         click-through exploration
ms per rule                   seconds per test               minutes per session
pre-commit, CI                CI, on-demand                  staging environment
```

Supporting infrastructure:

```
packages/component-stage      packages/mock-server
────────────────────────      ────────────────────
Storybook-like playground     Stateful dev server
Component instances + props   Real data + PII masking
Board mode integration        Replaces Postman
```

Full specs: `2026-04-01-ai-test-design.md`, `2026-04-01-component-stage-design.md`,
`2026-04-01-mock-server-design.md`.

### 17.2 Shared Interfaces

All four packages share these DI adapter contracts:

| Interface | Used by | Purpose |
|-----------|---------|---------|
| `AIProvider` | ds-core, ai-test, component-stage, mock-server | AI validation, generation, suggestions |
| `FileSystem` | ds-core, ai-test, component-stage | File read/write abstraction |
| `ScreenshotProvider` | ai-test, component-stage | Captures screenshots (Playwright, CDP) |
| `ComponentIntrospector` | ds-core, ai-test, component-stage | Component discovery and props |
| `TokenProvider` | ds-core, ai-test | Design token resolution |
| `StyleReadAdapter` | ds-core, ai-test | Style reading from code/DOM |
| `DataProvider` | ai-test, component-stage, mock-server | Test data generation |

Shared interfaces live in a thin `packages/ui-quality-shared` package (types only,
zero runtime dependencies).

### 17.3 Data Flow Between Systems

```
┌─────────────────────────────────────────────────────────────┐
│                    Developer's Project                        │
└──────────────────────────┬──────────────────────────────────┘
                           │ source code, configs
                           ↓
┌──────────────┐    ┌──────────────┐    ┌──────────────────┐
│  DS Core     │    │  Component   │    │  Smart Mock      │
│  (linter)    │    │  Stage       │    │  Server          │
│              │    │              │    │  (stateful data) │
│ rules ──────────→ │ stories ────────→ │                  │
│ tokens ─────────→ │ prop schemas │    │ snapshots        │
│ violations   │    │ renderings ──────→│ PII masking      │
└──────┬───────┘    └──────┬───────┘    └────────┬─────────┘
       │                   │                      │
       │    ┌──────────────┴──────────────────────┘
       │    │    component instances + test data
       ↓    ↓
┌──────────────────┐
│  AI Test Runner  │
│                  │
│  L2: snapshots   │ ← references from Figma, specs, Component Stage
│  L2: spec-based  │ ← product specs + DS Core rules
│  L3: monkey      │ ← staging + Mock Server data
└──────────────────┘
```

### 17.4 Config Convention

All four packages use the same config pattern:

```
.hyperide/
  ds.config.ts                    -- DS Core config
  ai-test.config.ts               -- AI Test Runner config
  component-stage.config.ts        -- Component Stage config
  mock-server.config.ts            -- Smart Mock Server config
```

All use biome-style rule format where applicable:
`'severity'` | `['severity', { ...opts }]` | `'off'`

### 17.5 Shared Template System

The self-improving decision template system (section 5-6 and 13) is shared
between DS Core and AI Test Runner:

- DS Core templates: "if code matches pattern X → violation Y with fix Z"
- AI Test templates: "if component renders with props X → visual result should be Y"
- Templates generated by AI Tests can be **promoted** to DS Core rules if
  they're universal enough (cross-project applicability)
- Shared `TemplateStore` adapter interface, shared template DSL

---

## 18. Prior Art

### The "Design Harness" thesis (Brian Lonsdorf, 2025)

The direct inspiration for DS Core. Lonsdorf's LinkedIn post (37+ comments,
widely shared) identified a fundamental problem: designers stuff design
systems into prompts and docs hoping the LLM respects them. Past a certain
length, docs get ignored. Rules get hallucinated away. Sharding helps but
doesn't solve the root issue.

His core argument: **"You don't make AI design systems better by adding more
documentation. You make it better with linters, test harnesses, and tooling
that verifies itself."** AI-native coders have learned that prompts, docs, and
rules are only a fraction of the harness needed for AI to work well.

His proposed solution — a "design harness" rather than a design system:

- Convert designs into a **JSON recipe** — a declarative schema describing
  WHAT should exist, not HOW to build it — paired with a UI interpreter
- Automated **component registry** synced from Storybook
- **Build-time linters** validating AI-generated UI against design rules
- **Runtime-capable agentic UI** that reads/modifies recipes
- Rapid iteration on concise recipes vs code changes
- Separation of design intent from implementation

His key distinction: *"That's not a design system. That's a design harness."*

DS Core implements this thesis: the desired state IS the declarative recipe,
the reconciler IS the build-time linter, the MCP tools enable the agentic UI,
and the template system makes the harness self-improving over time.

### Self-improving decision templates

DS Core is the canonical owner of the decision template infrastructure:
- `DecisionTemplate` schema and `TemplateStore` adapter interface (Section 5)
- Template Match DSL with safe expression language (Section 13)
- Validation Priority Chain: algorithmic → template → AI (Section 6.2)
- Template generation from AI validation results (Section 6.4)

**DS Core-specific template behavior:**
- Templates are scoped to design system rules (ruleId-based matching)
- Template matching uses TemplateIndex with alpha memory pattern for O(1) lookup
- Conflict resolution: specificity (0.5) > recency (0.3) > frequency (0.2)
- Pre-commit mode uses incremental template invalidation (only re-evaluate on changed files)
- Templates can be promoted from AI Test Runner findings (cross-package flow)

For full research on self-improving decision template systems, prior art analysis (30 analogs),
and architectural decisions, see `docs/specs/2026-04-01-self-improving-templates-research.md`.

---

## Appendix A: Feature Summary

- **Package**: `packages/ds-core` — standalone, zero HyperCanvas dependencies
- **Config**: `.hyperide/ds.config.ts` loader with Zod validation + biome-style rule format
- **State model**: Desired (3 layers: inferred + Figma + config) vs Actual (extracted from code)
- **Extractor**: Color, typography, spacing, shape, elevation, a11y, components via DI adapters
- **Reconciler**: Kubernetes-style drift detection + violation generation
- **Presets**: minimal, strict, web-accessibility, apple-hig, material-design, fluent, editorial, app-store
- **Rule sections**: 13 sections, 151 rules across tokens/patterns/intent
- **Algorithmic validators**: contrast, hardcoded colors, palette, spacing grid, type scale, shapes, tap targets, focus, keyboard
- **AI validators**: tone-of-voice, color harmony, design quality, complex a11y, navigation patterns
- **Template system**: AI → candidate template → admin approve/edit/reject → auto-apply + AI double-check
- **Reconciliation**: Full project scan + incremental pre-commit (changed files only)
- **Figma import**: Tokens Studio JSON, Figma Variables API, Figma Styles, layout constraints
- **Three-way diff**: Figma vs Config vs Code — shows drift in all directions
- **Surfaces**: SDK (programmatic API), CLI, MCP tools, pre-commit hook, UI consumer in HyperCanvas
- **HyperCanvas UI**: Token Library Panel (HYP-313), Inspector violations, Violation sidebar, Template approval UI
- **DI adapters**: StyleReadAdapter, StyleWriteAdapter, TokenProvider, ComponentIntrospector, AIProvider, FileSystem, ASTProvider, TemplateStore
- **Biome integration**: WASM for parsing (Rust-speed), GritQL for token-level rules, co-runner for standard lint
- **Three execution tiers**: GritQL (fast) → TypeScript (complex) → AI (smart)
- **AI Provider adapters**: AnthropicAIAdapter (standalone), HyperCanvasAIAdapter (stacks with existing 5 providers), OpenAIAIAdapter (standalone)
- **Model strategy**: Haiku for validation (fast/cheap), Sonnet for template generation (smart)
- **Export**: W3C DTCG (native), CSS Variables, Tailwind config, Tamagui config, Style Dictionary, Figma Variables API, Tokens Studio JSON
- **Bidirectional sync**: Figma → DS Core → Code → DS Core → Figma (round-trip lossless)
- **Autofixes**: algorithmic fixes for token-level violations, AI-suggested fixes for complex patterns

## Appendix B: Prerequisites and Related Work

### Existing tickets that feed into DS Core

| Ticket | Relation | Prerequisite? |
|--------|----------|---------------|
| HYP-299 | Phase 2a: StyleAdapter unification → `lib/style-adapters/` | Yes — DS Core wraps unified adapters |
| HYP-288 | Load Tamagui palette from project config | Yes — dynamic token loading for extractor |
| HYP-289 | Semantic token fallback in getTamaguiTokenFromHex | Yes — better token resolution |
| HYP-313 | Token Library Panel — color aliases + token browser | Consumer — uses DS Core token data |
| HYP-294 | Token table UI — view/edit/manage tokens | Consumer — uses DS Core token data |
| HYP-314 | Full context to AI/MCP (DOM, computed styles, tree) | Parallel — enriches AI validator context |
| HYP-316 | Hardcoded toolbar colors → semantic tokens | Dogfood — exactly what `tokens.color.no-hardcoded` catches |
| HYP-320 | Gray classes → semantic tokens across client | Dogfood — exactly what `tokens.color.no-hardcoded` catches |
| HYP-267 | Generate different design options by AI | Consumer — uses DS spec as generation constraints |
| HYP-341 | Google Stitch ideas — AI visual generation | Consumer — generation within DS constraints |
| HYP-123 | Parent ticket — "think about UX/UI design with AI" | Parent — DS Core is the answer |

### Existing specs to align with

| Spec | Status | Relation |
|------|--------|----------|
| Phase 2 All CSS Frameworks (`docs/specs/2026-03-11-phase2-all-css-frameworks-design.md`) | Approved | DS Core adapters wrap Phase 2 StyleAdapter interface |
| HyperIDE Next Level Design (`docs/plans/2026-03-09-hyperide-next-level-design.md`) | Approved | DS Core is a new pillar alongside Style Adapters and FastPatch |

---

*Next passes: AI linter system architecture, Figma import protocol, template DSL details.*
