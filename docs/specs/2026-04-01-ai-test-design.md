# AI Test Runner — Product-Specific UI Quality Verification

**Date:** 2026-04-01
**Author:** Alex Ultra + Claude
**Status:** Draft (Pass 1 — Architecture)
**Linear:** TBD (child of HYP-123)
**Depends on:** DS Core (`2026-04-01-ds-core-design.md`), Component Stage (`packages/component-stage`), Smart Mock Server (`packages/mock-server`)

## Vision

An AI-powered test system for **product-specific** UI quality. Where DS Core
(Level 1) validates universal design rules — contrast ratios, spacing grids,
token usage — AI Tests validate that YOUR product looks and works correctly
against YOUR specs.

DS Core asks: "Does this button meet WCAG AA contrast?" AI Tests asks:
"Does the login page match the Figma mockup? Does the checkout flow work
as the spec describes? Does the app survive 10 minutes of random clicking?"

Three levels of testing:

1. **Snapshot tests** — AI compares screenshots against reference designs
   (Figma mockups, approved baseline snapshots). Detects visual regressions,
   responsive breakage, dark mode drift.

2. **Spec-based tests** — AI reads product specs (markdown requirements,
   Figma annotations, Linear tickets) and validates UI behavior against them.
   Uses Component Stage to render component variants, Mock Server for edge
   case data.

3. **Monkey tests** (Level 3) — unscripted AI agent exploration on staging
   with realistic data. Finds crashes, console errors, visual glitches,
   dead clicks, slow interactions, and accessibility failures that no one
   thought to test for.

Key differentiators from DS Core:

- Tests are **product-specific**, not universal rules
- Uses **screenshots**, **DOM snapshots**, and **browser automation** — not just static code analysis
- References **product documentation** — specs, tickets, Figma files
- Validates **behavior** (click flows, state transitions), not just appearance
- Self-improving: AI decisions crystallize into deterministic assertions, same template system as DS Core

### Positioning

DS Core = design system linter (Level 1, pre-commit speed, universal rules).
AI Tests = product QA (Level 2-3, CI/staging speed, product-specific assertions).

Together they form a continuous quality pipeline:

```
 L1: DS Core          L2: AI Tests (snapshot + spec)     L3: AI Tests (monkey)
 ─────────────        ──────────────────────────────      ─────────────────────
 Static analysis      Screenshot comparison               Unscripted exploration
 Token validation     Spec-to-UI verification             Crash detection
 Rule enforcement     Behavior verification               Glitch hunting
 Pre-commit speed     CI pipeline speed                   Staging/nightly speed
 Universal rules      Product-specific assertions         Zero prior knowledge
```

> `runners + comparators + context + adapters + surfaces`

---

## 1. Package Structure

```
packages/ai-test/
  src/
    index.ts                            -- Public API: AITestRunner class
    types/
      test.ts                           -- TestDefinition, TestCase, TestSuite schemas
      result.ts                         -- TestResult, ComparisonResult, Finding
      config.ts                         -- AITestConfig schema
      adapters.ts                       -- DI adapter interfaces
      context.ts                        -- TestContext, SpecContext, ScreenshotContext

    config/
      loader.ts                         -- Load config from .hyperide/ai-test.config.ts
      defaults.ts                       -- Default test values per category
      schema.ts                         -- Zod schemas for config validation

    runners/
      snapshot-runner.ts                -- Screenshot comparison test runner
      spec-runner.ts                    -- Spec-based validation runner
      monkey-runner.ts                  -- Unscripted exploration runner
      runner-orchestrator.ts            -- Coordinates all three runners

    comparators/
      visual-diff.ts                    -- AI-powered screenshot comparison
      dom-diff.ts                       -- DOM structure comparison
      behavior-diff.ts                  -- State transition comparison
      pixel-diff.ts                     -- Pixel-level diff (fallback, non-AI)

    context/
      spec-loader.ts                    -- Load specs from markdown, Figma, Linear
      screenshot-capture.ts             -- Screenshot capture orchestrator
      dom-capture.ts                    -- DOM snapshot capture
      component-context.ts             -- Build context from Component Stage
      data-context.ts                   -- Build context from Mock Server

    reporters/
      console-reporter.ts              -- CLI output with pass/fail/diff
      json-reporter.ts                 -- Machine-readable JSON report
      html-reporter.ts                 -- Visual HTML report with side-by-side diffs
      ci-reporter.ts                   -- GitHub Actions / CI annotations

    surfaces/
      sdk.ts                           -- Programmatic API
      cli.ts                           -- CLI entry point
      mcp.ts                           -- MCP tool definitions
      ci-integration.ts                -- CI pipeline hooks

    adapters/
      screenshot/
        playwright-screenshot.ts       -- Playwright-based capture
        cdp-screenshot.ts             -- Chrome DevTools Protocol capture
        hypercanvas-screenshot.ts     -- HyperCanvas preview capture
      dom/
        playwright-dom.ts             -- Playwright DOM snapshot
        cdp-dom.ts                    -- CDP DOM snapshot
      spec/
        markdown-spec.ts              -- Load .md spec files
        notion-spec.ts                -- Load from Notion API
        linear-spec.ts                -- Load from Linear tickets
        figma-spec.ts                 -- Load from Figma file annotations
      browser/
        playwright-browser.ts         -- Playwright browser automation
      component/
        stage-component.ts            -- Component Stage integration
      data/
        mock-server-data.ts           -- Smart Mock Server integration
      ai/
        anthropic-adapter.ts          -- Direct Anthropic API
        hypercanvas-adapter.ts        -- HyperCanvas AI system (reuses DS Core's)
        openai-adapter.ts             -- Direct OpenAI API

    templates/
      template-store.ts               -- Reuses DS Core template infrastructure
      test-template-generator.ts      -- AI → deterministic test assertion
      test-template-matcher.ts        -- Match against existing assertions

  tests/
    ...

  package.json
  tsconfig.json
```

---

## 2. DI Adapter Interfaces

Same pattern as DS Core — all external capabilities injected, zero concrete
dependencies. AI Tests and DS Core share `AIProvider` and `TemplateStore`
interfaces directly.

```typescript
// packages/ai-test/src/types/adapters.ts

/**
 * Captures screenshots of pages, components, or elements.
 *
 * Implementations: PlaywrightScreenshot, CDPScreenshot, HyperCanvasScreenshot.
 */
export interface ScreenshotProvider {
  /** Capture full page screenshot */
  capturePage(url: string, options?: ScreenshotOptions): Promise<Screenshot>

  /** Capture a specific element by selector */
  captureElement(url: string, selector: string, options?: ScreenshotOptions): Promise<Screenshot>

  /** Capture at multiple viewport sizes */
  captureResponsive(
    url: string,
    breakpoints: Breakpoint[],
    options?: ScreenshotOptions,
  ): Promise<ResponsiveScreenshots>

  /** Capture with dark/light mode toggle */
  captureThemes(
    url: string,
    themes: ThemeConfig[],
    options?: ScreenshotOptions,
  ): Promise<ThemedScreenshots>
}

export interface ScreenshotOptions {
  /** Wait for this selector before capturing */
  waitFor?: string
  /** Wait for network idle */
  waitForNetwork?: boolean
  /** Delay after page load (ms) */
  delay?: number
  /** JPEG quality (0-100) */
  quality?: number
  /** Clip region */
  clip?: { x: number; y: number; width: number; height: number }
  /** Mask selectors — elements to hide (PII, dynamic content) */
  mask?: string[]
  /** Animation: capture keyframes instead of static screenshot */
  captureKeyframes?: KeyframeConfig
}

export interface Screenshot {
  /** Base64-encoded image data */
  data: string
  /** Image format */
  format: 'png' | 'jpeg'
  /** Image dimensions */
  width: number
  height: number
  /** Viewport at capture time */
  viewport: { width: number; height: number }
  /** Theme active at capture time */
  theme?: 'light' | 'dark'
  /** Timestamp */
  capturedAt: string
  /** URL captured */
  url: string
}

export interface Breakpoint {
  name: string                          // 'mobile', 'tablet', 'desktop', 'wide'
  width: number                         // 375, 768, 1024, 1440
  height?: number
}

/**
 * Captures DOM state — structure, computed styles, text content.
 *
 * Implementations: PlaywrightDOM, CDPDOM.
 */
export interface DOMSnapshotProvider {
  /** Capture full DOM snapshot */
  capturePage(url: string): Promise<DOMSnapshot>

  /** Capture subtree rooted at selector */
  captureElement(url: string, selector: string): Promise<DOMSnapshot>

  /** Capture accessibility tree */
  captureAccessibilityTree(url: string): Promise<AccessibilityTree>
}

export interface DOMSnapshot {
  /** Serialized DOM (simplified, no scripts) */
  html: string
  /** Computed styles for key elements */
  styles: Map<string, Record<string, string>>
  /** Text content extracted from visible elements */
  textContent: TextNode[]
  /** Element bounding boxes */
  boxes: Map<string, BoundingBox>
  /** ARIA attributes */
  aria: Map<string, Record<string, string>>
  /** Metadata */
  meta: {
    url: string
    title: string
    capturedAt: string
    elementCount: number
  }
}

export interface TextNode {
  selector: string
  text: string
  role: 'heading' | 'label' | 'button' | 'link' | 'body' | 'error' | 'other'
  visible: boolean
}

/**
 * Loads product specifications from various sources.
 * Specs are normalized to a common format for AI consumption.
 *
 * Implementations: MarkdownSpec, NotionSpec, LinearSpec, FigmaSpec.
 */
export interface SpecProvider {
  /** Load all specs matching configuration */
  loadSpecs(): Promise<ProductSpec[]>

  /** Load a specific spec by ID or path */
  loadSpec(ref: string): Promise<ProductSpec | null>

  /** Search specs for content relevant to a component or page */
  searchSpecs(query: string): Promise<SpecExcerpt[]>
}

export interface ProductSpec {
  id: string
  title: string
  source: 'markdown' | 'notion' | 'linear' | 'figma'
  /** Normalized markdown content */
  content: string
  /** Structured sections (if parseable) */
  sections?: SpecSection[]
  /** UI elements referenced in the spec */
  referencedElements?: string[]
  /** Pages/routes referenced */
  referencedPages?: string[]
  /** Last modified */
  updatedAt: string
}

export interface SpecSection {
  title: string
  content: string
  /** Extracted requirements (imperative statements) */
  requirements: Requirement[]
}

export interface Requirement {
  text: string
  /** 'must' | 'should' | 'may' — RFC 2119 keywords */
  priority: 'must' | 'should' | 'may'
  /** Testable? Some requirements are too vague */
  testable: boolean
}

/**
 * Gets component instances from Component Stage.
 * Component Stage provides isolated, controlled component rendering.
 *
 * Implementations: StageComponentProvider.
 */
export interface ComponentProvider {
  /** List all available components */
  listComponents(): Promise<ComponentEntry[]>

  /** Get a component with specific props (rendered URL) */
  getComponentURL(name: string, props?: Record<string, unknown>): Promise<string>

  /** Get all prop combinations for a component (from examples/stories) */
  getVariants(name: string): Promise<ComponentVariant[]>

  /** Get the component's prop type information */
  getPropTypes(name: string): Promise<PropTypeInfo>
}

export interface ComponentEntry {
  name: string
  category: string
  /** Number of defined examples/stories */
  variantCount: number
  /** Prop type summary */
  propSummary: string
}

export interface ComponentVariant {
  name: string                          // 'default', 'loading', 'error', 'empty'
  props: Record<string, unknown>
  description?: string
  /** Pre-rendered URL (from Component Stage) */
  url: string
}

/**
 * Gets test data from Smart Mock Server.
 * Provides realistic, PII-masked data for testing.
 *
 * Implementations: MockServerDataProvider.
 */
export interface DataProvider {
  /** Get data for a specific scenario */
  getData(scenario: DataScenario): Promise<MockData>

  /** List available scenarios */
  listScenarios(): Promise<DataScenario[]>

  /** Generate edge case data for a given schema */
  generateEdgeCases(schema: DataSchema): Promise<MockData[]>
}

export interface DataScenario {
  name: string                          // 'empty-list', 'long-strings', 'many-items', 'unicode'
  description: string
  category: 'happy-path' | 'edge-case' | 'error' | 'stress'
}

export interface MockData {
  scenario: string
  data: Record<string, unknown>
  /** PII masking applied */
  piiMasked: boolean
}

/**
 * AI provider — reuses DS Core's AIProvider interface exactly.
 * Same adapters work for both DS Core and AI Tests.
 */
export type { AIProvider } from '@hyperide/ds-core/types/adapters'

/**
 * Reads DS Core's desired state and rules.
 * AI Tests use DS Core's tokens as known-good baseline.
 *
 * Implementation: DSCoreDesignSystemProvider.
 */
export interface DesignSystemProvider {
  /** Get the resolved desired state from DS Core */
  getDesiredState(): Promise<DesiredState>

  /** Get active rules */
  getRules(): Promise<ResolvedRule[]>

  /** Get violations from last DS Core run */
  getViolations(): Promise<Violation[]>

  /** Get design tokens by category */
  getTokens(category?: string): Promise<DesignToken[]>
}

/**
 * Drives browser interactions for monkey tests and behavior verification.
 *
 * Implementations: PlaywrightBrowser.
 */
export interface BrowserAutomation {
  /** Navigate to URL */
  goto(url: string): Promise<void>

  /** Click element */
  click(selector: string): Promise<void>

  /** Type text into element */
  type(selector: string, text: string): Promise<void>

  /** Get current URL */
  currentURL(): Promise<string>

  /** Get console messages since last check */
  getConsoleMessages(): Promise<ConsoleMessage[]>

  /** Get uncaught exceptions since last check */
  getExceptions(): Promise<UncaughtException[]>

  /** Get all interactive elements on current page */
  getInteractiveElements(): Promise<InteractiveElement[]>

  /** Scroll to element or position */
  scroll(target: string | { x: number; y: number }): Promise<void>

  /** Wait for condition */
  waitFor(condition: WaitCondition): Promise<void>

  /** Take screenshot of current state */
  screenshot(options?: ScreenshotOptions): Promise<Screenshot>

  /** Get element's bounding box */
  getBoundingBox(selector: string): Promise<BoundingBox | null>

  /** Check if element is visible */
  isVisible(selector: string): Promise<boolean>

  /** Set viewport size */
  setViewport(width: number, height: number): Promise<void>

  /** Toggle dark/light mode via prefers-color-scheme emulation */
  setTheme(theme: 'light' | 'dark'): Promise<void>

  /** Measure time between action and DOM change */
  measureInteraction(
    action: () => Promise<void>,
    waitFor: string,
  ): Promise<{ durationMs: number }>
}

export interface ConsoleMessage {
  type: 'log' | 'warn' | 'error' | 'info'
  text: string
  url?: string
  line?: number
}

export interface UncaughtException {
  message: string
  stack?: string
  url?: string
}

export interface InteractiveElement {
  selector: string
  tag: string
  role?: string
  text?: string
  visible: boolean
  enabled: boolean
  boundingBox: BoundingBox
}
```

