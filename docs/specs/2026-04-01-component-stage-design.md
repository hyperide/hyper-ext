# Component Stage — Component Playground for AI-Native IDE

**Date:** 2026-04-01
**Author:** Alex Ultra + Claude
**Status:** Draft
**Linear:** TBD (parent: HYP-123)

## Vision

Component Stage makes components observable, testable, and explorable — for both
humans and AI. Think Storybook, but built for an AI-native IDE where the primary
consumers are linters, test runners, and AI agents, with human designers as
first-class users too.

Storybook's fundamental model is "developer writes stories manually, human views
them in a browser." Component Stage inverts this: stories are auto-generated from
TypeScript types, consumed primarily by machines (DS Core linter, AI Test Runner,
monkey tester), and rendered in HyperIDE's board mode where humans manipulate
them with the same canvas tools they use for everything else.

The name is **Component Stage** — not "Storybook" or "component explorer." A
stage is where performers (components) are observed under controlled conditions.
The audience is both human and machine.

### What This Is Not

- Not a documentation generator (that's Storybook Docs)
- Not a style guide browser (that's DS Core's Token Library Panel)
- Not a visual regression tool (that's AI Test Runner's snapshot layer)

Component Stage is the **component introspection and instantiation engine** that
all of those systems consume.

### Key Differentiators

1. **Type-driven story generation** — prop types are the single source of truth.
   No manual `.stories.tsx` files required (though they're supported).
2. **Machine-first API** — every story is addressable via SDK, CLI, and MCP. AI
   agents create, render, and validate stories without touching a browser.
3. **Animation as data** — animations are captured as keyframe sequences, not
   observed in real-time. Linters validate duration tokens. Tests compare
   snapshots. No flaky timing-dependent assertions.
4. **Smart Mock integration** — complex props (data arrays, user objects) are
   filled from Smart Mock Server with edge-case variants built in.
5. **Board Mode as UI** — no separate dev server. Stories render in HyperIDE's
   existing board mode grid with full canvas interaction.

---

## 1. Package Structure

```
packages/component-stage/
  src/
    index.ts                          -- Public API: ComponentStage class
    types/
      component.ts                    -- ComponentDefinition, PropSchema, PropType
      story.ts                        -- Story, StorySet, StoryAssertion
      adapter.ts                      -- DI adapter interfaces
      config.ts                       -- StageConfig schema
      animation.ts                    -- AnimationCapture, Keyframe, EasingToken
      render.ts                       -- RenderResult, RenderOptions, Viewport

    scanner/
      scanner-adapter.ts              -- Wraps lib/component-scanner via DI
      prop-extractor.ts               -- Extract props from scanned components
      export-resolver.ts              -- Resolve named/default exports

    props/
      type-analyzer.ts                -- TypeScript type → PropSchema conversion
      default-values.ts               -- Infer default values from code
      cartesian.ts                    -- Cartesian product generator with limits
      value-generator.ts              -- Generate sample values per PropType

    stories/
      auto-generator.ts               -- Generate stories from PropSchema
      manual-loader.ts                -- Load .stories.ts/.stories.tsx files
      ai-suggester.ts                 -- AI suggests interesting combinations
      story-registry.ts               -- Central story registry (merge auto + manual)
      story-serializer.ts             -- Serialize/deserialize stories for cache

    renderer/
      renderer.ts                     -- Render orchestrator (delegates to adapter)
      isolation.ts                    -- Isolation context setup (providers, theme)
      viewport.ts                     -- Viewport presets (mobile, tablet, desktop)
      screenshot.ts                   -- Capture rendered story as image

    animation/
      declaration-extractor.ts        -- Extract CSS animation/transition from code
      keyframe-parser.ts              -- Parse @keyframes into structured data
      capture.ts                      -- Capture animation as keyframe sequence
      comparator.ts                   -- Compare captures against references

    surfaces/
      sdk.ts                          -- Programmatic API
      cli.ts                          -- CLI entry point
      mcp.ts                          -- MCP tool definitions
      board-adapter.ts                -- Board mode integration adapter

  tests/
    ...

  package.json
  tsconfig.json
```

---

## 2. DI Adapter Interfaces

Component Stage depends on zero concrete implementations. All external
capabilities are injected via typed interfaces.

```typescript
// packages/component-stage/src/types/adapter.ts

/**
 * Discovers components in a project.
 *
 * HyperIDE provides: ComponentScannerAdapter (wraps lib/component-scanner/).
 * External consumers provide their own implementations.
 */
export interface ComponentDiscovery {
  /** Scan project and return all discovered components */
  discover(projectRoot: string): Promise<DiscoveredComponent[]>

  /** Get detailed info for a single component by path */
  getComponent(
    projectRoot: string,
    componentPath: string,
  ): Promise<DiscoveredComponent | null>

  /** Invalidate cache (after file changes) */
  invalidate(projectRoot: string): Promise<void>
}

/**
 * Extracts prop types from TypeScript source code.
 *
 * HyperIDE provides: TSMorphTypeAnalyzer (uses ts-morph for AST analysis).
 * Lightweight alternative: RegexTypeAnalyzer (fast but less accurate).
 */
export interface TypeAnalyzer {
  /** Extract prop schema from a component file */
  extractProps(filePath: string, componentName: string): Promise<PropSchema>

  /** Resolve a type alias to its definition */
  resolveType(filePath: string, typeName: string): Promise<ResolvedType | null>

  /** Check if the analyzer supports this file type */
  supports(filePath: string): boolean
}

/**
 * Renders a component in isolation and captures the result.
 *
 * HyperIDE provides: IframeRenderer (browser iframe), PlaywrightRenderer
 * (headless browser). Test environments: JSDOMRenderer (fast, no visuals).
 */
export interface Renderer {
  /** Render a story and return the result */
  render(story: Story, options: RenderOptions): Promise<RenderResult>

  /** Capture a screenshot of a rendered story */
  screenshot(story: Story, options: ScreenshotOptions): Promise<Buffer>

  /** Check if the renderer is available */
  isAvailable(): Promise<boolean>

  /** Dispose renderer resources */
  dispose(): Promise<void>
}

/**
 * Captures CSS/JS animations as structured keyframe data.
 *
 * HyperIDE provides: CSSAnimationCapture (parses CSS), PlaywrightCapture
 * (runs animation and samples frames via requestAnimationFrame).
 */
export interface AnimationCapture {
  /** Extract animation declarations from source code */
  extractDeclarations(filePath: string): Promise<AnimationDeclaration[]>

  /** Capture animation keyframes for a story */
  captureKeyframes(
    story: Story,
    animationName: string,
  ): Promise<CapturedAnimation>

  /** Compare a capture against a reference */
  compare(
    actual: CapturedAnimation,
    reference: CapturedAnimation,
    tolerance: ComparisonTolerance,
  ): ComparisonResult
}

/**
 * Provides sample data for complex prop types.
 *
 * HyperIDE provides: MockServerDataProvider (wraps packages/mock-server).
 * Fallback: StaticDataProvider (hardcoded sample data per type).
 */
export interface DataProvider {
  /** Generate sample data for a prop type */
  generateValue(propType: PropType, options?: DataOptions): Promise<unknown>

  /** Generate edge-case data (empty arrays, very long strings, null, Unicode) */
  generateEdgeCases(propType: PropType): Promise<unknown[]>

  /** Generate N distinct values for a prop (for variant grid) */
  generateVariants(propType: PropType, count: number): Promise<unknown[]>
}

/**
 * AI provider for story suggestions and prop analysis.
 *
 * Same interface pattern as DS Core's AIProvider — abstracted so Component
 * Stage doesn't depend on any specific AI SDK.
 */
export interface AIStoryProvider {
  /** Suggest interesting prop combinations beyond Cartesian product */
  suggestStories(
    component: ComponentDefinition,
    existingStories: Story[],
  ): Promise<SuggestedStory[]>

  /** Generate human-readable story names and descriptions */
  nameStory(
    component: ComponentDefinition,
    props: Record<string, unknown>,
  ): Promise<{ name: string; description: string }>

  /** Suggest assertions for a story (what to validate) */
  suggestAssertions(
    story: Story,
    component: ComponentDefinition,
  ): Promise<StoryAssertion[]>
}

/**
 * File system access — abstracted for testability and remote execution.
 * Same interface as DS Core's FileSystem.
 */
export interface FileSystem {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  glob(pattern: string, cwd?: string): Promise<string[]>
  exists(path: string): Promise<boolean>
}
```

### Adapter Registration

```typescript
// packages/component-stage/src/index.ts

export class ComponentStage {
  private discovery: ComponentDiscovery | null = null
  private typeAnalyzer: TypeAnalyzer | null = null
  private renderer: Renderer | null = null
  private animationCapture: AnimationCapture | null = null
  private dataProvider: DataProvider | null = null
  private aiProvider: AIStoryProvider | null = null
  private fs: FileSystem | null = null
  private storyRegistry: StoryRegistry

  constructor(private config: StageConfig) {
    this.storyRegistry = new StoryRegistry()
  }

  registerDiscovery(discovery: ComponentDiscovery): void {
    this.discovery = discovery
  }

  registerTypeAnalyzer(analyzer: TypeAnalyzer): void {
    this.typeAnalyzer = analyzer
  }

  registerRenderer(renderer: Renderer): void {
    this.renderer = renderer
  }

  registerAnimationCapture(capture: AnimationCapture): void {
    this.animationCapture = capture
  }

  registerDataProvider(provider: DataProvider): void {
    this.dataProvider = provider
  }

  registerAIProvider(provider: AIStoryProvider): void {
    this.aiProvider = provider
  }

  registerFileSystem(fs: FileSystem): void {
    this.fs = fs
  }

  // --- Core operations ---

  /** Discover all components and generate stories */
  async scan(projectRoot: string): Promise<ScanResult> { ... }

  /** List all components with their story counts */
  async listComponents(): Promise<ComponentSummary[]> { ... }

  /** Get full definition for a component (props, stories, animations) */
  async getComponent(componentPath: string): Promise<ComponentDefinition> { ... }

  /** Get all stories for a component */
  async getStories(componentPath: string): Promise<Story[]> { ... }

  /** Render a specific story */
  async renderStory(storyId: string, options?: RenderOptions): Promise<RenderResult> { ... }

  /** Capture animation for a story */
  async captureAnimation(storyId: string, animationName: string): Promise<CapturedAnimation> { ... }

  /** Suggest new stories via AI */
  async suggestStories(componentPath: string): Promise<SuggestedStory[]> { ... }

  /** Get prop schema for a component */
  async getProps(componentPath: string): Promise<PropSchema> { ... }
}
```

---

## 3. Core Types

### 3.1 Component Definition

```typescript
// packages/component-stage/src/types/component.ts

/** Raw output from ComponentDiscovery adapter */
export interface DiscoveredComponent {
  /** Relative path from project root */
  path: string

  /** Component name (PascalCase) */
  name: string

  /** Export type */
  exportType: 'default' | 'named'

  /** Category from scanner */
  category: 'atom' | 'composite' | 'page'

  /** File size in bytes (for complexity heuristic) */
  fileSize: number
}

/** Full component definition with resolved props and stories */
export interface ComponentDefinition {
  /** Relative path from project root */
  path: string

  /** Component name */
  name: string

  /** Export type */
  exportType: 'default' | 'named'

  /** Category */
  category: 'atom' | 'composite' | 'page'

  /** Extracted prop schema */
  props: PropSchema

  /** All stories (auto + manual + AI) */
  stories: Story[]

  /** Animation declarations found in this component */
  animations: AnimationDeclaration[]

  /** Whether the component uses React.forwardRef */
  forwardRef: boolean

  /** Whether the component accepts children */
  acceptsChildren: boolean

  /** Dependencies (other components this one imports) */
  dependencies: string[]

  /** Discovery metadata */
  meta: {
    scannedAt: string
    storiesGenerated: number
    storiesManual: number
    storiesAI: number
  }
}

/** Prop schema extracted from TypeScript types */
export interface PropSchema {
  /** Component name these props belong to */
  componentName: string

  /** Individual prop definitions */
  props: PropDefinition[]

  /** Whether the component extends HTMLAttributes (and which element) */
  extendsHTML: string | null

  /** The TypeScript type name (e.g., "ButtonProps") */
  typeName: string | null

  /** Source file where props are defined */
  typeSourcePath: string | null
}

export interface PropDefinition {
  /** Prop name */
  name: string

  /** Prop type */
  type: PropType

  /** Whether this prop is required */
  required: boolean

  /** Default value (if detected from code) */
  defaultValue: unknown | undefined

  /** JSDoc description (if present) */
  description: string | null

  /** Whether this prop controls visual appearance (heuristic) */
  isVisual: boolean
}

/**
 * Recursive type representation.
 * Designed for code generation (story auto-generation) and display (prop explorer UI).
 */
export type PropType =
  | { kind: 'string'; literal?: string }
  | { kind: 'number'; literal?: number }
  | { kind: 'boolean' }
  | { kind: 'null' }
  | { kind: 'undefined' }
  | { kind: 'union'; members: PropType[] }
  | { kind: 'intersection'; members: PropType[] }
  | { kind: 'array'; elementType: PropType }
  | { kind: 'tuple'; elements: PropType[] }
  | { kind: 'object'; properties: PropDefinition[] }
  | { kind: 'function'; params: PropDefinition[]; returnType: PropType }
  | { kind: 'enum'; name: string; values: Array<string | number> }
  | { kind: 'ref'; typeName: string; resolved?: PropType }
  | { kind: 'reactNode' }
  | { kind: 'reactElement' }
  | { kind: 'unknown'; raw: string }
```

### 3.2 Story

```typescript
// packages/component-stage/src/types/story.ts

export interface Story {
  /** Unique story ID (deterministic: hash of componentPath + props) */
  id: string

  /** Component this story belongs to */
  componentPath: string
  componentName: string

  /** Props for this story instance */
  props: Record<string, unknown>

  /** Children content (if component accepts children) */
  children?: string | StoryChildren

  /** Human-readable story name */
  name: string

  /** Optional description */
  description?: string

  /** Categorization tags */
  tags: StoryTag[]

  /** How this story was created */
  source: 'auto' | 'manual' | 'ai'

  /** Assertions for AI test runner */
  assertions: StoryAssertion[]

  /** Viewport override (null = use default from config) */
  viewport: Viewport | null

  /** Theme override (null = use project default) */
  theme: 'light' | 'dark' | null

  /** Interaction state to simulate */
  interactionState: InteractionState | null

  /** Priority for rendering order (higher = rendered first) */
  priority: number
}

/** Children can be a string or a structured reference */
export type StoryChildren =
  | { kind: 'text'; value: string }
  | { kind: 'element'; component: string; props: Record<string, unknown> }
  | { kind: 'fragment'; children: StoryChildren[] }

/** Predefined tags for story categorization */
export type StoryTag =
  | 'default'
  | 'interactive'
  | 'dark-mode'
  | 'edge-case'
  | 'responsive'
  | 'rtl'
  | 'error-state'
  | 'loading'
  | 'disabled'
  | 'empty'
  | 'overflow'
  | 'animation'
  | (string & {})

/** Interaction state to simulate on a story */
export interface InteractionState {
  hover: boolean
  focus: boolean
  active: boolean
  disabled: boolean
  focusVisible: boolean
}

/** Viewport dimensions */
export interface Viewport {
  width: number
  height: number
  name: string
  deviceScaleFactor?: number
}

/** Predefined viewport presets */
export const VIEWPORT_PRESETS: Record<string, Viewport> = {
  'mobile-sm': { width: 320, height: 568, name: 'iPhone SE' },
  'mobile': { width: 375, height: 812, name: 'iPhone 14' },
  'mobile-lg': { width: 428, height: 926, name: 'iPhone 14 Pro Max' },
  'tablet': { width: 768, height: 1024, name: 'iPad' },
  'desktop': { width: 1280, height: 800, name: 'Desktop' },
  'desktop-lg': { width: 1920, height: 1080, name: 'Desktop HD' },
}

/** What to validate about a rendered story */
export interface StoryAssertion {
  /** Assertion type */
  type:
    | 'screenshot-match'        // Visual regression against reference
    | 'no-console-errors'       // No console.error during render
    | 'no-layout-overflow'      // Content doesn't overflow container
    | 'accessible-name'         // Component has accessible name
    | 'color-contrast'          // Text meets WCAG contrast ratio
    | 'tap-target-size'         // Interactive elements ≥ 44px
    | 'animation-duration'      // Animation within acceptable range
    | 'renders-without-crash'   // Component mounts without throwing
    | 'ds-core-compliant'       // No DS Core violations
    | 'custom'                  // Custom assertion (expression)

  /** Assertion parameters */
  params?: Record<string, unknown>

  /** Severity if assertion fails */
  severity: 'error' | 'warning'

  /** Human-readable description */
  description: string
}

/** Set of stories for a single component */
export interface StorySet {
  componentPath: string
  componentName: string
  stories: Story[]
  generatedAt: string
  config: StoryGenerationConfig
}
```

### 3.3 Animation Types

```typescript
// packages/component-stage/src/types/animation.ts

/** CSS animation/transition declaration found in source code */
export interface AnimationDeclaration {
  /** Animation name or 'transition' for CSS transitions */
  name: string

  /** Source location */
  filePath: string
  line: number

  /** Declaration type */
  type: 'keyframes' | 'transition' | 'spring'

  /** Duration in milliseconds */
  duration: number | null

  /** Easing function */
  easing: string | null

  /** Delay in milliseconds */
  delay: number | null

  /** CSS properties animated */
  properties: string[]

  /** Whether prefers-reduced-motion is handled */
  reducedMotionHandled: boolean

  /** Raw CSS/JS source of the declaration */
  raw: string
}

/** Captured animation as a sequence of keyframes */
export interface CapturedAnimation {
  /** Animation name */
  name: string

  /** Component and story this was captured from */
  componentPath: string
  storyId: string

  /** Ordered keyframe snapshots */
  frames: Keyframe[]

  /** Total duration in milliseconds */
  duration: number

  /** Easing function used */
  easing: string

  /** Captured at timestamp */
  capturedAt: string
}

/** Single keyframe in a captured animation */
export interface Keyframe {
  /** Position in animation (0.0 = start, 1.0 = end) */
  offset: number

  /** Time in milliseconds from animation start */
  timeMs: number

  /** CSS properties at this keyframe */
  properties: Record<string, string>

  /** Bounding box at this keyframe (if visual capture) */
  boundingBox?: { x: number; y: number; width: number; height: number }
}

/** Tolerance settings for animation comparison */
export interface ComparisonTolerance {
  /** Max allowed position difference per property (in px or %) */
  positionDelta: number

  /** Max allowed timing difference (in ms) */
  timingDelta: number

  /** Max allowed color difference (deltaE) */
  colorDelta: number

  /** Max allowed opacity difference (0-1) */
  opacityDelta: number
}

/** Result of comparing two animation captures */
export interface ComparisonResult {
  /** Whether the animations match within tolerance */
  matches: boolean

  /** Per-frame comparison details */
  frameDiffs: FrameDiff[]

  /** Overall similarity score (0-1) */
  similarity: number

  /** Summary of differences */
  summary: string
}

export interface FrameDiff {
  offset: number
  propertyDiffs: Array<{
    property: string
    expected: string
    actual: string
    delta: number
    withinTolerance: boolean
  }>
}
```

### 3.4 Render Types

```typescript
// packages/component-stage/src/types/render.ts

export interface RenderOptions {
  /** Viewport to render in */
  viewport: Viewport

  /** Theme to apply */
  theme: 'light' | 'dark'

  /** Whether to simulate interaction state */
  interactionState?: InteractionState

  /** Isolation level */
  isolation: 'full' | 'minimal'

  /** Provider wrappers to apply (ThemeProvider, I18nProvider, etc.) */
  providers: ProviderConfig[]

  /** Timeout in milliseconds */
  timeout: number
}

export interface ProviderConfig {
  /** Import path for the provider component */
  importPath: string

  /** Provider component name */
  name: string

  /** Props to pass to the provider */
  props: Record<string, unknown>
}

export interface RenderResult {
  /** Whether rendering succeeded */
  success: boolean

  /** Error if rendering failed */
  error?: string

  /** Console output during render (errors, warnings, logs) */
  console: ConsoleEntry[]

  /** Rendered HTML string */
  html: string

  /** Computed styles of the root element */
  computedStyles: Record<string, string>

  /** Bounding box of the rendered component */
  boundingBox: { x: number; y: number; width: number; height: number }

  /** Render duration in milliseconds */
  duration: number

  /** Accessibility tree (simplified) */
  accessibilityTree?: AccessibilityNode
}

export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error'
  message: string
  timestamp: number
}

export interface AccessibilityNode {
  role: string
  name: string
  children: AccessibilityNode[]
  properties: Record<string, string>
}

export interface ScreenshotOptions {
  /** Image format */
  format: 'png' | 'jpeg'

  /** JPEG quality (1-100) */
  quality: number

  /** Whether to include padding around the component */
  padding: number

  /** Device pixel ratio */
  deviceScaleFactor: number
}
```

---

## 4. Story Generation

### 4.1 Auto-Generation from TypeScript Props

The auto-generator reads `PropSchema` and produces stories by systematic
enumeration of prop values. No manual story files needed.

```typescript
// packages/component-stage/src/stories/auto-generator.ts

interface StoryGenerationConfig {
  /** Max total auto-generated stories per component */
  maxStories: number                // default: 50

  /** Max Cartesian product combinations before pruning */
  maxCartesian: number              // default: 50

  /** Include edge-case stories (empty, overflow, null) */
  includeEdgeCases: boolean         // default: true

  /** Include interaction state variants (hover, focus, disabled) */
  includeInteractionStates: boolean // default: true

  /** Include dark mode variants */
  includeDarkMode: boolean          // default: true

  /** Include responsive variants (multiple viewports) */
  includeResponsive: boolean        // default: false

  /** Props to exclude from variant generation */
  excludeProps: string[]            // default: ['className', 'style', 'ref', 'key']
}
```

**Generation algorithm:**

```
1. Extract PropSchema via TypeAnalyzer
2. Classify each prop:
   ├─ Enum/union with ≤ 10 values → enumerate all
   ├─ Boolean → [true, false]
   ├─ String (no literal) → ['Sample text'] (or DataProvider value)
   ├─ Number (no literal) → [0, 1, 42] (or DataProvider value)
   ├─ Complex object → DataProvider.generateValue()
   ├─ Function → no-op stub
   └─ ReactNode/children → ['Label', <Icon />, null]

3. Identify "variant props" — props that meaningfully change appearance:
   ├─ Union/enum props (variant, size, color, type, status)
   ├─ Boolean props (disabled, loading, checked, open)
   └─ Heuristic: prop name contains 'variant', 'size', 'color', 'type', 'state'

4. Generate Cartesian product of variant props
   ├─ If product > maxCartesian: prune by priority
   │   ├─ Keep: one story per enum value (1D slices)
   │   ├─ Keep: default + extreme combinations
   │   └─ Drop: middle-of-the-road combinations
   └─ Each combination = one story

5. Generate edge-case stories:
   ├─ All optional props omitted (minimal props)
   ├─ Very long string for text props (overflow test)
   ├─ Empty array for list props
   ├─ Empty string for text props
   └─ Maximum values for number props

6. Generate interaction state stories:
   ├─ Default + hover
   ├─ Default + focus (focus-visible)
   ├─ Default + active
   └─ Default + disabled (if disabled prop exists)

7. Name each story:
   ├─ Auto: "{ComponentName} — {variant value} {size value} {state}"
   │   Example: "Button — Primary Large Disabled"
   └─ AI: suggestStories() for creative combinations
```

### 4.2 Manual Stories

Manual `.stories.ts` files follow a simple format — no decorators, no
`meta` export dance, no CSF3 complexity:

```typescript
// src/components/Button.stories.ts
import { defineStories } from '@hyperide/component-stage'

export default defineStories('src/components/Button.tsx', {
  stories: [
    {
      name: 'Primary with icon',
      props: { variant: 'primary', size: 'md' },
      children: { kind: 'fragment', children: [
        { kind: 'element', component: 'Icon', props: { name: 'plus' } },
        { kind: 'text', value: 'Add item' },
      ]},
      tags: ['interactive'],
    },
    {
      name: 'Loading state with long label',
      props: { variant: 'primary', loading: true },
      children: { kind: 'text', value: 'Processing your request...' },
      tags: ['loading', 'edge-case'],
      assertions: [
        {
          type: 'no-layout-overflow',
          severity: 'error',
          description: 'Loading spinner should not cause text overflow',
        },
      ],
    },
  ],

  // Override auto-generation config for this component
  autoConfig: {
    maxStories: 30,
    excludeProps: ['className', 'style', 'ref', 'onAnimationEnd'],
  },
})
```

### 4.3 AI-Suggested Stories

When `aiSuggestions` is enabled, the AI provider suggests combinations that
the Cartesian generator misses — edge cases that require domain knowledge:

```typescript
// Example AI suggestions for a DataTable component
const suggestions: SuggestedStory[] = [
  {
    name: 'Empty state with custom message',
    props: { data: [], emptyMessage: 'No results found' },
    tags: ['empty', 'edge-case'],
    reasoning: 'Empty tables need a visible empty state message — common oversight',
  },
  {
    name: 'Single row with all column types',
    props: { data: [{ id: 1, name: 'Test', active: true, createdAt: '2026-01-01' }] },
    tags: ['edge-case'],
    reasoning: 'Single row reveals column alignment issues hidden by multi-row data',
  },
  {
    name: 'Sorted descending with selected rows',
    props: { data: mockData, sortColumn: 'name', sortDirection: 'desc', selectedRows: [0, 2] },
    tags: ['interactive'],
    reasoning: 'Sort + selection combination exposes state management bugs',
  },
]
```

### 4.4 Story Registry

The registry merges all story sources with clear precedence:

```
Priority (highest first):
1. Manual stories          — explicit developer intent, always kept
2. AI-suggested stories    — approved suggestions
3. Auto-generated stories  — filled in for remaining prop space

Deduplication:
- Stories with identical props (by deep equality) are merged
- Manual story's name/description/assertions override auto-generated
- Tags are unioned across sources
```

---

## 5. Prop Explorer

Interactive UI (rendered in HyperIDE's board mode side panel) for examining
and manipulating component props.

### 5.1 Features

```
┌────────────────────────────────────────────────┐
│  Button — PropSchema                            │
├────────────────────────────────────────────────┤
│                                                 │
│  variant    'primary' | 'secondary' | 'ghost'   │
│             ● primary  ○ secondary  ○ ghost      │
│                                                 │
│  size       'sm' | 'md' | 'lg'                  │
│             ○ sm  ● md  ○ lg                     │
│                                                 │
│  disabled   boolean        [  ] false            │
│                                                 │
│  loading    boolean        [  ] false            │
│                                                 │
│  children   ReactNode      [ Add item       ]    │
│                                                 │
│  onClick    () => void     ⚡ (stub)              │
│                                                 │
│ ─── Computed Styles ───────────────────────────  │
│  background:  bg-blue-600  → #2563EB             │
│  color:       text-white   → #FFFFFF             │
│  padding:     px-4 py-2    → 16px 8px            │
│  border-radius: rounded-md → 6px                 │
│                                                 │
│ ─── DS Core Tokens ───────────────────────────  │
│  ✓ bg-blue-600 → primary.500                     │
│  ✓ text-white  → on-primary                      │
│  ⚠ px-4       → spacing.md (non-standard)        │
│                                                 │
└────────────────────────────────────────────────┘
```

### 5.2 Prop Editor Controls

Each `PropType` maps to a specific UI control:

| PropType | Control | Behavior |
|----------|---------|----------|
| `boolean` | Toggle switch | Immediate re-render |
| `union` (string literals) | Radio group / dropdown | Immediate re-render |
| `enum` | Dropdown | Immediate re-render |
| `string` | Text input | Debounced re-render (300ms) |
| `number` | Number input + slider | Debounced re-render |
| `object` | JSON editor (Monaco) | Debounced re-render |
| `array` | JSON editor + count control | Debounced re-render |
| `function` | Stub indicator + call log | Shows call count and args |
| `reactNode` | Text input + preset picker | Select from project components |

### 5.3 Computed Styles Display

When a story is rendered, Component Stage extracts computed styles using
the Renderer adapter and maps them to design tokens using DS Core's
`TokenProvider`:

```typescript
interface ComputedStyleInfo {
  /** CSS property name */
  property: string

  /** The class/token/value in source code */
  sourceValue: string

  /** Resolved CSS value */
  resolvedValue: string

  /** DS Core token mapping (if any) */
  token: { name: string; role: string } | null

  /** DS Core violation (if any) */
  violation: { ruleId: string; message: string } | null
}
```

---

## 6. Animation Capture

Animations are captured as structured data, not observed in real-time.
This makes them deterministic and machine-readable.

### 6.1 Extraction Pipeline

```
Source Code
    ↓
┌──────────────────────────┐
│ CSS Declaration Extractor │
│                           │
│ Parses:                   │
│ - @keyframes blocks       │
│ - transition properties   │
│ - animation shorthand     │
│ - CSS-in-JS declarations  │
│ - framer-motion props     │
│ - react-spring configs    │
└────────────┬─────────────┘
             ↓
┌──────────────────────────┐
│ Keyframe Parser           │
│                           │
│ Converts to:              │
│ - Ordered Keyframe[]      │
│ - Duration (ms)           │
│ - Easing function         │
│ - Animated properties     │
└────────────┬─────────────┘
             ↓
┌──────────────────────────┐
│ CapturedAnimation         │
│                           │
│ Stored as JSON:           │
│ - frames: Keyframe[]      │
│ - duration: number        │
│ - easing: string          │
│ - capturedAt: string      │
└──────────────────────────┘
```

### 6.2 What Linters Validate

DS Core's `patterns.motion.*` rules consume `AnimationDeclaration` and
`CapturedAnimation` data:

| Rule | What it checks on AnimationDeclaration |
|------|----------------------------------------|
| `motion.duration-range` | `duration` between 50ms and 1000ms |
| `motion.duration-tokens` | `duration` matches a defined token value |
| `motion.easing-tokens` | `easing` matches a defined token |
| `motion.no-linear` | `easing !== 'linear'` (unless continuous progress) |
| `motion.gpu-friendly` | `properties` are only transform/opacity |
| `motion.reduce-motion` | `reducedMotionHandled === true` |

### 6.3 What Tests Compare

AI Test Runner compares `CapturedAnimation` objects:

```typescript
// packages/ai-test usage
const reference = await stage.captureAnimation(storyId, 'fadeIn')
// ... code changes ...
const current = await stage.captureAnimation(storyId, 'fadeIn')

const result = animationCapture.compare(current, reference, {
  positionDelta: 2,      // 2px tolerance
  timingDelta: 16,       // 1 frame at 60fps
  colorDelta: 3,         // Just-noticeable difference
  opacityDelta: 0.02,    // 2% opacity tolerance
})

expect(result.matches).toBe(true)
```

---

## 7. Integration with Board Mode

HyperIDE's existing Board Mode (HYP-269 area) becomes the visual surface
for Component Stage. Board Mode already renders component variants in a
grid — Component Stage provides the data.

### 7.1 Architecture

```
┌────────────────────────────────────────────────────────┐
│  HyperIDE Board Mode (client/)                          │
│                                                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐      │
│  │ Story 1  │ │ Story 2  │ │ Story 3  │ │ Story 4  │     │
│  │ Primary  │ │Secondary │ │  Ghost   │ │ Disabled │     │
│  │   md     │ │   md     │ │   md     │ │   md     │     │
│  │          │ │          │ │          │ │          │     │
│  │ [Button] │ │ [Button] │ │ [Button] │ │ [Button] │     │
│  │          │ │          │ │          │ │          │     │
│  │ ✓ pass   │ │ ✓ pass   │ │ ⚠ warn  │ │ ✓ pass   │     │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘      │
│                                                         │
│  ┌─── Toolbar ──────────────────────────────────────┐   │
│  │ [Prop Editor] [State ▼] [Viewport ▼] [Theme ▼]  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─── Side Panel ───────────────────────────────────┐   │
│  │ Computed Styles  │  DS Core Violations            │   │
│  │ Accessibility    │  Animation Captures            │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  Data source: ComponentStage.getStories(path)           │
│  Rendering: ComponentStage.renderStory(id)              │
│  Violations: DSCore.validateFiles([path])               │
└────────────────────────────────────────────────────────┘
```

### 7.2 Board Mode Adapter

The `board-adapter.ts` surface translates between Component Stage's data
model and Board Mode's existing rendering system:

```typescript
// packages/component-stage/src/surfaces/board-adapter.ts

export interface BoardCard {
  /** Unique card ID (same as story ID) */
  id: string

  /** Display title */
  title: string

  /** Subtitle (prop summary) */
  subtitle: string

  /** Tags for filtering */
  tags: StoryTag[]

  /** Render function — returns HTML for iframe embedding */
  render: () => Promise<string>

  /** DS Core violation count for this story */
  violationCount: { errors: number; warnings: number }

  /** Screenshot (lazy, generated on first view) */
  screenshot: () => Promise<Buffer>
}

/** Convert ComponentStage stories to Board Mode cards */
export function storiesToCards(
  stories: Story[],
  stage: ComponentStage,
  dsCore?: DSCore,
): BoardCard[] {
  return stories.map(story => ({
    id: story.id,
    title: story.name,
    subtitle: summarizeProps(story.props),
    tags: story.tags,
    render: () => stage.renderStory(story.id).then(r => r.html),
    violationCount: { errors: 0, warnings: 0 }, // Filled lazily by DSCore
    screenshot: () => stage.renderStory(story.id)
      .then(() => stage.screenshot(story.id)),
  }))
}
```

### 7.3 Board Mode Toolbar

The toolbar extends Board Mode's existing controls:

| Control | Function | Implementation |
|---------|----------|----------------|
| Prop Editor | Opens prop explorer panel | Side panel toggle |
| State | Hover / Focus / Active / Disabled | Dropdown → re-renders all cards with state |
| Viewport | Mobile / Tablet / Desktop | Dropdown → changes card rendering viewport |
| Theme | Light / Dark / System | Dropdown → re-renders all cards with theme |
| Filter | By tag, source, violation status | Multi-select filter chips |
| Sort | By name, priority, violation count | Dropdown |
| Columns | 2 / 3 / 4 / auto | Column count control |

---

## 8. Integration with DS Core

DS Core's `ComponentIntrospector` adapter wraps Component Stage to provide
rich component intelligence to the linter.

### 8.1 Adapter Wiring

```typescript
// In HyperIDE initialization (client/ or server/)

import { DSCore } from '@hyperide/ds-core'
import { ComponentStage } from '@hyperide/component-stage'

// Component Stage wraps ComponentScanner
const stage = new ComponentStage(stageConfig)
stage.registerDiscovery(new ComponentScannerAdapter(scanner))
stage.registerTypeAnalyzer(new TSMorphTypeAnalyzer())

// DS Core consumes Component Stage via ComponentIntrospector adapter
const dsCore = new DSCore(dsConfig)
dsCore.registerComponentIntrospector(
  new StageIntrospectorAdapter(stage)
)
```

### 8.2 StageIntrospectorAdapter

```typescript
/**
 * Adapts ComponentStage to DS Core's ComponentIntrospector interface.
 * DS Core gets rich component data (props, stories, animations) without
 * knowing about Component Stage internals.
 */
export class StageIntrospectorAdapter implements ComponentIntrospector {
  constructor(private stage: ComponentStage) {}

  async listComponents(): Promise<ComponentInfo[]> {
    const summaries = await this.stage.listComponents()
    return summaries.map(s => ({
      name: s.name,
      path: s.path,
      category: s.category,
      storyCount: s.storyCount,
      hasAnimations: s.animationCount > 0,
    }))
  }

  async getComponent(name: string): Promise<ComponentDetail | null> {
    const components = await this.stage.listComponents()
    const match = components.find(c => c.name === name)
    if (!match) return null

    const def = await this.stage.getComponent(match.path)
    return {
      name: def.name,
      path: def.path,
      props: def.props.props.map(p => ({
        name: p.name,
        type: propTypeToString(p.type),
        required: p.required,
        defaultValue: p.defaultValue,
      })),
      stories: def.stories.map(s => ({
        id: s.id,
        name: s.name,
        props: s.props,
      })),
      animations: def.animations.map(a => ({
        name: a.name,
        duration: a.duration,
        easing: a.easing,
        properties: a.properties,
        reducedMotionHandled: a.reducedMotionHandled,
      })),
    }
  }

  async findByPattern(pattern: ComponentPattern): Promise<ComponentInfo[]> {
    const all = await this.listComponents()
    return all.filter(c => matchesPattern(c, pattern))
  }
}
```

### 8.3 Per-Story Validation

DS Core validates each story independently. The violations panel in Board
Mode shows per-story results:

```typescript
async function validateStory(
  story: Story,
  stage: ComponentStage,
  dsCore: DSCore,
): Promise<Violation[]> {
  // 1. Render the story
  const result = await stage.renderStory(story.id)
  if (!result.success) return []

  // 2. Extract actual state from the rendered output
  const actualState = dsCore.extractFromHTML(result.html, result.computedStyles)

  // 3. Validate against desired state
  const violations = await dsCore.validateActualState(actualState, {
    filePath: story.componentPath,
    component: story.componentName,
    storyId: story.id,
  })

  return violations
}
```

### 8.4 Template-Driven Validation

Component Stage integrates with DS Core's self-improving decision template system
for validating component stories against design system rules. Templates are matched
via the shared `TemplateStore` — see `2026-04-01-ds-core-design.md` Section 5, 13
and `2026-04-01-self-improving-templates-research.md` for architecture details.

Component Stage's role is limited to providing component data (props, stories,
rendered output) through the `StageIntrospectorAdapter`. Template matching,
rule evolution, and confidence scoring are entirely DS Core's responsibility.

---

## 9. Integration with AI Test Runner

AI Test Runner (`packages/ai-test`) consumes Component Stage stories as
test fixtures.

### 9.1 StoryProvider Adapter

```typescript
// packages/ai-test consumes this adapter

export interface StoryProvider {
  /** Get all stories for a component */
  getStories(componentPath: string): Promise<TestableStory[]>

  /** Get all stories across all components */
  getAllStories(): Promise<TestableStory[]>

  /** Render a story and return screenshot + metadata */
  renderForTest(storyId: string): Promise<TestRenderResult>

  /** Get story assertions (what to validate) */
  getAssertions(storyId: string): Promise<StoryAssertion[]>
}

/** Story enriched with test-specific data */
export interface TestableStory {
  /** Story data */
  story: Story

  /** Prop schema for fuzzing/mutation */
  propSchema: PropSchema

  /** Animation captures for regression */
  animations: CapturedAnimation[]

  /** Reference screenshot (if exists) */
  referenceScreenshot: Buffer | null
}

export interface TestRenderResult {
  /** Screenshot as PNG buffer */
  screenshot: Buffer

  /** Console output during render */
  console: ConsoleEntry[]

  /** Accessibility tree */
  accessibilityTree: AccessibilityNode

  /** Computed styles of root element */
  computedStyles: Record<string, string>

  /** Render success/failure */
  success: boolean
  error?: string
}
```

### 9.2 Test Matrix Generation

AI Test Runner generates test cases from Component Stage stories:

```
Component Stage Stories
    ↓
┌──────────────────────────┐
│ Test Matrix Generator     │
│                           │
│ For each story:           │
│ ├─ Screenshot test        │
│ ├─ Assertion tests        │
│ ├─ Console error test     │
│ └─ A11y test              │
│                           │
│ Cross-story:              │
│ ├─ Visual consistency     │
│ │   (same component,       │
│ │    different variants)   │
│ ├─ Responsive matrix      │
│ │   (story × viewport)    │
│ └─ Theme matrix           │
│     (story × light/dark)  │
└──────────────────────────┘
    ↓
Test Report
```

### 9.3 Monkey Testing

Component Stage's prop schema enables property-based testing:

```typescript
// AI Test Runner's monkey tester consumes PropSchema

async function monkeyTest(
  stage: ComponentStage,
  componentPath: string,
  iterations: number,
): Promise<MonkeyTestResult> {
  const propSchema = await stage.getProps(componentPath)
  const results: MonkeyTestIteration[] = []

  for (let i = 0; i < iterations; i++) {
    // Generate random valid props from schema
    const randomProps = generateRandomProps(propSchema)

    // Create a temporary story
    const story: Story = {
      id: `monkey-${i}`,
      componentPath,
      componentName: propSchema.componentName,
      props: randomProps,
      name: `Monkey test ${i}`,
      tags: ['edge-case'],
      source: 'auto',
      assertions: [
        { type: 'renders-without-crash', severity: 'error', description: 'Component should not throw' },
        { type: 'no-console-errors', severity: 'warning', description: 'No console errors' },
        { type: 'no-layout-overflow', severity: 'warning', description: 'No content overflow' },
      ],
      viewport: null,
      theme: null,
      interactionState: null,
      priority: 0,
    }

    const result = await stage.renderStory(story.id)
    results.push({
      props: randomProps,
      success: result.success,
      error: result.error,
      consoleErrors: result.console.filter(c => c.level === 'error'),
    })
  }

  return { iterations: results, crashRate: calculateCrashRate(results) }
}
```

---

## 10. Integration with Smart Mock Server

Smart Mock Server (`packages/mock-server`) provides realistic test data
for complex prop types that simple generators can't handle.

### 10.1 MockServerDataProvider

```typescript
export class MockServerDataProvider implements DataProvider {
  constructor(private mockServer: MockServer) {}

  async generateValue(propType: PropType, options?: DataOptions): Promise<unknown> {
    switch (propType.kind) {
      case 'object':
        return this.generateObject(propType.properties, options)
      case 'array':
        return this.generateArray(propType.elementType, options)
      case 'string':
        return this.mockServer.generateText(options?.context ?? 'generic')
      case 'number':
        return this.mockServer.generateNumber(options?.range)
      default:
        return generatePrimitive(propType)
    }
  }

  async generateEdgeCases(propType: PropType): Promise<unknown[]> {
    const edges: unknown[] = []

    switch (propType.kind) {
      case 'string':
        edges.push('')                              // Empty string
        edges.push('A'.repeat(1000))                // Very long string
        edges.push('🎨🖌️🎭')                       // Emoji
        edges.push('<script>alert("xss")</script>') // XSS attempt
        edges.push('مرحبا بالعالم')                 // RTL text
        edges.push(' \t\n ')                        // Whitespace only
        break

      case 'array':
        edges.push([])                              // Empty array
        edges.push(await this.generateArray(        // Single item
          propType.elementType, { count: 1 }))
        edges.push(await this.generateArray(        // Large array
          propType.elementType, { count: 100 }))
        break

      case 'number':
        edges.push(0)
        edges.push(-1)
        edges.push(Number.MAX_SAFE_INTEGER)
        edges.push(0.1 + 0.2)                      // Floating point
        edges.push(NaN)
        break

      case 'object':
        edges.push({})                              // Empty object
        edges.push(await this.generateValue(propType)) // Full object
        // Object with all optional props omitted
        const minimalProps = propType.properties
          .filter(p => p.required)
          .reduce((acc, p) => {
            acc[p.name] = generatePrimitive(p.type)
            return acc
          }, {} as Record<string, unknown>)
        edges.push(minimalProps)
        break
    }

    return edges
  }

  async generateVariants(propType: PropType, count: number): Promise<unknown[]> {
    return Promise.all(
      Array.from({ length: count }, () => this.generateValue(propType))
    )
  }
}
```

### 10.2 Edge Case Categories

| Category | Examples | Purpose |
|----------|----------|---------|
| Empty | `""`, `[]`, `{}`, `null`, `undefined` | Boundary conditions |
| Overflow | 1000-char string, 100-item array | Layout stress test |
| Unicode | Emoji, RTL, CJK, combining marks | Internationalization |
| Security | XSS payloads, SQL injection strings | Sanitization verification |
| Numeric | `0`, `-1`, `NaN`, `Infinity`, `MAX_SAFE_INTEGER` | Number handling |
| Temporal | Past dates, future dates, epoch, invalid dates | Date formatting |

---

## 11. Configuration

### 11.1 Config Schema

```typescript
// .hyperide/component-stage.config.ts

import { defineStage } from '@hyperide/component-stage'

export default defineStage({
  // --- Component Discovery ---
  include: ['src/components/**/*.tsx', 'src/features/**/*.tsx'],
  exclude: ['**/*.test.*', '**/*.stories.*', '**/*.spec.*', '**/internal/**'],

  // --- Story Generation ---
  stories: {
    auto: true,                       // Auto-generate from prop types
    maxCartesian: 50,                 // Max Cartesian product combinations
    maxStoriesPerComponent: 100,      // Absolute limit per component
    includeEdgeCases: true,           // Empty, overflow, null variants
    includeInteractionStates: true,   // Hover, focus, active, disabled
    includeDarkMode: true,            // Generate dark mode variants
    includeResponsive: false,         // Generate multi-viewport variants
    aiSuggestions: true,              // AI suggests interesting combinations
    manualDir: 'src/**/*.stories.ts', // Glob for manual story files
  },

  // --- Rendering ---
  render: {
    timeout: 5000,                    // Render timeout (ms)
    isolation: 'full',                // 'full' = clean DOM, 'minimal' = shared context
    providers: [
      // Wrap all stories in these providers
      {
        importPath: 'src/providers/ThemeProvider',
        name: 'ThemeProvider',
        props: {},
      },
    ],
    defaultViewport: 'desktop',       // Default viewport preset
    defaultTheme: 'light',            // Default theme
  },

  // --- Animation Capture ---
  animation: {
    captureKeyframes: true,           // Extract keyframes from CSS/JS
    maxFrames: 30,                    // Max keyframes to capture per animation
    captureFromRuntime: false,        // Capture by running animation (requires Playwright)
  },

  // --- Board Mode Integration ---
  board: {
    columns: 4,                       // Default column count
    showViolations: true,             // Show DS Core violation badges
    showComputedStyles: true,         // Show computed styles panel
    showAccessibilityTree: false,     // Show a11y tree panel
    cardPadding: 16,                  // Padding around each story card (px)
  },

  // --- AI Provider ---
  ai: {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    maxSuggestions: 10,               // Max AI story suggestions per component
  },
})
```

### 11.2 Config Resolution

```
Priority (highest first):
1. Per-component config in .stories.ts autoConfig field
2. .hyperide/component-stage.config.ts
3. Built-in defaults
```

---

## 12. Surfaces

### 12.1 SDK (Programmatic)

```typescript
import { ComponentStage } from '@hyperide/component-stage'
import { ComponentScannerAdapter } from '@hyperide/component-stage/adapters'

const stage = new ComponentStage({ configPath: '.hyperide/component-stage.config.ts' })
stage.registerDiscovery(new ComponentScannerAdapter(scanner))
stage.registerTypeAnalyzer(new TSMorphTypeAnalyzer())
stage.registerRenderer(new PlaywrightRenderer())

// Scan and generate stories
const result = await stage.scan('/path/to/project')
console.log(`Found ${result.components} components, generated ${result.stories} stories`)

// List components
const components = await stage.listComponents()
for (const c of components) {
  console.log(`${c.name}: ${c.storyCount} stories (${c.category})`)
}

// Get stories for a component
const stories = await stage.getStories('src/components/Button.tsx')
for (const story of stories) {
  const result = await stage.renderStory(story.id)
  if (!result.success) {
    console.error(`${story.name} failed: ${result.error}`)
  }
}

// Capture animation
const capture = await stage.captureAnimation(storyId, 'fadeIn')
console.log(`Duration: ${capture.duration}ms, Frames: ${capture.frames.length}`)
```

### 12.2 CLI

```bash
# Scan project and show component summary
component-stage scan

# List all components with story counts
component-stage list

# List stories for a specific component
component-stage stories src/components/Button.tsx

# Render a story to PNG
component-stage render <story-id> --output button-primary.png

# Render all stories for a component
component-stage render-all src/components/Button.tsx --output-dir ./screenshots

# Get prop schema
component-stage props src/components/Button.tsx

# Capture animations
component-stage animation src/components/Button.tsx --animation fadeIn

# Generate AI story suggestions
component-stage suggest src/components/Button.tsx

# Validate all stories against DS Core
component-stage validate

# Export stories as JSON (for CI/external tools)
component-stage export --format json --output stories.json
```

### 12.3 MCP Tools

```typescript
/**
 * List all discovered components in the project.
 *
 * Returns: Array of { name, path, category, storyCount, animationCount }
 */
hyper_stage_list_components()

/**
 * List stories for a specific component.
 *
 * @param componentPath - Relative path to component file
 * @param filter - Optional filter: { tags?: string[], source?: 'auto'|'manual'|'ai' }
 * Returns: Array of Story objects
 */
hyper_stage_list_stories({ componentPath: string, filter?: StoryFilter })

/**
 * Get prop schema with types and default values.
 *
 * @param componentPath - Relative path to component file
 * Returns: PropSchema with all prop definitions
 */
hyper_stage_get_props({ componentPath: string })

/**
 * Render a story and return screenshot as base64 PNG.
 *
 * @param storyId - Story ID to render
 * @param viewport - Optional viewport override ('mobile'|'tablet'|'desktop')
 * @param theme - Optional theme override ('light'|'dark')
 * Returns: { screenshot: base64, html: string, success: boolean, error?: string }
 */
hyper_stage_render({ storyId: string, viewport?: string, theme?: string })

/**
 * Capture animation keyframes for a story.
 *
 * @param storyId - Story ID containing the animation
 * @param animationName - CSS animation name or 'transition'
 * Returns: CapturedAnimation object
 */
hyper_stage_capture_animation({ storyId: string, animationName: string })

/**
 * AI suggests interesting prop combinations for a component.
 *
 * @param componentPath - Relative path to component file
 * @param count - Max suggestions (default: 5)
 * Returns: Array of SuggestedStory with reasoning
 */
hyper_stage_suggest_stories({ componentPath: string, count?: number })

/**
 * Validate all stories for a component against DS Core.
 *
 * @param componentPath - Relative path, or omit for all components
 * Returns: { violations: Violation[], summary: { errors, warnings } }
 */
hyper_stage_validate({ componentPath?: string })

/**
 * Get animation declarations for a component.
 *
 * @param componentPath - Relative path to component file
 * Returns: Array of AnimationDeclaration objects
 */
hyper_stage_get_animations({ componentPath: string })
```

### 12.4 UI (Board Mode)

Not in `packages/component-stage` — lives in `client/` as a consumer:

- **Story Grid** — Board Mode renders stories as cards using `BoardCard` adapter
- **Prop Explorer Panel** — side panel for interactive prop editing
- **Computed Styles Panel** — shows resolved styles + token mapping
- **Violation Overlay** — per-card error/warning badges from DS Core
- **Animation Timeline** — visualize captured keyframes on a timeline
- **Component Picker** — search/browse components, filter by category

---

## 13. Cross-Reference: System Integration Map

Four systems form the HyperIDE component intelligence stack. Each system
is independently useful but gains power through integration.

```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│   ┌──────────────┐        ┌──────────────┐                  │
│   │ Component    │───────→│  DS Core      │                  │
│   │ Stage        │ props  │  Linter       │                  │
│   │              │ stories│              │                  │
│   │ "What exists"│ renders│ "What's wrong"│                  │
│   └──────┬───────┘        └──────┬───────┘                  │
│          │                       │                           │
│          │ stories               │ rules                     │
│          │ schemas               │ violations                │
│          ↓                       ↓                           │
│   ┌──────────────┐        ┌──────────────┐                  │
│   │ AI Test      │←───────│ Smart Mock   │                  │
│   │ Runner       │  data  │ Server       │                  │
│   │              │        │              │                  │
│   │ "Does it     │        │ "Realistic   │                  │
│   │  work?"      │        │  test data"  │                  │
│   └──────────────┘        └──────────────┘                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Integration Matrix

| Consumer → Provider | Component Stage | DS Core | AI Test Runner | Smart Mock Server |
|---------------------|----------------|---------|----------------|-------------------|
| **Component Stage** | — | TokenProvider (token mapping in prop explorer) | — | DataProvider (complex prop values, edge cases) |
| **DS Core** | ComponentIntrospector (component list, props, stories), AnimationDeclaration (motion rules) | — | — | — |
| **AI Test Runner** | StoryProvider (test fixtures), PropSchema (monkey testing), CapturedAnimation (regression) | Violation data (test assertions), Rule definitions (what to check) | — | Test data generation (realistic fixtures) |
| **Smart Mock Server** | PropSchema (knows what types to generate for) | — | — | — |

### Data Flow by Use Case

**Use case 1: Developer opens Board Mode**
```
ComponentScanner → Component Stage (discover) → Board Mode (render grid)
                                              → DS Core (validate each card)
                                              → UI shows violations per story
```

**Use case 2: AI agent runs design review**
```
MCP: hyper_stage_list_components() → component list
MCP: hyper_stage_list_stories(path) → stories
MCP: hyper_stage_render(storyId) → screenshot
MCP: hyper_ds_validate(path) → violations
Agent: "Button has 3 contrast violations in dark mode"
```

**Use case 3: CI runs visual regression**
```
Component Stage (scan) → AI Test Runner (test matrix)
                       → Smart Mock Server (fill complex props)
                       → Playwright (render + screenshot)
                       → Compare against reference screenshots
                       → DS Core (validate each render)
                       → Report: 2 regressions, 5 new violations
```

**Use case 4: Monkey testing in CI**
```
Component Stage (prop schema) → AI Test Runner (random prop gen)
                              → Smart Mock Server (edge cases)
                              → Render 100 random combinations
                              → Report: crash rate 2% (2 of 100)
                              → Stack traces for crashed renders
```

---

## 14. Existing Code to Consume (Not Move)

These modules stay where they are. Component Stage uses them through DI adapters.

| Module | Location | Component Stage adapter |
|--------|----------|------------------------|
| ComponentScanner | `lib/component-scanner/` | `ComponentDiscovery` |
| AI Analyzer | `lib/component-scanner/ai-analyzer.ts` | Used internally by ComponentScanner |
| ProjectStructureStore | `lib/component-scanner/types.ts` | Used internally by ComponentScanner |
| Board Mode UI | `client/pages/Editor/components/` (HYP-269) | Consumes `BoardCard` adapter |
| Preview Iframe | `client/lib/canvas-engine/` | Potential `Renderer` implementation |
| WCAG contrast utils | `shared/utils/color.ts` | Used directly in assertions |

---

## 15. Implementation Phases

### Phase 1: Core Engine + SDK

- `types/` — all type definitions
- `scanner/` — ComponentDiscovery adapter wrapping existing scanner
- `props/` — TypeAnalyzer with ts-morph, PropSchema extraction
- `stories/auto-generator.ts` — Cartesian product story generation
- `stories/story-registry.ts` — Story registry with deduplication
- `surfaces/sdk.ts` — Programmatic API
- Tests for all above

**Deliverable:** `stage.scan()` → `stage.getStories()` works programmatically.

### Phase 2: Rendering + CLI

- `renderer/` — IframeRenderer (browser) + JSDOMRenderer (tests)
- `stories/manual-loader.ts` — Load `.stories.ts` files
- `surfaces/cli.ts` — CLI entry point
- `screenshot.ts` — Screenshot capture

**Deliverable:** `component-stage render <story-id> --output file.png` works.

### Phase 3: Board Mode Integration

- `surfaces/board-adapter.ts` — Board Mode card adapter
- Prop Explorer panel in `client/`
- Computed Styles panel in `client/`
- Violation overlay integration with DS Core

**Deliverable:** Board Mode shows Component Stage stories with live editing.

### Phase 4: Animation + AI

- `animation/` — CSS declaration extractor, keyframe parser, comparator
- `stories/ai-suggester.ts` — AI story suggestions
- `surfaces/mcp.ts` — MCP tool definitions
- Smart Mock Server integration

**Deliverable:** Full system operational — all surfaces, all integrations.

---

## Appendix A: Feature Summary

| Feature | Description | Phase |
|---------|-------------|-------|
| Component discovery | Wraps existing ComponentScanner via DI | 1 |
| Prop extraction | TypeScript AST → PropSchema | 1 |
| Auto story generation | Cartesian product from prop types | 1 |
| Manual stories | `.stories.ts` file format | 2 |
| AI story suggestions | AI suggests interesting combinations | 4 |
| Story registry | Merge auto + manual + AI with deduplication | 1 |
| Iframe rendering | Render stories in isolated iframe | 2 |
| JSDOM rendering | Fast headless rendering for tests | 2 |
| Playwright rendering | Full browser rendering for screenshots | 2 |
| Screenshot capture | PNG/JPEG capture of rendered stories | 2 |
| Prop explorer UI | Interactive prop editing panel | 3 |
| Computed styles display | Resolved CSS + token mapping | 3 |
| Board Mode integration | Stories as board cards | 3 |
| DS Core validation | Per-story violation display | 3 |
| Animation extraction | CSS/JS animation → structured data | 4 |
| Animation comparison | Compare captures against references | 4 |
| Monkey testing support | PropSchema → random valid props | 4 |
| Edge case generation | Empty, overflow, Unicode, XSS | 4 |
| Smart Mock integration | Complex prop data from mock server | 4 |
| MCP tools | 8 tools for AI agent consumption | 4 |
| CLI | Scan, list, render, validate commands | 2 |
| SDK | Programmatic API for all operations | 1 |

## Appendix B: Comparison with Storybook

| Aspect | Storybook | Component Stage |
|--------|-----------|-----------------|
| Story authoring | Manual (CSF3, decorators, meta exports) | Auto from types + optional manual |
| Primary consumer | Human in browser | AI agents, linters, test runners |
| Rendering | Dedicated dev server (port 6006) | HyperIDE Board Mode or headless |
| Configuration | `.storybook/main.ts` + preview.ts | Single `.hyperide/component-stage.config.ts` |
| Props inspection | Addon panel (Controls) | Integrated prop explorer with DS token mapping |
| Design system validation | Manual addon | Automatic via DS Core adapter |
| Animation support | Play function (runtime) | Keyframe capture (structural) |
| Test integration | @storybook/test addon | Native StoryProvider adapter for AI Test Runner |
| AI integration | None | AI story suggestions, AI naming, AI assertions |
| Mock data | Manual args | Smart Mock Server edge case generation |
| CLI | `storybook build` (static site) | `component-stage render` (screenshots, JSON) |
| MCP tools | None | 8 tools for AI agent access |
| Monkey testing | None | PropSchema-driven random testing |

## Appendix C: Related Linear Tickets

| Ticket | Relation |
|--------|----------|
| HYP-123 | Parent — "think about UX/UI design with AI" |
| HYP-269 | Board Mode (Phase 1 Visual Foundation) — UI surface for stories |
| HYP-294 | Token table UI — DS Core consumer, shares token display with prop explorer |
| HYP-314 | Full context to AI/MCP — Component Stage MCP tools are part of AI context |
| HYP-236 | Manual testing — Component Stage automates variant testing |

## Appendix D: Related Specs

| Spec | Relation |
|------|----------|
| `2026-04-01-ds-core-design.md` | DS Core — validation engine, token system, self-improving templates (Section 5, 13) |
| `2026-04-01-self-improving-templates-research.md` | Template architecture research — TemplateStore, confidence scoring, rule evolution |
| `2026-04-01-ai-test-design.md` | AI Test Runner — consumes Component Stage stories as test fixtures |
| `2026-04-01-mock-server-design.md` | Smart Mock Server — provides complex prop data for story generation |