### Adapter Registration

```typescript
// packages/ai-test/src/index.ts

export class AITestRunner {
  private screenshotProvider?: ScreenshotProvider
  private domProvider?: DOMSnapshotProvider
  private specProvider?: SpecProvider
  private componentProvider?: ComponentProvider
  private dataProvider?: DataProvider
  private aiProvider?: AIProvider
  private designSystemProvider?: DesignSystemProvider
  private browserAutomation?: BrowserAutomation
  private templateStore?: TemplateStore

  constructor(private config: AITestConfig) {}

  /** Register screenshot provider */
  registerScreenshotProvider(provider: ScreenshotProvider): void {
    this.screenshotProvider = provider
  }

  /** Register DOM snapshot provider */
  registerDOMProvider(provider: DOMSnapshotProvider): void {
    this.domProvider = provider
  }

  /** Register spec provider(s) — multiple can be registered */
  registerSpecProvider(provider: SpecProvider): void { ... }

  /** Register component provider (Component Stage) */
  registerComponentProvider(provider: ComponentProvider): void { ... }

  /** Register data provider (Mock Server) */
  registerDataProvider(provider: DataProvider): void { ... }

  /** Register AI provider — same interface as DS Core */
  registerAIProvider(provider: AIProvider): void { ... }

  /** Register design system provider — reads DS Core state */
  registerDesignSystemProvider(provider: DesignSystemProvider): void { ... }

  /** Register browser automation — required for monkey tests */
  registerBrowserAutomation(browser: BrowserAutomation): void { ... }

  /** Register template store — shared with DS Core */
  registerTemplateStore(store: TemplateStore): void { ... }

  // --- Core operations ---

  /** Run all enabled tests */
  async run(): Promise<TestReport> { ... }

  /** Run only snapshot tests */
  async runSnapshots(): Promise<TestReport> { ... }

  /** Run only spec-based tests */
  async runSpecs(): Promise<TestReport> { ... }

  /** Run monkey tests */
  async runMonkey(options?: MonkeyOptions): Promise<TestReport> { ... }

  /** Run tests for a specific component */
  async runComponent(name: string): Promise<TestReport> { ... }

  /** Run tests for a specific page/route */
  async runPage(url: string): Promise<TestReport> { ... }

  /** Update baseline snapshots (approve current state as reference) */
  async updateBaselines(filter?: TestFilter): Promise<void> { ... }
}
```

---

## 3. Test Definition Schema

Biome/eslint-like config — same convention as DS Core for consistency.
Every test rule is `'error'` / `['warning', { ...opts }]` / `'off'`.

```typescript
// packages/ai-test/src/types/config.ts

import { z } from 'zod'

export const SeveritySchema = z.enum(['error', 'warning', 'info', 'off'])
export type Severity = z.infer<typeof SeveritySchema>

export const TestConfigSchema = z.union([
  SeveritySchema,
  z.tuple([SeveritySchema]),
  z.tuple([SeveritySchema, z.record(z.unknown())]),
])
export type TestConfig = z.infer<typeof TestConfigSchema>

export const AITestConfigSchema = z.object({
  /** Product spec sources — globbed markdown files, Notion pages, etc. */
  specs: z.array(z.string()).default([]),

  /** Figma reference designs */
  figma: z.object({
    fileId: z.string(),
    /** Map Figma page names to routes/components */
    pageMap: z.record(z.string()).optional(),
    /** Auto-update reference screenshots from Figma */
    autoSync: z.boolean().default(false),
  }).optional(),

  /** Base URL for page-level tests */
  baseUrl: z.string().default('http://localhost:3000'),

  /** Staging URL for monkey tests */
  stagingUrl: z.string().optional(),

  /** Baseline snapshot directory */
  baselineDir: z.string().default('.hyperide/ai-test/baselines'),

  /** Test configuration per category */
  tests: z.object({
    snapshot: z.record(TestConfigSchema).default({}),
    spec: z.record(TestConfigSchema).default({}),
    monkey: z.record(TestConfigSchema).default({}),
  }),

  /** Component Stage integration */
  componentStage: z.object({
    baseUrl: z.string().default('http://localhost:6100'),
    /** Auto-discover components */
    autoDiscover: z.boolean().default(true),
  }).optional(),

  /** Smart Mock Server integration */
  mockServer: z.object({
    baseUrl: z.string().default('http://localhost:6200'),
  }).optional(),

  /** DS Core integration */
  dsCore: z.object({
    configPath: z.string().default('.hyperide/ds.config.ts'),
    /** Use DS Core tokens as baseline knowledge */
    inheritTokens: z.boolean().default(true),
    /** Use DS Core violations to trigger focused AI Tests */
    triggerOnViolations: z.boolean().default(false),
  }).optional(),

  /** AI provider config */
  ai: z.object({
    provider: z.enum(['anthropic', 'openai', 'hypercanvas']).default('anthropic'),
    model: z.string().default('claude-haiku-4-5-20251001'),
    /** Model for complex analysis (spec parsing, monkey reasoning) */
    analysisModel: z.string().default('claude-sonnet-4-6'),
    maxAICalls: z.number().default(100),
    templateApproval: z.enum(['required', 'auto']).default('required'),
  }).optional(),

  /** Responsive breakpoints */
  breakpoints: z.array(z.object({
    name: z.string(),
    width: z.number(),
    height: z.number().optional(),
  })).default([
    { name: 'mobile', width: 375 },
    { name: 'tablet', width: 768 },
    { name: 'desktop', width: 1024 },
    { name: 'wide', width: 1440 },
  ]),

  /** Pages/routes to test (for page-level tests) */
  pages: z.array(z.object({
    path: z.string(),
    name: z.string(),
    /** Spec reference for this page */
    specRef: z.string().optional(),
    /** Figma page name reference */
    figmaPage: z.string().optional(),
    /** Authentication required */
    auth: z.boolean().default(false),
  })).default([]),
})

export type AITestConfig = z.infer<typeof AITestConfigSchema>
```

### Example Config

```typescript
// .hyperide/ai-test.config.ts

import { defineAITests } from '@hyperide/ai-test'

export default defineAITests({
  specs: ['docs/specs/*.md', 'docs/requirements/*.md'],
  figma: {
    fileId: 'abc123def456',
    pageMap: {
      'Login': '/login',
      'Dashboard': '/dashboard',
      'Settings': '/settings',
      'Components/Button': 'Button',
      'Components/Card': 'Card',
    },
  },

  baseUrl: 'http://localhost:3000',
  stagingUrl: 'https://staging.myapp.com',
  baselineDir: '.hyperide/ai-test/baselines',

  tests: {
    snapshot: {
      'visual-regression': ['error', { threshold: 0.01 }],
      'responsive-breakpoints': ['warning', {
        breakpoints: [375, 768, 1024, 1440],
      }],
      'dark-mode-parity': 'warning',
      'component-variants': ['warning', {
        maxVariants: 20,
      }],
      'animation-keyframes': 'off',
      'empty-state': 'warning',
    },
    spec: {
      'matches-figma': 'error',
      'matches-spec': 'warning',
      'edge-cases': ['warning', {
        scenarios: ['empty-list', 'long-strings', 'many-items'],
      }],
      'error-states': 'warning',
      'loading-states': 'warning',
      'form-validation': 'error',
      'navigation-flow': 'warning',
    },
    monkey: {
      'crash-resistance': 'error',
      'console-errors': 'error',
      'visual-glitches': 'warning',
      'dead-clicks': 'warning',
      'slow-interactions': ['warning', { maxMs: 300 }],
      'accessibility-runtime': 'warning',
      'responsive-resize': 'warning',
    },
  },

  componentStage: {
    baseUrl: 'http://localhost:6100',
    autoDiscover: true,
  },

  mockServer: {
    baseUrl: 'http://localhost:6200',
  },

  dsCore: {
    configPath: '.hyperide/ds.config.ts',
    inheritTokens: true,
    triggerOnViolations: true,
  },

  ai: {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    analysisModel: 'claude-sonnet-4-6',
    maxAICalls: 100,
    templateApproval: 'required',
  },

  breakpoints: [
    { name: 'mobile', width: 375, height: 812 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1024, height: 768 },
    { name: 'wide', width: 1440, height: 900 },
  ],

  pages: [
    { path: '/login', name: 'Login', specRef: 'auth-spec', figmaPage: 'Login' },
    { path: '/dashboard', name: 'Dashboard', figmaPage: 'Dashboard', auth: true },
    { path: '/settings', name: 'Settings', figmaPage: 'Settings', auth: true },
    { path: '/projects', name: 'Projects', auth: true },
    { path: '/projects/:id', name: 'Project Detail', auth: true },
  ],
})
```

---

## 4. Test Result Model

```typescript
// packages/ai-test/src/types/result.ts

import { z } from 'zod'

export const TestResultSchema = z.object({
  /** Test ID (rule + target) */
  id: z.string(),

  /** Rule ID: 'snapshot.visual-regression', 'spec.matches-figma', etc. */
  ruleId: z.string(),

  /** Test category */
  category: z.enum(['snapshot', 'spec', 'monkey']),

  /** Pass, fail, or skip */
  status: z.enum(['pass', 'fail', 'skip', 'error']),

  /** Severity from config */
  severity: z.enum(['error', 'warning', 'info']),

  /** What was tested */
  target: z.object({
    type: z.enum(['page', 'component', 'element', 'flow']),
    name: z.string(),
    url: z.string().optional(),
    selector: z.string().optional(),
    breakpoint: z.string().optional(),
    theme: z.string().optional(),
  }),

  /** Human-readable description of the finding */
  message: z.string(),

  /** AI reasoning (when AI was involved) */
  reasoning: z.string().optional(),

  /** AI confidence (0-1) */
  confidence: z.number().min(0).max(1).optional(),

  /** Visual evidence */
  evidence: z.object({
    /** Current screenshot */
    actual: z.string().optional(),
    /** Expected/baseline screenshot */
    expected: z.string().optional(),
    /** Diff visualization */
    diff: z.string().optional(),
    /** DOM snapshot at time of finding */
    domSnapshot: z.string().optional(),
    /** Console messages collected */
    consoleMessages: z.array(z.string()).optional(),
    /** Video/gif of interaction (for monkey) */
    recording: z.string().optional(),
  }).optional(),

  /** How this result was determined */
  validatedBy: z.enum(['pixel-diff', 'ai-visual', 'ai-spec', 'ai-monkey', 'template']),

  /** Template that was applied (if any) */
  templateId: z.string().optional(),

  /** Duration of this individual test (ms) */
  duration: z.number(),
})

export type TestResult = z.infer<typeof TestResultSchema>

export const TestReportSchema = z.object({
  /** All test results */
  results: z.array(TestResultSchema),

  /** Summary counts */
  summary: z.object({
    total: z.number(),
    passed: z.number(),
    failed: z.number(),
    skipped: z.number(),
    errors: z.number(),
    warnings: z.number(),
  }),

  /** Per-category breakdown */
  categories: z.record(z.object({
    total: z.number(),
    passed: z.number(),
    failed: z.number(),
  })),

  /** New templates generated this run */
  newTemplates: z.array(z.unknown()),

  /** Templates applied (skipped AI) */
  templatesApplied: z.number(),

  /** Metadata */
  meta: z.object({
    startedAt: z.string(),
    completedAt: z.string(),
    duration: z.number(),
    aiCalls: z.number(),
    screenshotsCaptured: z.number(),
    pagesVisited: z.number(),
    componentsRendered: z.number(),
    templateMatches: z.number(),
  }),
})

export type TestReport = z.infer<typeof TestReportSchema>
```

---

## 5. Snapshot Tests

Snapshot tests compare current UI against reference images. The comparison
is AI-powered — the AI understands layout, text, and intentional vs accidental
changes.

### 5.1 Snapshot Test Rules

| ID | Rule | Description | Default | AI? |
|----|------|-------------|---------|-----|
| `snapshot.visual-regression` | Visual regression | Current screenshot matches baseline within threshold | error | yes |
| `snapshot.responsive-breakpoints` | Responsive breakpoints | UI renders correctly at all configured breakpoints | warning | yes |
| `snapshot.dark-mode-parity` | Dark mode parity | Dark mode is complete — no missing styles, readable text, proper contrast | warning | yes |
| `snapshot.component-variants` | Component variants | All component variants render without visual errors | warning | yes |
| `snapshot.animation-keyframes` | Animation keyframes | Animation keyframes match expected sequence (NOT realtime) | off | yes |
| `snapshot.empty-state` | Empty state handling | Empty data states show appropriate placeholder, not broken layout | warning | yes |
| `snapshot.loading-state` | Loading state | Loading states show skeleton/spinner, not blank screen | warning | yes |
| `snapshot.error-state` | Error state | Error states show user-friendly message, not stack trace | warning | yes |
| `snapshot.text-overflow` | Text overflow | Long text is handled gracefully (truncation, wrapping, scroll) | warning | pixel |
| `snapshot.image-loading` | Image loading | Images load or show appropriate fallback | warning | pixel |

### 5.2 Snapshot Capture Flow

```
Config (pages + breakpoints + themes)
    ↓
┌─────────────────────────┐
│ Screenshot Orchestrator  │
│                          │
│ For each page:           │
│   For each breakpoint:   │
│     For each theme:      │
│       1. Navigate         │
│       2. Wait for idle    │
│       3. Mask dynamic     │
│       4. Capture          │
│       5. Store w/ key     │
└──────────┬──────────────┘
           ↓
  Screenshot[page][breakpoint][theme]
           ↓
  Compare against baselines
```

### 5.3 AI-Powered Visual Comparison

Pixel diff catches everything but understands nothing. AI comparison
understands layout, content changes, and intentional redesigns.

```typescript
// packages/ai-test/src/comparators/visual-diff.ts

export class AIVisualComparator {
  constructor(
    private ai: AIProvider,
    private pixelDiff: PixelDiffComparator,
  ) {}

  async compare(
    actual: Screenshot,
    baseline: Screenshot,
    context: ComparisonContext,
  ): Promise<ComparisonResult> {
    // Step 1: Fast pixel diff as pre-filter
    const pixelResult = this.pixelDiff.compare(actual, baseline)

    if (pixelResult.diffPercent < context.threshold) {
      return { status: 'pass', diffPercent: pixelResult.diffPercent, validatedBy: 'pixel-diff' }
    }

    // Step 2: AI analysis for diffs above threshold
    const aiResult = await this.ai.validate({
      systemPrompt: buildVisualComparisonPrompt(context),
      prompt: buildVisualComparisonRequest(actual, baseline, pixelResult),
    })

    return parseComparisonResult(aiResult)
  }
}
```

### 5.4 Visual Comparison Prompt

```typescript
function buildVisualComparisonPrompt(context: ComparisonContext): string {
  return `You are a visual QA tester. Compare two screenshots of a UI:
- "baseline" is the approved reference (previous good state or Figma design)
- "actual" is the current state being tested

Your job: determine if the differences are INTENTIONAL changes or REGRESSIONS.

Context:
- Page: ${context.pageName}
- Breakpoint: ${context.breakpoint.name} (${context.breakpoint.width}px)
- Theme: ${context.theme}
- Pixel diff: ${context.pixelDiffPercent}% of pixels changed
- DS Core tokens: ${JSON.stringify(context.designTokens)}

Classification rules:
1. PASS — identical or pixel-level anti-aliasing differences only
2. PASS (intentional) — content change (different data), animation frame,
   or clearly updated design element
3. FAIL (regression) — broken layout, overlapping elements, cut-off text,
   missing elements, wrong colors, misaligned components
4. FAIL (unknown) — significant visual change that needs human review

Respond with JSON:
{
  "decision": "pass" | "fail",
  "classification": "identical" | "intentional" | "regression" | "unknown",
  "confidence": 0.0-1.0,
  "findings": [
    {
      "region": "top-left | top-right | center | bottom | ...",
      "description": "what changed",
      "severity": "error" | "warning" | "info"
    }
  ],
  "generalizable": true/false
}`
}
```

### 5.5 Responsive Breakpoint Testing

```typescript
async function testResponsiveBreakpoints(
  page: PageConfig,
  breakpoints: Breakpoint[],
  screenshotProvider: ScreenshotProvider,
  comparator: AIVisualComparator,
): Promise<TestResult[]> {
  const results: TestResult[] = []

  const screenshots = await screenshotProvider.captureResponsive(
    page.path,
    breakpoints,
  )

  for (const bp of breakpoints) {
    const actual = screenshots.get(bp.name)
    const baseline = await loadBaseline(page.path, bp.name)

    if (!baseline) {
      results.push({
        ruleId: 'snapshot.responsive-breakpoints',
        status: 'skip',
        message: `No baseline for ${page.name} at ${bp.name} — run update-baselines first`,
        // ... other fields
      })
      continue
    }

    const comparison = await comparator.compare(actual, baseline, {
      pageName: page.name,
      breakpoint: bp,
      threshold: 0.01,
    })

    results.push(comparisonToResult(comparison, {
      ruleId: 'snapshot.responsive-breakpoints',
      target: { type: 'page', name: page.name, breakpoint: bp.name },
    }))
  }

  return results
}
```

### 5.6 Dark Mode Parity Testing

Dark mode parity is not "identical to light mode" — it's "complete and
coherent in its own right." The AI checks for:

- Missing dark mode styles (elements still showing light-mode colors)
- Insufficient contrast in dark mode
- Images/icons without dark mode variants
- Shadows that don't work on dark backgrounds (should use tonal elevation)
- Text readability against dark surfaces

```typescript
async function testDarkModeParity(
  page: PageConfig,
  screenshotProvider: ScreenshotProvider,
  ai: AIProvider,
  dsTokens: DesignToken[],
): Promise<TestResult> {
  const themes = await screenshotProvider.captureThemes(
    page.path,
    [{ name: 'light', mediaQuery: '(prefers-color-scheme: light)' },
     { name: 'dark', mediaQuery: '(prefers-color-scheme: dark)' }],
  )

  const result = await ai.validate({
    systemPrompt: `You are a dark mode QA specialist. You are given light and dark
mode screenshots of the same page. Check that dark mode is COMPLETE and COHERENT.

Dark mode is NOT "invert everything." It is a separate, intentional design:
- Surfaces use dark tones (not inverted light)
- Text is light on dark, with proper contrast
- Shadows reduce or disappear (use tonal elevation instead)
- Images/icons adapt or are readable against dark backgrounds
- All elements have dark mode styling (no "missed" white backgrounds)

DS Core tokens for reference: ${JSON.stringify(dsTokens)}

Respond with JSON:
{
  "decision": "pass" | "fail",
  "confidence": 0.0-1.0,
  "findings": [
    { "element": "description", "issue": "what's wrong", "severity": "error|warning" }
  ]
}`,
    prompt: 'Compare these light and dark mode screenshots.',
    images: [
      { label: 'light-mode', data: themes.get('light').data },
      { label: 'dark-mode', data: themes.get('dark').data },
    ],
  })

  return parseTestResult(result, {
    ruleId: 'snapshot.dark-mode-parity',
    target: { type: 'page', name: page.name },
  })
}
```

### 5.7 Animation Keyframe Testing

Animations are NOT tested in realtime. Instead, they are captured as
keyframe sequences and compared as a series of static frames.

```typescript
interface KeyframeConfig {
  /** CSS animation/transition to capture */
  trigger: string                       // Selector + action: 'button:hover', 'dialog.open'
  /** Number of keyframes to capture */
  frames: number                        // 5-10 typically
  /** Total duration to spread frames over (ms) */
  duration: number
}

// Capture flow:
// 1. Set animation to paused state
// 2. Step through percentages: 0%, 25%, 50%, 75%, 100%
// 3. Capture screenshot at each step
// 4. AI compares keyframe sequence against baseline sequence
```

---

## 6. Spec-Based Tests

Spec-based tests bridge the gap between product documentation and running UI.
AI reads the spec, then verifies the UI matches what the spec describes.

### 6.1 Spec-Based Test Rules

| ID | Rule | Description | Default | AI? |
|----|------|-------------|---------|-----|
| `spec.matches-figma` | Matches Figma | UI matches the Figma design file | error | yes |
| `spec.matches-spec` | Matches spec | UI behavior matches written product spec | warning | yes |
| `spec.edge-cases` | Edge case handling | UI handles edge case data gracefully | warning | yes |
| `spec.error-states` | Error state spec | Error states match spec description | warning | yes |
| `spec.loading-states` | Loading state spec | Loading states match spec description | warning | yes |
| `spec.form-validation` | Form validation | Form validation matches spec rules | error | yes |
| `spec.navigation-flow` | Navigation flow | User flows match spec-defined paths | warning | yes |
| `spec.data-display` | Data display | Data displays match spec field mapping | warning | yes |
| `spec.permissions` | Permission states | UI adapts to user role as spec defines | warning | yes |
| `spec.empty-state-content` | Empty state content | Empty state copy and CTA match spec | warning | yes |

### 6.2 Spec Loading and Parsing

```typescript
// packages/ai-test/src/context/spec-loader.ts

export class SpecLoader {
  constructor(private providers: SpecProvider[]) {}

  /**
   * Load all specs, parse requirements, build a searchable index.
   */
  async loadAll(): Promise<SpecIndex> {
    const allSpecs: ProductSpec[] = []

    for (const provider of this.providers) {
      const specs = await provider.loadSpecs()
      allSpecs.push(...specs)
    }

    return new SpecIndex(allSpecs)
  }
}

/**
 * Searchable index of product specs.
 * Allows tests to find relevant spec sections for a given page/component.
 */
export class SpecIndex {
  private specs: ProductSpec[]
  private requirementsByPage: Map<string, Requirement[]>
  private requirementsByComponent: Map<string, Requirement[]>

  constructor(specs: ProductSpec[]) {
    this.specs = specs
    this.requirementsByPage = this.indexByPage(specs)
    this.requirementsByComponent = this.indexByComponent(specs)
  }

  /** Find all requirements relevant to a page/route */
  forPage(pagePath: string): Requirement[] {
    return this.requirementsByPage.get(pagePath) ?? []
  }

  /** Find all requirements relevant to a component */
  forComponent(componentName: string): Requirement[] {
    return this.requirementsByComponent.get(componentName) ?? []
  }

  /** Full-text search across all specs */
  search(query: string): SpecExcerpt[] { ... }

  /** Get complete spec content for AI context */
  getSpecContent(specId: string): string {
    const spec = this.specs.find(s => s.id === specId)
    return spec?.content ?? ''
  }
}
```

### 6.3 Spec-Based Test Execution

```typescript
// packages/ai-test/src/runners/spec-runner.ts

export class SpecRunner {
  constructor(
    private specIndex: SpecIndex,
    private screenshotProvider: ScreenshotProvider,
    private domProvider: DOMSnapshotProvider,
    private componentProvider: ComponentProvider | undefined,
    private dataProvider: DataProvider | undefined,
    private ai: AIProvider,
    private browser: BrowserAutomation,
  ) {}

  async runPageSpec(page: PageConfig): Promise<TestResult[]> {
    const results: TestResult[] = []

    // 1. Load relevant specs for this page
    const requirements = this.specIndex.forPage(page.path)
    if (requirements.length === 0) {
      return [skipResult('spec.matches-spec', page, 'No specs found for this page')]
    }

    // 2. Capture current state
    const screenshot = await this.screenshotProvider.capturePage(page.path)
    const dom = await this.domProvider.capturePage(page.path)

    // 3. AI validates each requirement against current state
    for (const req of requirements.filter(r => r.testable)) {
      const result = await this.validateRequirement(req, screenshot, dom, page)
      results.push(result)
    }

    return results
  }

  private async validateRequirement(
    requirement: Requirement,
    screenshot: Screenshot,
    dom: DOMSnapshot,
    page: PageConfig,
  ): Promise<TestResult> {
    const result = await this.ai.validate({
      systemPrompt: buildSpecValidationPrompt(),
      prompt: buildSpecValidationRequest(requirement, dom, page),
      images: [{ label: 'current-ui', data: screenshot.data }],
    })

    return parseTestResult(result, {
      ruleId: 'spec.matches-spec',
      target: { type: 'page', name: page.name },
    })
  }
}
```

### 6.4 Spec Validation Prompt

```typescript
function buildSpecValidationPrompt(): string {
  return `You are a QA engineer validating UI against product specifications.

You receive:
1. A product requirement (what the UI SHOULD do)
2. A screenshot of the current UI
3. A DOM snapshot with text content and element structure

Your job: determine if the requirement is SATISFIED by the current UI.

Classification:
- PASS — requirement is clearly satisfied
- FAIL — requirement is clearly NOT satisfied
- INCONCLUSIVE — cannot determine from screenshot + DOM alone (needs interaction)

Be precise. Don't infer behavior you can't see. If the requirement says
"clicking X navigates to Y" and you only have a static screenshot,
mark as INCONCLUSIVE with a note about what interaction is needed.

Respond with JSON:
{
  "decision": "pass" | "fail" | "inconclusive",
  "confidence": 0.0-1.0,
  "reasoning": "detailed explanation",
  "evidence": "what in the screenshot/DOM confirms or denies this",
  "missingElements": ["list", "of", "missing", "ui", "elements"],
  "interactionNeeded": "description of interaction to verify (if inconclusive)",
  "generalizable": true/false
}`
}
```

### 6.5 Figma Comparison

```typescript
async function testMatchesFigma(
  page: PageConfig,
  figmaSpec: FigmaSpec,
  screenshotProvider: ScreenshotProvider,
  ai: AIProvider,
): Promise<TestResult> {
  // 1. Get Figma frame as image
  const figmaImage = await figmaSpec.getFrameImage(page.figmaPage)
  if (!figmaImage) {
    return skipResult('spec.matches-figma', page, `No Figma page "${page.figmaPage}" found`)
  }

  // 2. Capture current UI
  const actual = await screenshotProvider.capturePage(page.path)

  // 3. AI compares — not pixel-perfect, but structural + stylistic match
  const result = await ai.validate({
    systemPrompt: `You are comparing a Figma design mockup against an implemented UI.
The implementation does NOT need to be pixel-perfect. You are checking for:

1. All elements from the design are present in the implementation
2. Layout structure matches (flex direction, grid, spacing)
3. Typography hierarchy matches (headings, body, captions)
4. Color usage matches (backgrounds, text colors, accents)
5. Component composition matches (buttons, inputs, cards, etc.)
6. Spacing and alignment are consistent with the design

Acceptable differences:
- Anti-aliasing, font rendering differences
- Slight color variation due to color space conversion
- Dynamic content (different data from design placeholder)
- Browser-specific rendering (scrollbars, form controls)

Respond with JSON:
{
  "decision": "pass" | "fail",
  "confidence": 0.0-1.0,
  "matchScore": 0.0-1.0,
  "findings": [
    {
      "element": "what's different",
      "expected": "from Figma",
      "actual": "in implementation",
      "severity": "error" | "warning"
    }
  ]
}`,
    prompt: 'Compare the Figma design (baseline) against the implementation (actual).',
    images: [
      { label: 'figma-design', data: figmaImage },
      { label: 'implementation', data: actual.data },
    ],
  })

  return parseTestResult(result, {
    ruleId: 'spec.matches-figma',
    target: { type: 'page', name: page.name },
  })
}
```

### 6.6 Edge Case Testing with Component Stage + Mock Server

```typescript
async function testEdgeCases(
  componentName: string,
  componentProvider: ComponentProvider,
  dataProvider: DataProvider,
  screenshotProvider: ScreenshotProvider,
  ai: AIProvider,
): Promise<TestResult[]> {
  const results: TestResult[] = []
  const variants = await componentProvider.getVariants(componentName)
  const propTypes = await componentProvider.getPropTypes(componentName)

  // 1. Get edge case data from Mock Server
  const edgeCases = await dataProvider.generateEdgeCases(propTypes.schema)

  // 2. Render component with each edge case
  for (const edgeCase of edgeCases) {
    const url = await componentProvider.getComponentURL(componentName, edgeCase.data)
    const screenshot = await screenshotProvider.capturePage(url)

    // 3. AI checks for visual issues
    const result = await ai.validate({
      systemPrompt: `You are testing a UI component with edge case data.
The component "${componentName}" is rendered with the following data scenario:
"${edgeCase.scenario}" — ${edgeCase.description}

Check for:
1. Text overflow — long strings cut off, overlapping, or breaking layout
2. Empty states — empty arrays/null values show placeholder, not crash
3. Numeric extremes — very large/small numbers display correctly
4. Unicode — special characters render properly
5. Layout integrity — component maintains its structure with unusual data
6. Error boundaries — errors show fallback, not blank screen

Respond with JSON:
{
  "decision": "pass" | "fail",
  "confidence": 0.0-1.0,
  "findings": [
    { "issue": "description", "severity": "error" | "warning" }
  ]
}`,
      prompt: `Component: ${componentName}\nScenario: ${edgeCase.scenario}\nData: ${JSON.stringify(edgeCase.data)}`,
      images: [{ label: 'component', data: screenshot.data }],
    })

    results.push(parseTestResult(result, {
      ruleId: 'spec.edge-cases',
      target: { type: 'component', name: componentName },
    }))
  }

  return results
}
```

### 6.7 Form Validation Testing

```typescript
async function testFormValidation(
  page: PageConfig,
  specIndex: SpecIndex,
  browser: BrowserAutomation,
  ai: AIProvider,
): Promise<TestResult[]> {
  const results: TestResult[] = []
  const requirements = specIndex.forPage(page.path)
    .filter(r => r.text.toLowerCase().includes('validat'))

  await browser.goto(page.path)

  // 1. Find all form fields
  const forms = await browser.getInteractiveElements()
  const inputs = forms.filter(e => ['input', 'textarea', 'select'].includes(e.tag))

  // 2. Test empty submission
  const submitBtn = forms.find(e =>
    e.tag === 'button' && e.text?.toLowerCase().includes('submit')
  )
  if (submitBtn) {
    await browser.click(submitBtn.selector)
    const screenshot = await browser.screenshot()
    const consoleMessages = await browser.getConsoleMessages()

    const result = await ai.validate({
      systemPrompt: buildFormValidationPrompt(requirements),
      prompt: 'Form submitted empty. Check validation messages.',
      images: [{ label: 'after-empty-submit', data: screenshot.data }],
    })

    results.push(parseTestResult(result, {
      ruleId: 'spec.form-validation',
      target: { type: 'page', name: page.name },
    }))
  }

  // 3. Test invalid data per field
  for (const input of inputs) {
    const invalidValues = generateInvalidValues(input)
    for (const invalidValue of invalidValues) {
      await browser.type(input.selector, invalidValue)
      // blur to trigger validation
      await browser.click('body')
      const screenshot = await browser.screenshot()

      // AI checks if validation message appeared and is correct
      // ... similar to empty submission check
    }
  }

  return results
}
```

---

## 7. Monkey Tests (Level 3)

Monkey tests deploy an AI agent that explores the application with no
predetermined path. The agent clicks, types, scrolls, and navigates —
looking for anything that breaks.

### 7.1 Monkey Test Rules

| ID | Rule | Description | Default |
|----|------|-------------|---------|
| `monkey.crash-resistance` | Crash resistance | No unhandled exceptions during exploration | error |
| `monkey.console-errors` | Console errors | No unexpected console.error() calls | error |
| `monkey.visual-glitches` | Visual glitches | No overlapping elements, cut-off text, z-index issues | warning |
| `monkey.dead-clicks` | Dead clicks | Interactive-looking elements respond to clicks | warning |
| `monkey.slow-interactions` | Slow interactions | UI responds within threshold (default 300ms) | warning |
| `monkey.accessibility-runtime` | Runtime accessibility | Elements have labels, focus is visible, keyboard works | warning |
| `monkey.responsive-resize` | Responsive resize | Layout survives viewport resize without breaking | warning |
| `monkey.navigation-dead-ends` | Navigation dead ends | Every reachable page has a way back | warning |
| `monkey.data-loss` | Data loss | Form data survives accidental navigation | warning |
| `monkey.memory-growth` | Memory growth | No obvious memory leaks (heap grows <50% over session) | info |

### 7.2 Monkey Agent Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Monkey Agent                             │
│                                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ Explorer     │  │ Observer      │  │ Reporter            │  │
│  │              │  │               │  │                     │  │
│  │ Decides what │  │ Watches for   │  │ Collects findings   │  │
│  │ to click/do  │  │ problems      │  │ with evidence       │  │
│  │ next         │  │ after action  │  │                     │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬───────────┘  │
│         │                 │                    │               │
│  ┌──────┴─────────────────┴────────────────────┴───────────┐  │
│  │                   Action Loop                            │  │
│  │                                                          │  │
│  │  1. Explorer picks action (AI decision)                  │  │
│  │  2. Execute action via BrowserAutomation                 │  │
│  │  3. Observer checks for problems                         │  │
│  │  4. Reporter records findings                            │  │
│  │  5. Repeat until budget exhausted                        │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 7.3 Explorer — Action Selection

The explorer uses AI to decide what to do next. It maintains a mental model
of visited pages and tried interactions to avoid repetition.

```typescript
// packages/ai-test/src/runners/monkey-runner.ts

export class MonkeyRunner {
  private visitedUrls: Set<string> = new Set()
  private clickedElements: Map<string, number> = new Map()
  private findings: Finding[] = []
  private actionCount = 0

  constructor(
    private browser: BrowserAutomation,
    private ai: AIProvider,
    private screenshotProvider: ScreenshotProvider,
    private config: MonkeyConfig,
  ) {}

  async run(options: MonkeyOptions): Promise<TestResult[]> {
    await this.browser.goto(options.startUrl)
    this.visitedUrls.add(options.startUrl)

    const maxActions = options.maxActions ?? 200
    const maxDuration = options.maxDuration ?? 10 * 60 * 1000  // 10 minutes

    const startTime = Date.now()

    while (
      this.actionCount < maxActions &&
      Date.now() - startTime < maxDuration
    ) {
      await this.executeOneStep()
      this.actionCount++
    }

    return this.compileResults()
  }

  private async executeOneStep(): Promise<void> {
    // 1. Capture current state
    const screenshot = await this.browser.screenshot()
    const url = await this.browser.currentURL()
    const elements = await this.browser.getInteractiveElements()
    const consoleMessages = await this.browser.getConsoleMessages()
    const exceptions = await this.browser.getExceptions()

    // 2. Check for problems (Observer phase)
    await this.observe(screenshot, url, consoleMessages, exceptions)

    // 3. Decide next action (Explorer phase)
    const action = await this.decideNextAction(screenshot, elements, url)

    // 4. Execute action
    await this.executeAction(action)
  }

  private async decideNextAction(
    screenshot: Screenshot,
    elements: InteractiveElement[],
    currentUrl: string,
  ): Promise<MonkeyAction> {
    // First N actions: AI-guided exploration
    // Fallback: random selection from visible interactive elements
    if (this.actionCount % 5 === 0) {
      // Every 5th action: AI makes a strategic decision
      return this.aiDecideAction(screenshot, elements, currentUrl)
    }

    // Other actions: weighted random from interactive elements
    return this.randomAction(elements)
  }

  private async aiDecideAction(
    screenshot: Screenshot,
    elements: InteractiveElement[],
    currentUrl: string,
  ): Promise<MonkeyAction> {
    const elementSummary = elements
      .filter(e => e.visible && e.enabled)
      .map(e => `${e.tag}[${e.role ?? ''}] "${e.text ?? ''}" at ${e.selector}`)
      .join('\n')

    const result = await this.ai.validate({
      systemPrompt: `You are a monkey tester exploring a web application.
Your goal: find bugs, crashes, visual glitches, and UX problems.

Strategy:
- Visit pages you haven't been to yet
- Try edge cases: rapid clicking, typing special characters, resizing
- Fill forms with unusual data
- Navigate back and forth
- Try actions in unexpected order

Visited URLs: ${[...this.visitedUrls].join(', ')}
Actions so far: ${this.actionCount}
Current findings: ${this.findings.length}`,
      prompt: `Current URL: ${currentUrl}
Available interactive elements:
${elementSummary}

What should I do next? Pick ONE action.
Respond with JSON:
{
  "action": "click" | "type" | "scroll" | "navigate" | "resize" | "wait",
  "target": "selector or URL",
  "value": "text to type (if action=type)",
  "reasoning": "why this action"
}`,
      images: [{ label: 'current-page', data: screenshot.data }],
    })

    return parseMonkeyAction(result)
  }
}
```

### 7.4 Observer — Problem Detection

```typescript
private async observe(
  screenshot: Screenshot,
  url: string,
  consoleMessages: ConsoleMessage[],
  exceptions: UncaughtException[],
): Promise<void> {
  // 1. Check console errors (deterministic, no AI)
  const errors = consoleMessages.filter(m => m.type === 'error')
  for (const error of errors) {
    if (this.isExpectedError(error)) continue
    this.findings.push({
      ruleId: 'monkey.console-errors',
      severity: 'error',
      message: `Console error: ${error.text}`,
      evidence: { url, consoleMessage: error.text },
    })
  }

  // 2. Check uncaught exceptions (deterministic)
  for (const ex of exceptions) {
    this.findings.push({
      ruleId: 'monkey.crash-resistance',
      severity: 'error',
      message: `Uncaught exception: ${ex.message}`,
      evidence: { url, stack: ex.stack, screenshot: screenshot.data },
    })
  }

  // 3. Visual glitch detection (AI, periodic — every 10th step)
  if (this.actionCount % 10 === 0) {
    await this.detectVisualGlitches(screenshot, url)
  }

  // 4. Measure interaction speed (deterministic)
  // Done in executeAction wrapper — see below
}

private async detectVisualGlitches(
  screenshot: Screenshot,
  url: string,
): Promise<void> {
  const result = await this.ai.validate({
    systemPrompt: `You are a visual QA tester. Look at this screenshot and identify
any visual problems:

1. Overlapping elements (text on text, buttons on buttons)
2. Cut-off text (text that clearly continues beyond its container)
3. Z-index issues (elements appearing above/below where they should)
4. Broken layout (large empty gaps, misaligned columns)
5. Missing images (broken image icons, empty image containers)
6. Rendering artifacts (half-loaded content, flash of unstyled content)

If the page looks fine, respond with decision: "pass".
Only report actual visual problems, not design opinions.

Respond with JSON:
{
  "decision": "pass" | "fail",
  "findings": [
    { "issue": "description", "region": "where on screen", "severity": "error|warning" }
  ]
}`,
    prompt: `Page: ${url}`,
    images: [{ label: 'current-state', data: screenshot.data }],
  })

  const parsed = parseVisualGlitchResult(result)
  this.findings.push(...parsed)
}
```

### 7.5 Dead Click Detection

```typescript
private async executeAction(action: MonkeyAction): Promise<void> {
  const beforeScreenshot = await this.browser.screenshot()
  const beforeUrl = await this.browser.currentURL()

  switch (action.action) {
    case 'click': {
      const beforeBox = await this.browser.getBoundingBox(action.target)
      if (!beforeBox) {
        this.findings.push({
          ruleId: 'monkey.dead-clicks',
          severity: 'warning',
          message: `Element not found: ${action.target}`,
        })
        return
      }

      // Measure interaction response time
      const measurement = await this.browser.measureInteraction(
        () => this.browser.click(action.target),
        action.target,
      )

      if (measurement.durationMs > this.config.slowInteractionThreshold) {
        this.findings.push({
          ruleId: 'monkey.slow-interactions',
          severity: 'warning',
          message: `Slow interaction: ${measurement.durationMs}ms on ${action.target}`,
        })
      }

      // Check if anything changed (dead click detection)
      const afterScreenshot = await this.browser.screenshot()
      const afterUrl = await this.browser.currentURL()

      if (afterUrl === beforeUrl) {
        // URL didn't change — check if DOM changed
        const pixelDiff = quickPixelDiff(beforeScreenshot, afterScreenshot)
        if (pixelDiff < 0.001) {
          // Nothing visible changed — might be a dead click
          const element = await this.browser.getBoundingBox(action.target)
          if (element && looksInteractive(action.target)) {
            this.findings.push({
              ruleId: 'monkey.dead-clicks',
              severity: 'warning',
              message: `Dead click: ${action.target} looks interactive but nothing happened`,
              evidence: { screenshot: beforeScreenshot.data },
            })
          }
        }
      }
      break
    }
    case 'type':
      await this.browser.type(action.target, action.value ?? '')
      break
    case 'scroll':
      await this.browser.scroll(action.target)
      break
    case 'navigate':
      await this.browser.goto(action.target)
      this.visitedUrls.add(action.target)
      break
    case 'resize':
      const [w, h] = (action.value ?? '375,812').split(',').map(Number)
      await this.browser.setViewport(w, h)
      break
  }
}
```

### 7.6 Monkey Session Configuration

```typescript
export interface MonkeyOptions {
  /** Starting URL */
  startUrl: string
  /** Maximum number of actions */
  maxActions?: number                   // default: 200
  /** Maximum session duration (ms) */
  maxDuration?: number                  // default: 600000 (10 min)
  /** URL patterns to stay within */
  allowedPatterns?: string[]            // default: ['/**']
  /** URL patterns to avoid (logout, delete, etc.) */
  denyPatterns?: string[]               // default: ['/logout', '/delete*']
  /** Slow interaction threshold (ms) */
  slowInteractionThreshold?: number     // default: 300
  /** Run with multiple viewports */
  viewports?: Breakpoint[]
  /** Console errors to ignore (patterns) */
  ignoreConsoleErrors?: string[]
  /** Authentication config */
  auth?: {
    loginUrl: string
    credentials: { username: string; password: string }
    /** Or inject auth cookie/token directly */
    cookies?: Array<{ name: string; value: string; domain: string }>
  }
}
```

### 7.7 Monkey Test Data Integration

```typescript
async function monkeyWithMockData(
  browser: BrowserAutomation,
  dataProvider: DataProvider,
  config: MonkeyOptions,
): Promise<void> {
  // 1. Configure mock server to return specific scenarios
  const scenarios = await dataProvider.listScenarios()

  // 2. Start with happy-path data
  await dataProvider.getData({ name: 'happy-path', description: '', category: 'happy-path' })

  // 3. Mid-session: switch to edge case data
  // The mock server rotates scenarios to expose the UI to varied data
  const edgeCaseScenarios = scenarios.filter(s => s.category === 'edge-case')
  for (const scenario of edgeCaseScenarios) {
    await dataProvider.getData(scenario)
    // Give the monkey 20 actions with this data scenario
    // ... continue monkey loop
  }
}
```

---

## 8. Self-Improving Decision Templates

AI Test Runner reuses DS Core's template infrastructure (`DecisionTemplate`, `TemplateStore`,
Template Match DSL). For the foundational architecture, prior art, and design decisions, see:
- **Template types & DSL**: `2026-04-01-ds-core-design.md` Section 5, 13
- **Research & architectural decisions**: `2026-04-01-self-improving-templates-research.md`

This section describes AI Test Runner-specific template behavior.

### 8.1 Template Types for AI Tests

Each test mode produces its own kind of template candidate:

| Source | Template kind | Example |
|--------|--------------|---------|
| Snapshot tests | Visual assertion | "Header height ≥ 60px at mobile breakpoint" |
| Spec-based tests | DOM assertion | "Login page has input[type=email] and input[type=password]" |
| Spec-based tests | Content assertion | "Error message contains 'try again' or 'contact support'" |
| Monkey tests | Stability assertion | "Clicking rapid-fire on save button does not produce console errors" |
| Monkey tests | Layout assertion | "Sidebar does not overlap main content at 768px" |

### 8.2 Template Generation from Test Results

When an AI-validated test result has confidence ≥ 0.85, the runner asks the AI
to convert it into a deterministic assertion (no AI needed on subsequent runs).

```typescript
// packages/ai-test/src/templates/test-template-generator.ts

export async function generateTestTemplate(
  result: TestResult,
  context: TestContext,
  ai: AIProvider,
): Promise<CandidateTemplate | null> {
  if (result.confidence === undefined || result.confidence < 0.85) return null
  if (result.validatedBy === 'template') return null  // Already a template

  // AI converts the test decision into a reusable assertion.
  // Assertion types specific to visual testing:
  //   dom-exists, dom-text-contains, css-value, element-size,
  //   element-visible, no-overlap, console-clean
  const response = await ai.validate({
    systemPrompt: CONVERT_TO_ASSERTION_PROMPT(result),
    prompt: `Test context:\n${JSON.stringify(context, null, 2)}`,
  })

  return parseCandidateTemplate(response)
}
```

### 8.3 Template Assertion Execution

Templates are executed against a live browser + DOM snapshot.
Each assertion type maps to a concrete check — no AI involved.

```typescript
// packages/ai-test/src/templates/test-template-matcher.ts

export async function executeTemplateAssertion(
  template: DecisionTemplate,
  browser: BrowserAutomation,
  dom: DOMSnapshot,
): Promise<TestResult> {
  const assertion = template.assertion

  switch (assertion.type) {
    case 'dom-exists':        // querySelector presence in DOM
    case 'dom-text-contains': // text content match within selector
    case 'element-size':      // bounding-box width/height vs threshold
    case 'css-value':         // computed style property comparison
    case 'console-clean':     // zero console errors during interaction
    case 'no-overlap':        // two elements' bounding boxes don't intersect
    case 'element-visible':   // element in viewport and not hidden
      // Each case returns { status, message, validatedBy: 'template', templateId }
  }
}
```

### 8.4 Template Promotion to DS Core

When a test template is generic enough (not product-specific), it can be
promoted to a DS Core rule. This cross-package flow is owned by ai-test.

```
AI Test template (product-specific)
    ↓
High apply count + crosses multiple components?
    ↓ Yes
Review: is this a universal design rule or product-specific?
    ↓ Universal
Promote to DS Core custom rule
    ↓
Template moves from ai-test.templates → ds-core.templates
```

Promotion criteria:
- Template applied ≥ 50 times across the project
- Matches components in ≥ 3 different pages/routes
- Manual review confirms the rule is design-system-level, not product-specific

Example promotion chain:
1. Monkey test finds: "Sidebar overlaps main content at 768px in 3 different pages"
2. Template generated: `no-overlap` assertion for sidebar + main at tablet breakpoint
3. After 50 applies across project → reviewer promotes to DS Core:
   `patterns.components.sidebar-responsive-breakpoint: 'error'`

---

## 9. Integration with DS Core

### 9.1 Shared Interfaces

| Interface | Defined in | Used by both? | Purpose |
|-----------|-----------|---------------|---------|
| `AIProvider` | `ds-core/types/adapters.ts` | Yes | AI calls for validation/generation |
| `TemplateStore` | `ds-core/types/adapters.ts` | Yes | Template persistence + retrieval |
| `DecisionTemplate` | `ds-core/types/template.ts` | Yes | Template structure |
| `DesignToken` | `ds-core/types/state.ts` | Read by AI Tests | Token definitions |
| `Violation` | `ds-core/types/state.ts` | Read by AI Tests | DS Core violation data |
| `RuleConfig` (severity format) | `ds-core/types/rule.ts` | Yes | `'error'` / `['warning', {...}]` / `'off'` |

### 9.2 Token Inheritance

AI Tests read DS Core's resolved tokens as baseline knowledge:

```typescript
// packages/ai-test/src/context/ds-core-context.ts

export class DSCoreContext {
  constructor(private dsProvider: DesignSystemProvider) {}

  /**
   * Build a compact token summary for AI prompts.
   * The AI uses this to understand "known good" design values.
   */
  async getTokenSummary(): Promise<string> {
    const tokens = await this.dsProvider.getTokens()

    const summary = {
      colors: tokens
        .filter(t => t.category === 'color')
        .map(t => `${t.name}: ${t.value}`),
      typography: tokens
        .filter(t => t.category === 'typography')
        .map(t => `${t.name}: ${t.value}`),
      spacing: tokens
        .filter(t => t.category === 'spacing')
        .map(t => `${t.name}: ${t.value}`),
    }

    return JSON.stringify(summary, null, 2)
  }

  /**
   * Inject token knowledge into AI prompts for visual comparison.
   * Helps AI distinguish "intentional design change" from "token drift."
   */
  async enrichComparisonContext(
    context: ComparisonContext,
  ): Promise<ComparisonContext> {
    const tokens = await this.dsProvider.getTokens()
    return {
      ...context,
      designTokens: tokens,
      tokenSummary: await this.getTokenSummary(),
    }
  }
}
```

### 9.3 Violation-Triggered Tests

DS Core violations can trigger focused AI Tests:

```typescript
async function triggerTestsFromViolations(
  violations: Violation[],
  testRunner: AITestRunner,
): Promise<TestReport> {
  // Group violations by file/component
  const grouped = groupBy(violations, v => v.location.filePath)

  const results: TestResult[] = []

  for (const [filePath, fileViolations] of grouped) {
    // If many hardcoded colors in a component → run visual regression
    // to verify fixes don't break appearance
    const hardcodedColors = fileViolations.filter(v =>
      v.ruleId === 'color.no-hardcoded'
    )
    if (hardcodedColors.length > 5) {
      const componentResults = await testRunner.runPage(filePath)
      results.push(...componentResults.results)
    }

    // If a11y violations → run focused accessibility test
    const a11yViolations = fileViolations.filter(v =>
      v.section === 'accessibility'
    )
    if (a11yViolations.length > 0) {
      // Run monkey test focused on the affected page
      // with accessibility-focused observer
    }
  }

  return compileReport(results)
}
```

### 9.4 Shared Config Location

Both configs live side-by-side:

```
.hyperide/
  ds.config.ts              -- DS Core configuration (Level 1)
  ai-test.config.ts         -- AI Test configuration (Level 2-3)
  ai-test/
    baselines/              -- Baseline screenshots
      login/
        mobile-light.png
        mobile-dark.png
        desktop-light.png
        desktop-dark.png
      dashboard/
        ...
    templates/              -- AI Test decision templates
      snapshot-templates.json
      spec-templates.json
      monkey-templates.json
```

---

## 10. Integration with Component Stage

Component Stage (`packages/component-stage`) provides isolated, controlled
rendering of components. AI Tests consume this to iterate over component
variants systematically.

### 10.1 Component Discovery

```typescript
// packages/ai-test/src/adapters/component/stage-component.ts

export class StageComponentProvider implements ComponentProvider {
  constructor(private stageUrl: string) {}

  async listComponents(): Promise<ComponentEntry[]> {
    const response = await fetch(`${this.stageUrl}/api/components`)
    return response.json()
  }

  async getComponentURL(
    name: string,
    props?: Record<string, unknown>,
  ): Promise<string> {
    const encoded = encodeURIComponent(JSON.stringify(props ?? {}))
    return `${this.stageUrl}/render/${name}?props=${encoded}`
  }

  async getVariants(name: string): Promise<ComponentVariant[]> {
    const response = await fetch(`${this.stageUrl}/api/components/${name}/variants`)
    const variants = await response.json()
    return variants.map((v: ComponentVariant) => ({
      ...v,
      url: `${this.stageUrl}/render/${name}?variant=${v.name}`,
    }))
  }

  async getPropTypes(name: string): Promise<PropTypeInfo> {
    const response = await fetch(`${this.stageUrl}/api/components/${name}/props`)
    return response.json()
  }
}
```

### 10.2 Automatic Test Fixture Generation

Component Stage "examples" become test fixtures automatically:

```typescript
async function generateComponentTests(
  componentProvider: ComponentProvider,
  screenshotProvider: ScreenshotProvider,
  breakpoints: Breakpoint[],
): Promise<TestCase[]> {
  const components = await componentProvider.listComponents()
  const testCases: TestCase[] = []

  for (const component of components) {
    const variants = await componentProvider.getVariants(component.name)

    for (const variant of variants) {
      // Each variant × breakpoint × theme = one test case
      for (const bp of breakpoints) {
        for (const theme of ['light', 'dark'] as const) {
          testCases.push({
            id: `${component.name}/${variant.name}/${bp.name}/${theme}`,
            ruleId: 'snapshot.component-variants',
            target: {
              type: 'component',
              name: `${component.name}:${variant.name}`,
              url: variant.url,
              breakpoint: bp.name,
              theme,
            },
          })
        }
      }
    }
  }

  return testCases
}
```

### 10.3 Prop Combination Testing

For components with enumerable props, AI Tests can generate exhaustive
prop combinations and test each:

```typescript
async function testPropCombinations(
  componentName: string,
  componentProvider: ComponentProvider,
  screenshotProvider: ScreenshotProvider,
  ai: AIProvider,
  config: { maxVariants: number },
): Promise<TestResult[]> {
  const propTypes = await componentProvider.getPropTypes(componentName)
  const combinations = generatePropCombinations(propTypes, config.maxVariants)
  const results: TestResult[] = []

  for (const props of combinations) {
    const url = await componentProvider.getComponentURL(componentName, props)
    const screenshot = await screenshotProvider.capturePage(url)

    // Check for rendering issues
    const result = await ai.validate({
      systemPrompt: `You are testing a UI component with specific props.
Component: ${componentName}
Props: ${JSON.stringify(props)}

Check that the component:
1. Renders without visual errors
2. Shows content matching the provided props
3. Has proper layout (no overflow, no collapse)
4. Handles the prop combination gracefully

Respond with JSON:
{
  "decision": "pass" | "fail",
  "confidence": 0.0-1.0,
  "findings": [{ "issue": "description", "severity": "error|warning" }]
}`,
      prompt: `Component: ${componentName}`,
      images: [{ label: 'rendered', data: screenshot.data }],
    })

    results.push(parseTestResult(result, {
      ruleId: 'snapshot.component-variants',
      target: { type: 'component', name: componentName },
    }))
  }

  return results
}

function generatePropCombinations(
  propTypes: PropTypeInfo,
  maxVariants: number,
): Record<string, unknown>[] {
  // For each enum/boolean prop: enumerate all values
  // For string/number props: sample representative values
  // Cartesian product, capped at maxVariants
  // Prioritize: boolean toggles × enum values × size variants
  const combinations: Record<string, unknown>[] = []

  // ... combinatorial generation logic
  // Uses pair-wise testing to reduce combinations while maintaining coverage

  return combinations.slice(0, maxVariants)
}
```

---

## 11. Integration with Smart Mock Server

Smart Mock Server (`packages/mock-server`) provides realistic, PII-masked
data. AI Tests use it for edge case scenarios and monkey test data.

### 11.1 Data Scenarios

```typescript
// packages/ai-test/src/adapters/data/mock-server-data.ts

export class MockServerDataProvider implements DataProvider {
  constructor(private mockServerUrl: string) {}

  async getData(scenario: DataScenario): Promise<MockData> {
    const response = await fetch(
      `${this.mockServerUrl}/api/scenario/${scenario.name}`,
    )
    return response.json()
  }

  async listScenarios(): Promise<DataScenario[]> {
    const response = await fetch(`${this.mockServerUrl}/api/scenarios`)
    return response.json()
  }

  async generateEdgeCases(schema: DataSchema): Promise<MockData[]> {
    const response = await fetch(`${this.mockServerUrl}/api/edge-cases`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schema }),
    })
    return response.json()
  }
}
```

### 11.2 Built-in Edge Case Scenarios

| Scenario | Category | What it tests |
|----------|----------|--------------|
| `empty-list` | edge-case | Empty arrays, null collections — tests empty state UI |
| `single-item` | edge-case | Only one item in lists — tests singular/plural, layout with few items |
| `many-items` | stress | 100+ items — tests pagination, scroll performance, memory |
| `long-strings` | edge-case | 200+ character strings — tests text overflow, truncation |
| `unicode-heavy` | edge-case | Emoji, RTL text, CJK characters — tests encoding, layout direction |
| `null-fields` | edge-case | Null/undefined optional fields — tests null safety |
| `zero-values` | edge-case | Numeric zeros — tests "0 vs empty" display |
| `negative-values` | edge-case | Negative numbers — tests formatting, charts, calculations |
| `large-numbers` | edge-case | Very large numbers — tests formatting, overflow |
| `html-injection` | error | HTML/script tags in data — tests XSS prevention display |
| `slow-response` | error | Delayed API responses — tests loading state timeout |
| `error-response` | error | 4xx/5xx API responses — tests error handling |
| `mixed-content` | happy-path | Realistic variety — tests normal operation |
| `pii-masked` | happy-path | Realistic data with PII masked — tests production-like conditions |

### 11.3 Mock Server Scenario Rotation in Monkey Tests

```typescript
async function monkeyWithScenarioRotation(
  runner: MonkeyRunner,
  dataProvider: DataProvider,
  config: MonkeyOptions,
): Promise<TestResult[]> {
  const scenarios = await dataProvider.listScenarios()
  const allResults: TestResult[] = []

  // Phase 1: Happy path (40% of budget)
  await dataProvider.getData({ name: 'mixed-content', description: '', category: 'happy-path' })
  const happyResults = await runner.run({
    ...config,
    maxActions: Math.floor(config.maxActions * 0.4),
  })
  allResults.push(...happyResults)

  // Phase 2: Edge cases (40% of budget, rotating scenarios)
  const edgeCases = scenarios.filter(s => s.category === 'edge-case')
  const actionsPerScenario = Math.floor(
    (config.maxActions * 0.4) / edgeCases.length,
  )
  for (const scenario of edgeCases) {
    await dataProvider.getData(scenario)
    const results = await runner.run({
      ...config,
      maxActions: actionsPerScenario,
    })
    allResults.push(...results)
  }

  // Phase 3: Error scenarios (20% of budget)
  const errorScenarios = scenarios.filter(s => s.category === 'error')
  for (const scenario of errorScenarios) {
    await dataProvider.getData(scenario)
    const results = await runner.run({
      ...config,
      maxActions: Math.floor(config.maxActions * 0.2 / errorScenarios.length),
    })
    allResults.push(...results)
  }

  return allResults
}
```

---

## 12. Surfaces

### 12.1 SDK (Programmatic)

```typescript
import { AITestRunner } from '@hyperide/ai-test'
import { PlaywrightScreenshot } from '@hyperide/ai-test/adapters/screenshot/playwright'
import { PlaywrightDOM } from '@hyperide/ai-test/adapters/dom/playwright'
import { PlaywrightBrowser } from '@hyperide/ai-test/adapters/browser/playwright'
import { AnthropicAIAdapter } from '@hyperide/ds-core/adapters/anthropic-ai-adapter'
import { StageComponentProvider } from '@hyperide/ai-test/adapters/component/stage-component'
import { MockServerDataProvider } from '@hyperide/ai-test/adapters/data/mock-server-data'

const runner = new AITestRunner({ configPath: '.hyperide/ai-test.config.ts' })

// Wire up adapters
runner.registerScreenshotProvider(new PlaywrightScreenshot())
runner.registerDOMProvider(new PlaywrightDOM())
runner.registerBrowserAutomation(new PlaywrightBrowser())
runner.registerAIProvider(new AnthropicAIAdapter({ apiKey: process.env.ANTHROPIC_API_KEY }))
runner.registerComponentProvider(new StageComponentProvider('http://localhost:6100'))
runner.registerDataProvider(new MockServerDataProvider('http://localhost:6200'))

// Run all tests
const report = await runner.run()
console.log(`${report.summary.passed}/${report.summary.total} passed`)

// Run specific categories
const snapshotReport = await runner.runSnapshots()
const specReport = await runner.runSpecs()
const monkeyReport = await runner.runMonkey({
  startUrl: 'http://localhost:3000',
  maxActions: 100,
})
```

### 12.2 CLI

```bash
# Run all enabled tests
ai-test run

# Run specific test category
ai-test run --snapshot
ai-test run --spec
ai-test run --monkey

# Run tests for a specific page
ai-test run --page /login

# Run tests for a specific component
ai-test run --component Button

# Update baseline snapshots
ai-test update-baselines
ai-test update-baselines --page /login

# Show current test status (baselines, template counts)
ai-test status

# Manage templates
ai-test templates list
ai-test templates approve <id>
ai-test templates reject <id>
ai-test templates promote <id>              # Promote to DS Core

# Initialize config
ai-test init

# Run monkey test with custom options
ai-test monkey --url https://staging.myapp.com --actions 500 --duration 30m

# Show last report
ai-test report
ai-test report --html --open
```

### 12.3 MCP Tools

```typescript
// Exposed as MCP tools for AI agents

/** Run AI tests for a page or component */
hyper_ai_test_run({ target?: string, category?: 'snapshot' | 'spec' | 'monkey' })

/** Get the latest test report */
hyper_ai_test_report({ format?: 'summary' | 'full' })

/** Compare current UI against Figma design */
hyper_ai_test_compare_figma({ pageUrl: string, figmaPage: string })

/** Run monkey test on a URL */
hyper_ai_test_monkey({ url: string, maxActions?: number })

/** Get test status (baselines, templates, last run) */
hyper_ai_test_status()

/** Update baselines for specific pages */
hyper_ai_test_update_baselines({ pages?: string[] })

/** Get test template suggestions */
hyper_ai_test_templates({ action: 'list' | 'approve' | 'reject', id?: string })
```

### 12.4 CI Integration

```yaml
# .github/workflows/ai-test.yml

name: AI Tests
on:
  pull_request:
    branches: [main, develop]
  schedule:
    # Nightly monkey tests
    - cron: '0 3 * * *'

jobs:
  snapshot-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run dev &
      - run: npx ai-test run --snapshot --ci
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: snapshot-diffs
          path: .hyperide/ai-test/diffs/

  spec-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run dev &
      - run: npx ai-test run --spec --ci

  monkey-tests:
    runs-on: ubuntu-latest
    if: github.event_name == 'schedule'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run build && npm run start &
      - run: npx ai-test run --monkey --url http://localhost:3000 --actions 500
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: monkey-findings
          path: .hyperide/ai-test/reports/
```

### 12.5 HyperCanvas UI Consumer

Not in `packages/ai-test` — lives in `client/` as a consumer:

- **Test Results Panel** — shows latest test report inline, grouped by
  page/component, with pass/fail badges
- **Screenshot Comparison** — side-by-side viewer for baseline vs current,
  with diff overlay toggle
- **Monkey Replay** — step-by-step replay of monkey session with findings
  highlighted at each step
- **Template Approval UI** — shared with DS Core's template approval
  (same queue, filtered by source)

---

## 13. Reporters

### 13.1 Console Reporter

```
AI Test Report — 2026-04-01T15:30:00Z
═══════════════════════════════════════

Snapshots  ✓ 42 passed  ✗ 3 failed  ⊘ 2 skipped
Spec       ✓ 18 passed  ✗ 1 failed  ⊘ 4 skipped
Monkey     ✓ — passed   ✗ 5 findings

Failures:
─────────

✗ snapshot.visual-regression — Login (mobile, dark)
  Regression: form container shifted 12px left, submit button partially cut off
  Baseline: .hyperide/ai-test/baselines/login/mobile-dark.png
  Actual:   .hyperide/ai-test/diffs/login/mobile-dark-actual.png
  Diff:     .hyperide/ai-test/diffs/login/mobile-dark-diff.png

✗ snapshot.responsive-breakpoints — Dashboard (tablet)
  Sidebar overlaps main content area at 768px
  Confidence: 0.94

✗ snapshot.dark-mode-parity — Settings
  Missing dark mode: .settings-card background is still #FFFFFF
  Confidence: 0.97

✗ spec.matches-spec — Login
  Spec: "Login form shows 'Forgot password?' link below password field"
  Actual: No 'Forgot password?' link found in DOM
  Confidence: 0.99

Monkey Findings:
────────────────

✗ monkey.console-errors — /dashboard (action #47)
  Console error: "TypeError: Cannot read property 'name' of undefined"
  URL: /dashboard?tab=analytics

✗ monkey.dead-clicks — /settings (action #112)
  "Save" button clicked but no visible response
  Element: button.save-btn

✗ monkey.visual-glitches — /projects (action #78)
  Tooltip text overlaps adjacent column at 1024px
  Region: center-right

✗ monkey.slow-interactions — /projects/123 (action #156)
  Delete confirmation dialog took 847ms to appear
  Threshold: 300ms

✗ monkey.console-errors — /projects/123/files (action #183)
  Console error: "Warning: Each child in a list should have a unique key prop"

───────────────────────
Duration: 4m 32s
AI calls: 67
Screenshots captured: 94
Templates applied: 12
New templates generated: 3 (pending approval)
```

### 13.2 HTML Reporter

Generates an interactive HTML report with:

- Side-by-side screenshot comparison (baseline / actual / diff overlay)
- Filterable test list by category, severity, status
- Monkey test timeline with screenshot at each action
- Template approval inline (approve/reject buttons → call API)
- Spec excerpt display alongside each spec-based test result

### 13.3 CI Reporter

Outputs GitHub Actions annotations:

```typescript
function formatCIAnnotation(result: TestResult): string {
  if (result.status === 'pass') return ''

  const level = result.severity === 'error' ? 'error' : 'warning'
  const file = result.target.url ?? result.target.name

  return `::${level} file=${file},title=${result.ruleId}::${result.message}`
}
```

---

## 14. AI Rate Limiting and Cost Control

```typescript
interface AITestLimits {
  /** Max AI calls per full test run */
  maxCallsPerRun: number                // default: 100

  /** Max AI calls for snapshot tests specifically */
  maxSnapshotAICalls: number            // default: 50

  /** Max AI calls per monkey session */
  maxMonkeyAICalls: number              // default: 30

  /** Max AI calls per spec test session */
  maxSpecAICalls: number                // default: 40

  /** Daily budget cap */
  dailyBudget: number                   // default: 500

  /** Skip AI if template covers the case */
  useTemplatesFirst: boolean            // default: true

  /** Pixel diff threshold before invoking AI (snapshot tests) */
  pixelDiffThreshold: number            // default: 0.01 (1%)

  /** Model for quick validation */
  validationModel: string               // default: haiku

  /** Model for complex analysis (spec parsing, monkey reasoning) */
  analysisModel: string                 // default: sonnet
}
```

**Cost optimization strategy:**

1. **Pixel diff as pre-filter** — screenshots with <1% pixel diff skip AI entirely
2. **Templates first** — check deterministic templates before calling AI
3. **Batched AI calls** — group multiple screenshots into one AI call when possible
4. **Haiku for validation, Sonnet for reasoning** — cheap model for yes/no, smart model for analysis
5. **Monkey AI frequency** — AI makes strategic decisions every 5th action, random rest
6. **Budget exhaustion** — when budget runs out, skip AI-only tests with a warning

---

## 15. Cross-Reference Map

### 15.1 What AI Tests Shares with DS Core

| Shared element | Location | How shared |
|----------------|----------|-----------|
| `AIProvider` interface | `ds-core/types/adapters.ts` | Re-exported, same adapters work for both |
| `TemplateStore` interface | `ds-core/types/adapters.ts` | Shared store, templates tagged by source |
| `DecisionTemplate` schema | `ds-core/types/template.ts` | Extended with test-specific assertion types |
| Template DSL | `ds-core/templates/` | Same expression language for match conditions |
| Config severity format | `'error' / ['warning', {...}] / 'off'` | Identical pattern for familiarity |
| `AnthropicAIAdapter` | `ds-core/adapters/` | Same adapter instance can serve both |
| `HyperCanvasAIAdapter` | `ds-core/adapters/` | Same adapter instance can serve both |
| Config location | `.hyperide/` | Side-by-side: `ds.config.ts` + `ai-test.config.ts` |
| Token data | `ds-core → DesiredState` | AI Tests reads via `DesignSystemProvider` |
| Violation triggers | `ds-core → ReconciliationReport` | DS Core violations can trigger focused AI Tests |

### 15.2 What AI Tests Shares with Component Stage

| Shared element | Location | How shared |
|----------------|----------|-----------|
| Component list | `component-stage/api/components` | AI Tests discovers components via API |
| Variant definitions | `component-stage/api/components/:name/variants` | Variants become test fixtures automatically |
| Prop type info | `component-stage/api/components/:name/props` | Used for prop combination generation |
| Render URLs | `component-stage/render/:name` | Screenshot capture targets |
| Examples/stories | Component Stage configuration | Each example = one test case |

### 15.3 What AI Tests Shares with Smart Mock Server

| Shared element | Location | How shared |
|----------------|----------|-----------|
| Scenario definitions | `mock-server/api/scenarios` | AI Tests selects scenarios for edge case testing |
| Edge case generation | `mock-server/api/edge-cases` | AI Tests sends prop schemas, gets edge case data |
| PII masking | Mock Server internal | All data served to AI Tests is already masked |
| Scenario rotation | Mock Server API | Monkey tests rotate through scenarios via API |

### 15.4 Quality Level Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Quality Pipeline                              │
│                                                                      │
│  Level 1: DS Core                                                    │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ • Static code analysis (no browser needed)                    │   │
│  │ • Token validation: contrast, spacing, typography, colors     │   │
│  │ • Pattern validation: a11y, navigation, state, components     │   │
│  │ • Intent validation: tone-of-voice, design quality            │   │
│  │ • Speed: ~seconds (pre-commit)                                │   │
│  │ • Rules: 151 universal rules                                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              ↓                                       │
│  Level 2: AI Tests — Snapshot + Spec                                │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ • Screenshot comparison against Figma/baselines               │   │
│  │ • Spec-to-UI verification (requirements → implementation)     │   │
│  │ • Component variant testing (via Component Stage)             │   │
│  │ • Edge case testing (via Mock Server)                         │   │
│  │ • Responsive, dark mode, loading/error state testing          │   │
│  │ • Speed: ~minutes (CI pipeline)                               │   │
│  │ • Rules: product-specific, configured per project             │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              ↓                                       │
│  Level 3: AI Tests — Monkey                                         │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ • Unscripted browser exploration                              │   │
│  │ • Crash resistance, console errors, visual glitches           │   │
│  │ • Dead clicks, slow interactions, dead-end navigation         │   │
│  │ • Realistic data scenarios (via Mock Server)                  │   │
│  │ • No predetermined test cases — AI decides what to try        │   │
│  │ • Speed: ~10min sessions (nightly/staging)                    │   │
│  │ • Findings: emergent, unpredictable                           │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

Data flow:
  DS Core tokens ──────→ AI Tests (baseline knowledge)
  DS Core violations ──→ AI Tests (trigger focused tests)
  Component Stage ─────→ AI Tests (component instances + variants)
  Mock Server ─────────→ AI Tests (realistic data + edge cases)
  AI Tests templates ──→ DS Core (promote universal findings to rules)
```

---

## 16. Runner Orchestration

The orchestrator coordinates all three runners, manages dependencies,
and respects the AI call budget.

```typescript
// packages/ai-test/src/runners/runner-orchestrator.ts

export class RunnerOrchestrator {
  private snapshotRunner: SnapshotRunner
  private specRunner: SpecRunner
  private monkeyRunner: MonkeyRunner
  private budget: AIBudgetTracker

  constructor(
    private config: AITestConfig,
    adapters: RegisteredAdapters,
  ) {
    this.budget = new AIBudgetTracker(config.ai)
    this.snapshotRunner = new SnapshotRunner(adapters, this.budget)
    this.specRunner = new SpecRunner(adapters, this.budget)
    this.monkeyRunner = new MonkeyRunner(adapters, this.budget)
  }

  async runAll(): Promise<TestReport> {
    const results: TestResult[] = []
    const startedAt = new Date().toISOString()

    // Phase 1: Snapshot tests (parallel per page)
    if (this.hasEnabled('snapshot')) {
      const snapshotResults = await this.snapshotRunner.runAll()
      results.push(...snapshotResults)
    }

    // Phase 2: Spec-based tests (sequential — each test may need browser)
    if (this.hasEnabled('spec')) {
      const specResults = await this.specRunner.runAll()
      results.push(...specResults)
    }

    // Phase 3: Monkey tests (sequential — single browser session)
    if (this.hasEnabled('monkey')) {
      const monkeyResults = await this.monkeyRunner.run({
        startUrl: this.config.stagingUrl ?? this.config.baseUrl,
        maxActions: 200,
      })
      results.push(...monkeyResults)
    }

    return compileReport(results, startedAt, this.budget.getStats())
  }

  private hasEnabled(category: 'snapshot' | 'spec' | 'monkey'): boolean {
    const tests = this.config.tests[category]
    return Object.values(tests).some(v => {
      const severity = Array.isArray(v) ? v[0] : v
      return severity !== 'off'
    })
  }
}
```

### AI Budget Tracker

```typescript
export class AIBudgetTracker {
  private calls = 0
  private callsByCategory = { snapshot: 0, spec: 0, monkey: 0 }

  constructor(private limits: AITestLimits) {}

  canCall(category: 'snapshot' | 'spec' | 'monkey'): boolean {
    if (this.calls >= this.limits.maxCallsPerRun) return false
    switch (category) {
      case 'snapshot': return this.callsByCategory.snapshot < this.limits.maxSnapshotAICalls
      case 'spec': return this.callsByCategory.spec < this.limits.maxSpecAICalls
      case 'monkey': return this.callsByCategory.monkey < this.limits.maxMonkeyAICalls
    }
  }

  recordCall(category: 'snapshot' | 'spec' | 'monkey'): void {
    this.calls++
    this.callsByCategory[category]++
  }

  getStats(): BudgetStats {
    return {
      totalCalls: this.calls,
      remaining: this.limits.maxCallsPerRun - this.calls,
      byCategory: { ...this.callsByCategory },
    }
  }
}
```

---

## 17. Error Handling and Resilience

### 17.1 Test Isolation

Each test case runs in isolation. A failure in one test does not affect
others:

```typescript
async function runTestSafe(
  testCase: TestCase,
  runner: TestRunner,
): Promise<TestResult> {
  try {
    return await runner.execute(testCase)
  } catch (error) {
    return {
      id: testCase.id,
      ruleId: testCase.ruleId,
      status: 'error',
      severity: 'error',
      message: `Test execution failed: ${error instanceof Error ? error.message : String(error)}`,
      validatedBy: 'pixel-diff',       // No AI was involved
      duration: 0,
      target: testCase.target,
    }
  }
}
```

### 17.2 Browser Recovery

```typescript
async function withBrowserRecovery<T>(
  browser: BrowserAutomation,
  action: () => Promise<T>,
  fallbackUrl: string,
): Promise<T> {
  try {
    return await action()
  } catch (error) {
    // Browser crashed or page unresponsive — navigate to fallback
    try {
      await browser.goto(fallbackUrl)
    } catch {
      // Browser completely dead — needs restart
      throw new BrowserCrashError('Browser unrecoverable', { cause: error })
    }
    throw error
  }
}
```

### 17.3 AI Fallback

When AI provider is unavailable or budget exhausted:

- Snapshot tests → fall back to pure pixel diff (no semantic understanding)
- Spec tests → skip with status `'skip'` and reason `'AI unavailable'`
- Monkey tests → fall back to random clicking without AI strategic decisions

---

## 18. Prior Art

### Visual Regression Testing

| Tool | Approach | Limitation |
|------|----------|-----------|
| Percy (BrowserStack) | Pixel diff + manual review | No semantic understanding, every diff needs human |
| Chromatic (Storybook) | Component-level pixel diff | Storybook-only, no page-level or behavior tests |
| Applitools Eyes | Visual AI for grouping diffs | Closed source, no spec-based testing, no monkey |
| BackstopJS | Pixel diff with configurable selectors | No AI, no semantic comparison |
| reg-suit | Image regression in CI | Pixel diff only |

AI Tests improves on all of these by combining AI-powered visual understanding
with spec-based validation and unscripted exploration.

### Monkey Testing / Fuzzing

| Tool | Approach | Limitation |
|------|----------|-----------|
| Gremlins.js | Random DOM events in browser | No intelligence, no visual checking, no reporting |
| Android Monkey | Random touch events on Android | Platform-specific, no AI analysis |
| Waldo.ai | AI-powered mobile testing | Mobile-only, closed source |
| Meticulous.ai | Record + replay with visual diff | Replay-based, not exploratory |

AI Tests combines AI exploration strategy with DOM analysis, console
monitoring, and visual glitch detection.

### Spec-to-Test

| Tool | Approach | Limitation |
|------|----------|-----------|
| Cucumber/Gherkin | Human-written BDD specs → test steps | Manual step definitions, no AI |
| TestRigor | English-language test scripts | Deterministic scripts, not AI reasoning |
| Functionize | AI-powered test creation | Closed source, limited to recorded flows |

AI Tests is the first to directly validate UI against free-form product specs
(markdown, Figma, Linear tickets) without requiring structured test scripts.

---

## Appendix A: Feature Summary

- **Package**: `packages/ai-test` — standalone, depends only on DS Core types
- **Config**: `.hyperide/ai-test.config.ts` with biome-style rule severity format
- **Three test levels**: snapshot (L2), spec-based (L2), monkey (L3)
- **Snapshot tests**: visual regression, responsive breakpoints, dark mode parity, component variants, animation keyframes, empty/loading/error states — 10 rules
- **Spec-based tests**: Figma comparison, spec requirement validation, edge case testing, form validation, navigation flow verification — 10 rules
- **Monkey tests**: crash resistance, console errors, visual glitches, dead clicks, slow interactions, accessibility, responsive resize, navigation dead ends, data loss, memory growth — 10 rules
- **Total**: 30 test rules across three categories
- **DI adapters**: ScreenshotProvider, DOMSnapshotProvider, SpecProvider, ComponentProvider, DataProvider, AIProvider (shared with DS Core), DesignSystemProvider, BrowserAutomation
- **Screenshot adapters**: Playwright, CDP, HyperCanvas preview
- **Spec adapters**: Markdown files, Notion API, Linear tickets, Figma annotations
- **AI adapters**: Reuses DS Core's (Anthropic, OpenAI, HyperCanvas)
- **Self-improving templates**: AI decisions → deterministic assertions, shared template store with DS Core, template promotion to DS Core rules
- **DS Core integration**: inherits tokens, reads violations, triggers focused tests, shares AIProvider and TemplateStore
- **Component Stage integration**: auto-discovers components, iterates variants, generates prop combinations, each example = test fixture
- **Mock Server integration**: edge case data scenarios, scenario rotation in monkey tests, PII masking
- **Surfaces**: SDK (programmatic API), CLI, MCP tools (7 tools), CI integration (GitHub Actions), HyperCanvas UI consumer
- **Reporters**: Console (colored pass/fail), JSON (machine-readable), HTML (interactive with side-by-side diffs), CI (GitHub annotations)
- **Cost control**: pixel diff pre-filter, templates first, batched AI calls, per-category budgets, Haiku for validation / Sonnet for analysis
- **Error handling**: test isolation, browser recovery, AI fallback to pixel diff or skip

## Appendix B: Prerequisites and Related Work

### Dependencies

| Package | Relation | Prerequisite? |
|---------|----------|---------------|
| `packages/ds-core` | Provides tokens, AIProvider, TemplateStore interfaces | Yes — types and adapters |
| `packages/component-stage` | Provides component instances for testing | No — optional integration |
| `packages/mock-server` | Provides test data for edge cases and monkey tests | No — optional integration |
| Playwright | Browser automation for screenshots, DOM, interactions | Yes — core dependency |

### Existing tickets that feed into AI Tests

| Ticket | Relation |
|--------|----------|
| HYP-123 | Parent — "think about UX/UI design with AI" |
| HYP-267 | Consumer — AI design generation uses test results as validation |
| HYP-314 | Parallel — full context to AI enriches test analysis |
| HYP-341 | Consumer — Stitch-style generation validated by AI Tests |

### Specs to align with

| Spec | Relation |
|------|----------|
| `2026-04-01-ds-core-design.md` | Shares interfaces, tokens, templates |
| Phase 2 All CSS Frameworks | Style adapters provide computed styles for comparison |

---
