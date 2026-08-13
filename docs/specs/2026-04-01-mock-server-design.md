# Smart Mock Server — Intelligent Dev Server with PII Masking

**Date:** 2026-04-01
**Author:** Alex Ultra + Claude
**Status:** Draft (Pass 1 — Architecture)
**Related:** DS Core (`docs/specs/2026-04-01-ds-core-design.md`)

## Vision

Smart Mock Server intercepts API requests from the user's app and serves
realistic data — either from a production snapshot (with PII masked) or
AI-generated. It is the data layer for the entire testing ecosystem.

The problem is straightforward: hardcoded fixtures miss real-world edge cases,
and production data leaks PII. Every team picks one poison or the other.
Smart Mock Server eliminates the choice: real data shapes + masked PII +
AI-generated edge cases. One server, all testing levels.

### Who Needs This

| Consumer | What they need | Today's workaround |
|----------|---------------|-------------------|
| **DS Core** (Level 1 linter) | Actual state extraction from components that render API data | Manual fixtures per component |
| **AI Test Runner** (`packages/ai-test`) | Realistic data for spec-based and monkey tests | Handwritten mocks that drift from reality |
| **Component Stage** (`packages/component-stage`) | Sample data matching component prop shapes | Storybook args with lorem ipsum |
| **Developer** | Local dev without hitting production APIs | `.env.local` pointing at staging (or worse, prod) |
| **CI pipeline** | Deterministic API responses for integration tests | Nock/MSW mocks scattered across test files |

### Unique Differentiators

1. **Snapshot + Mask + Replay** — capture production traffic, mask PII automatically, replay deterministically
2. **AI-powered generation** — fill gaps in snapshots with schema-aware realistic data
3. **Edge case injection** — configurable probability of Unicode, nulls, empty arrays, huge payloads
4. **Schema introspection** — auto-detect OpenAPI, GraphQL, tRPC; validate mocks against schema
5. **Multi-surface** — same engine powers SDK, CLI, MCP tools, and UI panel
6. **Shared AIProvider** — reuses the same DI adapter interface as DS Core

> `core + sdk + cli + mcp + ui`

---

## 1. Package Structure

```
packages/mock-server/
  src/
    index.ts                          -- Public API
    types/
      mock.ts                         -- MockDefinition, MockEndpoint, MockResponse
      interceptor.ts                  -- HTTPInterceptor interface
      masking.ts                      -- PIIMasker, PIIDetection, MaskingStrategy
      generator.ts                    -- DataGenerator, GenerationRequest
      schema.ts                       -- SchemaIntrospector, APISchema, EndpointSchema
      snapshot.ts                     -- Snapshot, SnapshotMeta, SnapshotStore
      adapters.ts                     -- All DI adapter interfaces (re-exports)
      config.ts                       -- MockServerConfig schema

    server/
      proxy.ts                        -- HTTP proxy core (intercept + forward/mock)
      router.ts                       -- Route matching: snapshot vs generated vs passthrough
      middleware.ts                    -- Request/response transform pipeline
      websocket.ts                    -- WebSocket proxy (pass-through or mock)
      server.ts                       -- Server lifecycle (start, stop, health)

    snapshot/
      capturer.ts                     -- Records live API responses
      replayer.ts                     -- Serves recorded responses
      differ.ts                       -- Diff two snapshots (schema drift detection)
      har-adapter.ts                  -- Import/export HAR format
      matcher.ts                      -- Match incoming request to stored snapshot

    masking/
      detector.ts                     -- PII detection engine (regex + heuristic)
      masker.ts                       -- Apply masking strategy to detected PII
      strategies/
        faker-strategy.ts             -- Replace with realistic fakes (Faker.js)
        hash-strategy.ts              -- Deterministic hash replacement
        redact-strategy.ts            -- Replace with [REDACTED]
        tokenize-strategy.ts          -- Reversible token replacement
      patterns/
        builtin.ts                    -- Built-in PII patterns (email, phone, SSN, etc.)
        custom.ts                     -- User-defined PII patterns

    generators/
      generator.ts                    -- AI data generation orchestrator
      edge-cases.ts                   -- Edge case generator (nulls, Unicode, overflow)
      scenario.ts                     -- Scenario-based generation ("1000 users with distribution")
      schema-filler.ts                -- Fill schema with realistic data (non-AI, fast)
      prompts/
        data-generation-prompt.ts     -- Prompt for AI data generation
        edge-case-prompt.ts           -- Prompt for targeted edge case creation
        scenario-prompt.ts            -- Prompt for scenario-based generation

    schema/
      introspector.ts                 -- Schema detection and extraction orchestrator
      openapi.ts                      -- OpenAPI/Swagger parser
      graphql.ts                      -- GraphQL introspection query + schema parse
      trpc.ts                         -- tRPC router type extraction
      typescript.ts                   -- TypeScript type extraction for response shapes
      validator.ts                    -- Validate mock data against extracted schema

    storage/
      store.ts                        -- SnapshotStore orchestrator
      fs-store.ts                     -- File system storage (JSON files)
      sqlite-store.ts                 -- SQLite storage (for large snapshot sets)
      index-manager.ts                -- Endpoint index for fast lookup

    surfaces/
      sdk.ts                          -- Programmatic API
      cli.ts                          -- CLI entry point
      mcp.ts                          -- MCP tool definitions
      ui-api.ts                       -- REST API for UI panel communication

  tests/
    ...

  package.json
  tsconfig.json
```

---

## 2. DI Adapter Interfaces

Smart Mock Server depends on **zero** concrete implementations. All external
capabilities are injected via typed interfaces — same pattern as DS Core.

```typescript
// packages/mock-server/src/types/adapters.ts

/**
 * Intercepts outgoing HTTP requests from the user's app.
 * The mechanism varies: Node.js http module patch, fetch monkey-patch,
 * or transparent proxy via DNS/hosts.
 *
 * HyperIDE provides: DockerProxyInterceptor (routes container traffic through mock server).
 * Test runners provide: NodeHTTPInterceptor (patches http/https modules).
 */
export interface HTTPInterceptor {
  /** Start intercepting requests matching the filter */
  start(filter: RequestFilter): Promise<void>

  /** Stop intercepting, restore original behavior */
  stop(): Promise<void>

  /** Register handler for intercepted requests */
  onRequest(handler: InterceptHandler): void

  /** Check if interception is active */
  isActive(): boolean
}

export interface RequestFilter {
  /** URL patterns to intercept (glob or regex) */
  patterns: Array<string | RegExp>
  /** HTTP methods to intercept (default: all) */
  methods?: HTTPMethod[]
  /** Headers that must be present */
  requiredHeaders?: Record<string, string>
}

export type InterceptHandler = (
  request: InterceptedRequest,
  forward: () => Promise<InterceptedResponse>,
) => Promise<InterceptedResponse>

export interface InterceptedRequest {
  method: HTTPMethod
  url: string
  headers: Record<string, string>
  body: unknown
  timestamp: number
}

export interface InterceptedResponse {
  status: number
  headers: Record<string, string>
  body: unknown
  latency: number
  source: 'live' | 'snapshot' | 'generated' | 'mock'
}

type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
```

```typescript
/**
 * Stores and retrieves API response snapshots.
 * Could be file system, SQLite, or remote storage.
 *
 * Default: FsSnapshotStore (JSON files in .hyperide/snapshots/).
 * CI: SqliteSnapshotStore (single file, deterministic).
 */
export interface SnapshotStore {
  /** Save a captured response */
  save(endpoint: EndpointKey, snapshot: Snapshot): Promise<void>

  /** Retrieve the best-matching snapshot for a request */
  get(request: InterceptedRequest): Promise<Snapshot | null>

  /** List all stored snapshots, optionally filtered */
  list(filter?: SnapshotFilter): Promise<SnapshotMeta[]>

  /** Delete snapshots matching filter */
  prune(filter: SnapshotFilter): Promise<number>

  /** Export all snapshots as HAR */
  exportHAR(): Promise<HARArchive>

  /** Import snapshots from HAR */
  importHAR(har: HARArchive): Promise<number>
}

// Snapshot = { request, response, meta: SnapshotMeta }
// SnapshotMeta = { id, endpoint, capturedAt, maskedAt, maskingStrategy, schemaVersion, tags }
// SnapshotFilter = { endpoint?, before?, after?, tags?, masked? }
// EndpointKey = string  ("GET /api/users/:id")
```

```typescript
/**
 * Detects and masks PII in response data.
 *
 * Built-in patterns cover common Western PII.
 * Users add custom patterns for domain-specific identifiers.
 */
export interface PIIMasker {
  /** Detect all PII occurrences in a data structure */
  detect(data: unknown): PIIDetection[]

  /** Mask detected PII using the configured strategy */
  mask(data: unknown, strategy: MaskingStrategy): MaskedResult

  /** Reverse masking for debugging (requires auth token) */
  unmask(masked: unknown, authToken: string): unknown

  /** Register a custom PII pattern */
  registerPattern(pattern: CustomPIIPattern): void
}

// PIIDetection = { path (JSON path), value, type: PIIType, confidence: 0-1 }
// PIIType = 'name' | 'email' | 'phone' | 'address' | 'ssn' | 'credit-card'
//         | 'ip' | 'date-of-birth' | 'passport' | 'driver-license' | 'bank-account' | 'custom'
// MaskingStrategy = { type: MaskingStrategyType, preserveFormat, seed?, locale? }
// MaskingStrategyType = 'faker' | 'hash' | 'redact' | 'tokenize'
// MaskedResult = { data, manifest: MaskManifest, stats: { totalDetected, totalMasked, byType } }
// CustomPIIPattern = { name, type, pattern: RegExp, pathPattern?, confidence? }
```

```typescript
/**
 * AI-powered data generation.
 * Generates realistic data from schema, fills gaps, creates edge cases.
 *
 * Uses the same AIProvider interface as DS Core.
 */
export interface DataGenerator {
  /** Generate data matching a schema */
  fromSchema(schema: EndpointSchema, options: GenerationOptions): Promise<unknown>

  /** Generate edge case data for an endpoint */
  edgeCases(schema: EndpointSchema, types: EdgeCaseType[]): Promise<unknown[]>

  /** Generate a full scenario (e.g., "1000 users with role distribution") */
  scenario(description: string, schema: EndpointSchema): Promise<unknown>

  /** Fill missing fields in partial data */
  fill(partial: unknown, schema: EndpointSchema): Promise<unknown>
}

// GenerationOptions = { count?, locale?, seed?, overrides?, edgeCaseProbability? }

// EdgeCaseType — 17 types:
// empty-array, empty-string, null, undefined-field, long-string (10K chars),
// unicode (emoji/CJK/RTL), rtl-text, large-number (MAX_SAFE_INTEGER),
// negative-number, zero, special-chars (XSS/SQLi), deep-nesting (10+ levels),
// large-array (10K items), duplicate-ids, future-date, epoch-zero, whitespace-only
```

```typescript
/** Reuse AIProvider from DS Core — same interface, shared adapters */
export { AIProvider } from '@hyperide/ds-core/types/adapters'

/** Extracts API schema from various sources */
export interface SchemaIntrospector {
  introspect(target: string): Promise<APISchema>    // Auto-detect and extract
  fromOpenAPI(specPath: string): Promise<APISchema>  // OpenAPI/Swagger spec
  fromGraphQL(endpoint: string): Promise<APISchema>  // GraphQL introspection
  fromTRPC(routerPath: string): Promise<APISchema>   // tRPC router types
  fromTypeScript(filePath: string): Promise<APISchema> // TS response types
}

// APISchema = { type: 'rest'|'graphql'|'trpc'|'unknown', endpoints: EndpointSchema[], definitions }
// EndpointSchema = { key, method, path, pathParams, queryParams, requestBody, responses, auth }
// TypeSchema = { type, properties?, items?, variants?, ref?, format?, enum?, description? }
```

---

## 3. Core Concepts

### 3.1 Server Modes

Smart Mock Server operates in one of three modes per endpoint. The mode
determines where the response comes from.

```
┌─────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  User's App  │────▶│  Smart Mock      │────▶│  Real API         │
│  (Browser/   │◀────│  Server (:4100)  │◀────│  (api.myapp.com)  │
│   Node.js)   │     └──────────────────┘     └───────────────────┘
└─────────────┘              │
                             │ Snapshot Mode: record + replay
                             │ Generate Mode: AI-create from schema
                             │ Hybrid Mode:   snapshot baseline + AI gaps
                             ▼
                    ┌──────────────────┐
                    │  Snapshot Store   │
                    │  (.hyperide/      │
                    │   snapshots/)     │
                    └──────────────────┘
```

**Snapshot Mode** — proxy between user's app and real API. Records all
responses to snapshot store. PII auto-detected and masked before storage.
Replays from snapshots without hitting the real API on subsequent requests.

**Generation Mode** — no real API involved. AI generates data from the
extracted API schema. Useful for endpoints that don't exist yet (API-first
development) or when production access is unavailable.

**Hybrid Mode** (default) — snapshot as baseline, AI fills gaps. If a
snapshot exists for the endpoint, serve it. If not, generate from schema.
Edge case overlays inject chaos into otherwise realistic data.

### 3.2 Request Routing

```typescript
// packages/mock-server/src/server/router.ts

export interface RouteDecision {
  source: 'snapshot' | 'generated' | 'live' | 'static-mock'
  endpoint: EndpointKey
  snapshot?: Snapshot
  generationOptions?: GenerationOptions
  staticResponse?: MockResponse
}

/**
 * Decides how to handle each intercepted request.
 * Priority order:
 * 1. Static mock (explicit response in config) — always wins
 * 2. Snapshot (if exists and mode allows) — fast, deterministic
 * 3. Generated (if mode allows) — AI-powered, schema-aware
 * 4. Live (passthrough to real API) — captures for next time
 */
export function resolveRoute(
  request: InterceptedRequest,
  config: MockServerConfig,
  store: SnapshotStore,
): Promise<RouteDecision>
```

### 3.3 Snapshot Capture Pipeline

```
Live Response
    │
    ▼
┌──────────────┐
│ Schema        │  Extract/validate response shape
│ Validation    │  against known schema (if available)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ PII           │  Detect PII in response body
│ Detection     │  (names, emails, phones, addresses, ...)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ PII           │  Apply masking strategy
│ Masking       │  (faker, hash, redact, tokenize)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Manifest      │  Record what was masked, where, how
│ Generation    │  (for unmask/audit capability)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Snapshot      │  Write to store with metadata
│ Storage       │  (endpoint key, timestamp, schema version)
└──────────────┘
```

### 3.4 PII Detection

PII detection uses a two-layer approach:

**Layer 1 — Pattern matching** (fast, high precision for known formats):

| PII type | Pattern | Base confidence | Notes |
|----------|---------|----------------|-------|
| email | Standard email regex | 0.95 | |
| phone | US phone with optional country code | 0.90 | |
| ssn | `###-##-####` | 0.85 | Context hint: `ssn`, `social.*security` |
| credit-card | 16-digit with separators + Luhn check | 0.90 | |
| ip | IPv4 dotted quad | 0.70 | Low standalone — common in non-PII |
| date-of-birth | ISO date `YYYY-MM-DD` | 0.30 | Needs field name context (+0.6 boost) |

Each pattern has optional `contextHint` (regex on field name) and `contextBoost`
(added to confidence when field name matches).

**Layer 2 — Field name heuristics** (catches PII values that don't match regex patterns):
`firstName` with value `"Alex"` won't match any regex, but the field name signals PII.
Covers: `name`, `email`, `phone`, `address` (street/city/zip/postal), `ssn`, `credit-card`,
`ip`, `date-of-birth`, `passport`, `driver-license`, `bank-account`. Supports
multilingual field names (English, Spanish, German, French).

**Confidence threshold**: masked when `confidence >= configuredThreshold` (default 0.7).
Below threshold: flagged for manual review in the mask manifest.

### 3.5 Masking Strategies

All strategies implement `MaskingStrategyImpl { mask(detection: PIIDetection): string }`.
Each strategy is seeded for determinism (same input + seed = same output).

| Strategy | Output | Reversible | Use case |
|----------|--------|-----------|----------|
| **Faker** | Realistic fake data (`faker.person.fullName()`, `faker.internet.email()`) | No | Dev, demos — data looks real |
| **Hash** | SHA-256 truncated to original length, format-aware (`hash@domain.example`) | No | Referential integrity across endpoints |
| **Redact** | `[REDACTED]` literal | No | Maximum safety, audit logs |
| **Tokenize** | Reversible token stored in encrypted vault | Yes (with auth) | Debugging — unmask specific records |

Faker strategy uses field name → Faker method mapping: `name` → `faker.person.fullName()`,
`email` → `faker.internet.email()`, `phone` → `faker.phone.number()`, etc.
When `preserveFormat: true`, output matches the original format (phone `(XXX) XXX-XXXX`,
email `user@domain.tld`).

### 3.6 Schema Introspection

Auto-detection probes the target API in order:

1. **REST/OpenAPI** — GET `/openapi.json`, `/swagger.json`, `/api-docs`
2. **GraphQL** — POST `/graphql` with `{ __typename }` introspection
3. **tRPC** — scan project source for `**/trpc/**/*.ts` router files
4. **Unknown** — fall back to recording response shapes over time

### 3.7 Data Generation

AI-powered generation follows a tiered approach, same concept as DS Core's
three execution tiers (fast → complex → smart):

**Tier 1 — Schema filler** (no AI, fast): populate schema with Faker data.
Handles 80% of cases. Uses field names and type hints to pick appropriate
Faker generators.

`fillFromSchema(schema, options)` walks the TypeSchema tree recursively.
Field name heuristics pick Faker generators: `email` → `faker.internet.email()`,
`createdAt` → `faker.date.recent()`, `price` → `faker.commerce.price()`.
Falls back to generic generators per type (`string` → `faker.lorem.word()`,
`number` → `faker.number.int()`).

**Tier 2 — AI generation** (slow, smart): for complex scenarios where
schema-filling produces unrealistic data. The AI understands domain context.

The AI prompt includes: endpoint method/path, response schema JSON, optional scenario
description, and constraints (realistic data, consistent relationships between fields,
no real PII, valid JSON matching schema).

**Tier 3 — Edge case injection**: overlays chaos onto realistic data.

`injectEdgeCases(data, schema, types, probability, rng)` walks the data tree.
For each field, rolls the seeded RNG against `probability`. If triggered, picks a
random `EdgeCaseType` and replaces the value (type-aware: only injects `[]` into array
fields, only injects long strings into string fields, etc.).

---

## 4. Configuration

```typescript
// .hyperide/mock-server.config.ts
import { defineMockServer } from '@hyperide/mock-server'

export default defineMockServer({
  target: 'https://api.myapp.com',
  port: 4100,
  cors: true,
  logLevel: 'info',  // 'debug' | 'info' | 'warn' | 'error' | 'silent'

  snapshots: {
    dir: '.hyperide/snapshots/',
    format: 'json',          // 'json' (human-readable) or 'har' (Chrome-compatible)
    maxPerEndpoint: 10,
    autoCapture: true,       // Capture on first request when no snapshot exists
  },

  masking: {
    strategy: 'faker',       // 'faker' | 'hash' | 'redact' | 'tokenize'
    seed: 42,                // Reproducible fakes
    preserveFormat: true,    // Keep phone format, email domain shape
    confidenceThreshold: 0.7,
    customPatterns: [
      { name: 'employee-id', pattern: /^EMP-\d{6}$/, type: 'custom' },
    ],
    allowlist: ['timezone', 'locale', 'currency'],
  },

  schema: {
    openapi: './openapi.yaml',
    autoIntrospect: true,
    validateResponses: true,
  },

  endpoints: {
    'GET /api/users':        { mode: 'snapshot', masking: 'faker' },
    'GET /api/products':     { mode: 'generate', generation: { count: 100, seed: 42 } },
    'POST /api/auth/login':  { mode: 'static', response: { body: { token: '{{jwt}}' } } },
    'GET /api/admin/*':      { mode: 'snapshot', masking: 'redact' },
  },

  edgeCases: {
    enabled: true,
    probability: 0.1,        // 10% of responses include edge cases
    types: ['empty-array', 'null', 'long-string', 'unicode', 'large-number', 'special-chars'],
    exclude: ['POST /api/auth/*'],
  },

  ai: { provider: 'anthropic', model: 'claude-haiku-4-5', maxTokens: 4096 },
  websocket: { passthrough: true, record: false },
})
```

The `MockServerConfig` TypeScript interface mirrors the config example above.
Per-endpoint `EndpointConfig` supports `mode` (`snapshot | generate | hybrid | static | passthrough`),
optional `masking` override, `generation` options (count, seed, scenario), static `response`,
`latency` simulation, and `forceStatus` for error testing.

---

## 5. Surfaces

### 5.1 SDK (Programmatic)

```typescript
import { MockServer } from '@hyperide/mock-server'

const server = new MockServer({ configPath: '.hyperide/mock-server.config.ts' })
await server.start()

// Core API methods:
await server.capture('GET /api/users')        // Capture snapshot from live API
await server.generate('GET /api/users', { count: 50 })  // AI-generate data
await server.mask(data, { strategy: 'faker', seed: 42 }) // Mask PII
await server.introspect()                      // Extract API schema

await server.stop()
```

DI constructor also supported: inject `store`, `aiProvider`, `masker` directly.

### 5.2 CLI

```bash
mock-server start [--port 4200] [--mode snapshot]  # Start proxy server
mock-server stop                                    # Stop server
mock-server status                                  # Server status + endpoint stats

mock-server snapshot capture [/api/users]     # Capture from live API
mock-server snapshot replay                   # Serve from snapshots only
mock-server snapshot list | prune | diff      # Manage snapshots
mock-server snapshot export --format har      # Export as HAR

mock-server generate /api/users --count 1000  # AI-generate data
mock-server generate /api/users --scenario "80% active, 15% inactive, 5% banned"

mock-server mask ./data.json [--strategy hash] [--output masked.json]
mock-server detect ./data.json [--format table]

mock-server schema introspect [--type graphql]
mock-server schema validate                   # Validate snapshots against schema

mock-server init                              # Create default config
```

### 5.3 MCP Tools

Naming convention: `hyper_mock_*` (same pattern as DS Core's `hyper_ds_*`).

| Tool | Parameters | Returns |
|------|-----------|---------|
| `hyper_mock_start` | `config?` | `{ port, status, endpoints }` |
| `hyper_mock_stop` | — | `{ status: 'stopped' }` |
| `hyper_mock_snapshot` | `endpoint?` | `{ snapshotId, piiMasked, size }` |
| `hyper_mock_generate` | `endpoint, count?, scenario?, edgeCases?` | Generated data |
| `hyper_mock_mask` | `input, strategy?, seed?` | `{ masked, stats }` |
| `hyper_mock_detect` | `input` | `PIIDetection[]` |
| `hyper_mock_edge_case` | `endpoint, types?` | Edge case response |
| `hyper_mock_schema` | `type?` | `APISchema` |
| `hyper_mock_status` | — | `{ running, port, endpoints[] }` |

### 5.4 UI (HyperCanvas Integration)

Not in `packages/mock-server` — lives in `client/` as a consumer:

- **Mock Server Panel** — status indicator, start/stop toggle, port display
- **Endpoint List** — all endpoints with their mode (snapshot/generate/hybrid/static), snapshot count, last captured timestamp
- **Data Preview** — response body with PII highlighting (yellow for auto-masked, red for detected-but-unmasked)
- **PII Report** — table of all detected PII across snapshots, grouped by type, with confidence scores
- **Edge Case Generator** — per-endpoint UI: select edge case types, set probability, preview generated data
- **Schema Viewer** — extracted API schema with endpoint tree, request/response types, validation status
- **Snapshot Diff** — side-by-side diff of two snapshots for the same endpoint (schema drift detection)

---

## 6. Integration with Testing Ecosystem

### 6.1 AI Test Runner (`packages/ai-test`)

AI Test Runner is the primary consumer. Each test spec receives a `mockServer`
instance in its `setup()` callback and configures endpoints per scenario:

```typescript
export const spec = defineTestSpec({
  name: 'User list handles empty state',
  component: 'UserList',
  setup: async (mockServer: MockServer) => {
    await mockServer.setEndpoint('GET /api/users', {
      mode: 'static',
      response: { status: 200, body: { users: [], total: 0 } },
    })
  },
  assertions: ['empty state illustration', '"No users found" message', '"Invite users" CTA'],
})
```

Monkey tests set `edgeCases.probability: 0.5` (50% chaos) with all edge case types
enabled, generating 500+ records. Flow: `setup → start → render → assert → reset`.

### 6.2 Component Stage (`packages/component-stage`)

Component Stage calls `mockServer.introspectTypes(componentPath)` to extract
prop types from TypeScript source, then `mockServer.generate(schema)` to create
realistic prop combinations. Auto-generates variants for key states:

- **Base**: realistic data matching prop types
- **Empty**: `{ items: [] }` — empty state
- **Loading**: `{ loading: true }` — loading state
- **Error**: `{ error: 'Network error' }` — error state
- **Chaos**: `edgeCaseProbability: 1.0` — all fields get edge case values

### 6.3 DS Core (`packages/ds-core`)

DS Core's actual state extraction analyzes rendered components. Without mock
server, DS Core only sees empty/loading states. With mock server active,
components fetch realistic data, revealing violations that depend on content.

**Violations caught only with mock data:**

| Violation | Why mock data is needed |
|-----------|----------------------|
| Text overflow on long usernames | Default "John Doe" fits; `"Bartholomew Abernethy-Worthington III"` doesn't |
| Color contrast on user-uploaded avatars | Placeholder avatar has known contrast; dynamic backgrounds vary |
| Spacing collapse with empty lists | Only visible when API returns `[]` |
| RTL layout breaks | Only visible when data includes Arabic/Hebrew text |
| Number formatting overflow | Only visible with `Number.MAX_SAFE_INTEGER` |

### 6.4 HyperIDE Docker/K8s Integration

Mock server runs inside the container/pod alongside the user's dev server.
Setup: (1) `API_BASE_URL=http://localhost:4100` in `.env`, or
(2) Docker network alias matching real API hostname, or
(3) Vite/Next.js dev server proxy to `localhost:4100` (auto-configured by HyperIDE).

---

## 7. Snapshot Diffing and Schema Drift

When the real API changes, snapshots become stale. The differ detects this.

`SnapshotDiff` tracks: added fields, removed fields, type changes, enum changes,
structural changes (array→object, etc.). Each diff entry includes the JSON path,
old/new types, and sample values.

**CLI output example:**

```
$ mock-server snapshot diff --baseline 2026-03-15 --current 2026-04-01

GET /api/users
  + users[].avatar_url       string (format: uri)    — new field
  + users[].two_factor       boolean                  — new field
  ~ users[].role             string → enum("admin","editor","viewer")
  - users[].legacy_plan      string                   — removed

GET /api/products
  ~ products[].price         number → object { amount: number, currency: string }
  + products[].variants      array                    — new field

3 endpoints unchanged. 2 endpoints with drift.
```

---

## 8. Security Model

### PII Vault

The `tokenize` masking strategy stores token-to-original-value mappings in an
encrypted vault (`PIIVault` interface: `store`, `retrieve` (requires auth token),
`delete`, `pruneOlderThan`). Vault is encrypted at rest with a user-provided passphrase.

### Access Control

- **Snapshot capture** requires explicit opt-in (`autoCapture: true` in config
  or manual `mock-server snapshot capture`)
- **Unmask** operation requires an auth token — never exposed in CI
- **PII vault** is encrypted at rest with a key derived from a user-provided passphrase
- **Snapshots with PII** are `.gitignore`-d by default (the `init` command adds the rule)
- **Masked snapshots** (PII replaced) are safe to commit — the `init` command
  creates separate directories:
  ```
  .hyperide/snapshots/raw/     # .gitignore'd — contains pre-masking data
  .hyperide/snapshots/masked/  # Safe to commit — all PII replaced
  ```

### What Never Leaves the Machine

- Raw (unmasked) API responses
- PII vault encryption key
- Auth tokens for unmask operations
- Original values from `tokenize` strategy

---

## 9. Response Enrichment

### Template Variables

Static mock responses support `{{...}}` template variables. Built-in:
`{{jwt}}`, `{{uuid}}`, `{{timestamp}}`, `{{unix}}`, `{{objectId}}`,
`{{email}}`, `{{name}}`, `{{phone}}`, `{{avatar}}`, `{{slug}}`, `{{price}}`.
`resolveTemplates(body, customTemplates?)` walks the object tree and replaces them.

### Latency Simulation

- **Fixed**: `latency: 200` (ms)
- **Range**: `latency: { min: 50, max: 500 }`
- **Percentile**: `latency: { p50: 100, p95: 400, p99: 2000 }`
- **Timeout**: `timeoutProbability: 0.01` — 1% of requests never respond

### Error Injection

Per-endpoint `errors: { probability: 0.05, distribution: { 500: 0.6, 429: 0.2, 503: 0.15 } }`.
Custom error bodies per status code. Injected before response processing.

---

## 10. Stateful Request Processing

Section 9 covers static enrichment: template variables, latency, errors. But
realistic API mocking requires **state** — POST creates a resource, subsequent GET
returns it, PATCH mutates it, DELETE removes it. Without state, a mock server is a
JSON playlist. This section upgrades the mock server from stateless replay to a
stateful API simulator.

### 10.1 In-Memory State Store

Each mock server instance maintains an in-memory key-value store organized by
**collection** (analogous to a REST resource). CRUD operations on mock endpoints
automatically read from and write to this store.

```typescript
// Conceptual store shape
interface StateStore {
  collections: Record<string, Record<string, unknown>>
  /** Auto-incrementing sequences for ID generation */
  sequences: Record<string, number>
  /** Per-session metadata */
  meta: { sessionId: string; createdAt: number; seed: number }
}
```

- **POST /api/orders** — generates an ID, writes `{ [id]: body }` to `store.orders`, returns the created resource
- **GET /api/orders/:id** — reads `store.orders[id]`, returns 404 if missing
- **PATCH /api/orders/:id** — shallow-merges body into `store.orders[id]`
- **DELETE /api/orders/:id** — removes `store.orders[id]`, returns 204
- **GET /api/orders** — returns all values from `store.orders` (with query-param filtering)

State persists for the lifetime of a test session (see 10.4). Restarting the
server or starting a new session resets state to the seed snapshot.

### 10.2 Expression Language

Section 9 introduced simple template variables (`{{uuid}}`, `{{email}}`). Stateful
mocking extends this into a full expression language with access to the request
context and state store.

**Request context:**

| Expression | Resolves to |
|------------|------------|
| `{{request.params.id}}` | URL path parameter (e.g. `:id` segment) |
| `{{request.body.field}}` | Parsed request body field (dot-path supported) |
| `{{request.query.page}}` | Query string parameter |
| `{{request.headers.authorization}}` | Request header value |
| `{{request.method}}` | HTTP method |

**Generators** (superset of section 9 templates):

| Expression | Description |
|------------|------------|
| `{{uuid()}}` | Random UUID v4 |
| `{{now()}}` | ISO 8601 timestamp |
| `{{now('unix')}}` | Unix epoch seconds |
| `{{sequence('orderId')}}` | Auto-incrementing integer, scoped by name |
| `{{faker('internet.email')}}` | Any Faker.js generator by dotted path |
| `{{faker('person.fullName')}}` | Realistic full name |

**JWT helpers:**

| Expression | Description |
|------------|------------|
| `{{request.headers.authorization \| jwtDecode}}` | Full decoded JWT payload |
| `{{request.headers.authorization \| jwtDecode('sub')}}` | Specific JWT claim |
| `{{request.headers.authorization \| jwtDecode('email')}}` | Email from JWT |

**State store queries:**

| Expression | Description |
|------------|------------|
| `{{store.orders[request.params.id]}}` | Fetch single item by dynamic key |
| `{{store.orders \| values}}` | All items in collection as array |
| `{{store.orders \| values \| count}}` | Count of items |
| `{{store.users \| where('role', 'admin')}}` | Filter by field value |
| `{{store.users \| where('role', 'admin') \| count}}` | Count filtered items |
| `{{store.orders \| where('userId', request.params.userId)}}` | Filter by request param |

Expressions are evaluated left-to-right with pipe operators. The expression
engine is intentionally limited — no arbitrary JS execution, no side effects
from within expressions (side effects use a dedicated mechanism, see 10.3).

### 10.3 Side Effects

Mock endpoint definitions can declare **side effects** that write to the state
store after a response is generated. This separates "what to respond" from
"what to remember".

```json
{
  "POST /api/orders": {
    "mode": "static",
    "response": {
      "status": 201,
      "body": {
        "id": "{{uuid()}}",
        "userId": "{{request.headers.authorization | jwtDecode('sub')}}",
        "items": "{{request.body.items}}",
        "total": "{{request.body.total}}",
        "status": "pending",
        "createdAt": "{{now()}}"
      }
    },
    "sideEffects": [
      {
        "store": "orders",
        "key": "{{response.id}}",
        "value": "{{response}}"
      }
    ]
  }
}
```

Side effect rules:

- `store` — target collection name
- `key` — the key under which to store (supports expressions, including `{{response.*}}`)
- `value` — the value to store (`{{response}}` = full response body)
- `action` — `"set"` (default), `"merge"`, `"delete"`, `"append"`
- Side effects execute **after** response template resolution but **before** sending
- Multiple side effects per endpoint are allowed (executed in order)
- `{{response.*}}` expressions reference the resolved response body

### 10.4 Session Isolation

Each test run operates in an isolated state session. This prevents test pollution
and enables parallel test execution.

- **Session creation**: `POST /mock-admin/sessions` returns `{ sessionId }`.
  All subsequent requests with `X-Mock-Session: <sessionId>` header operate on
  that session's isolated state.
- **Default session**: Requests without the header use a shared default session
  (convenient for manual dev, not recommended for CI).
- **Seed snapshots**: Sessions can be initialized from a snapshot file:
  `POST /mock-admin/sessions { seed: "checkout-flow" }` loads
  `.hyperide/snapshots/seeds/checkout-flow.json` as initial state.
- **Session cleanup**: `DELETE /mock-admin/sessions/:id` frees memory.
  Sessions auto-expire after configurable TTL (default: 30 minutes).
- **Parallel safety**: Each session has its own `StateStore` instance — no
  locking, no cross-contamination.

```typescript
// Test setup example
const session = await fetch('http://localhost:4100/mock-admin/sessions', {
  method: 'POST',
  body: JSON.stringify({ seed: 'empty-cart' }),
}).then(r => r.json())

// All test requests include session header
const api = createFetchWrapper({
  headers: { 'X-Mock-Session': session.sessionId },
})
```

### 10.5 Why This Replaces Postman / Mockoon

| Capability | Postman Mock | Mockoon | Smart Mock Server |
|-----------|-------------|---------|------------------|
| Static response matching | Yes | Yes | Yes |
| Request param substitution | No | Partial (route params only) | Full (params, body, query, headers, JWT) |
| State between requests | No | No | Yes (in-memory store, CRUD) |
| Expression language | No | Helpers (Handlebars) | Pipe-based with store queries |
| Side effects | No | No | Yes (write to store on response) |
| Session isolation | No | No | Yes (per-test-run isolation) |
| AI data generation | No | No | Yes (schema-aware, Tier 1-3) |
| PII masking | No | No | Yes (production snapshots) |
| Schema validation | No | No | Yes (OpenAPI, GraphQL, tRPC) |

Postman and Mockoon serve static JSON keyed by URL — they are **response playlists**.
They cannot substitute `request.params.id` into a response body, remember that a
POST created a resource, or return it on subsequent GET. Every non-trivial API
flow (create, read, update, list) requires manual fixture engineering per test
scenario. Smart Mock Server eliminates this: define the shape once, let the state
store handle CRUD, and expressions wire everything together dynamically.

---

## 11. Cross-Reference: System Integration Map

All four packages form a layered testing ecosystem. Smart Mock Server is the
data layer that feeds into every other system.

```
                    ┌─────────────────────────────────────┐
                    │           HyperIDE UI                │
                    │  (Mock Server Panel, DS Violations,  │
                    │   Component Stage, Test Results)      │
                    └───────────┬─────────────────────────┘
                                │ consumes
    ┌───────────────────────────┼──────────────────────────────┐
    │                           │                              │
    ▼                           ▼                              ▼
┌──────────┐         ┌──────────────────┐          ┌───────────────────┐
│ DS Core  │         │ AI Test Runner   │          │ Component Stage   │
│ (linter) │         │ (test execution) │          │ (prop playground) │
└────┬─────┘         └────────┬─────────┘          └────────┬──────────┘
     │                        │                             │
     │ reconcile with         │ configure per               │ generate
     │ populated data         │ test scenario               │ prop data
     │                        │                             │
     ▼                        ▼                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Smart Mock Server                              │
│                                                                  │
│  ┌──────────┐  ┌───────────┐  ┌───────────┐  ┌──────────────┐  │
│  │ Snapshot  │  │ PII       │  │ Generator │  │ Schema       │  │
│  │ Store     │  │ Masker    │  │ (AI)      │  │ Introspector │  │
│  └──────────┘  └───────────┘  └───────────┘  └──────────────┘  │
│                                                                  │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               │ proxies/captures
                               ▼
                    ┌─────────────────────┐
                    │  Real API / Backend  │
                    └─────────────────────┘
```

### Integration Matrix

| Source → Consumer | DS Core | AI Test Runner | Component Stage | HyperIDE UI |
|-------------------|---------|---------------|----------------|-------------|
| **Mock Server → X** | Provides populated data for actual state extraction | Provides configurable mock data per test scenario | Provides prop-shaped data from TS types | Provides endpoint status, PII reports, data preview |
| **X → Mock Server** | Triggers reconciliation with mock data active | Configures endpoints, modes, edge cases per test | Requests prop generation from component types | Start/stop, config changes, snapshot management |
| **DS Core → X** | — | Validates that test scenarios don't violate DS rules | Validates component stage props against DS | Reports violations in UI panel |
| **AI Test Runner → X** | Uses DS violations as test assertions | — | Uses Component Stage as render target | Reports test results |
| **Component Stage → X** | Provides rendered components for DS extraction | Provides render environment for test runner | — | Component preview in UI |

### Shared Dependencies

| Dependency | Used by | Purpose |
|-----------|---------|---------|
| **AIProvider** (DI interface) | DS Core, Mock Server, AI Test Runner | AI operations: validation, generation, test creation |
| **FileSystem** (DI interface) | DS Core, Mock Server | File access abstraction |
| **TypeSchema** (type) | Mock Server (schema), DS Core (token types) | Schema representation |
| **StyleReadAdapter** (DI interface) | DS Core, Component Stage | Style extraction from components |

---

## 12. Lifecycle and Startup

### Auto-Start in HyperIDE

When HyperIDE detects a `.hyperide/mock-server.config.ts` in the project:

1. Start mock server before the dev server
2. Configure the dev server proxy to route through mock server
3. Show mock server status in the toolbar
4. Auto-capture snapshots on first request to uncovered endpoints

### Standalone Usage

`mock-server init` → `mock-server start` (captures from live API) →
`mock-server snapshot replay` (serve from snapshots) →
`git add .hyperide/snapshots/masked/` (commit masked snapshots).

### CI Usage

In CI: `mock-server start --mode snapshot` replays from committed masked snapshots.
Tests run with `API_BASE_URL=http://localhost:4100`. No live API access needed.

---

## 13. Implementation Phases

| Phase | Scope | Deliverable |
|-------|-------|-------------|
| **1 — Core Proxy + Snapshot (MVP)** | HTTP proxy, snapshot capture/replay, FS store, basic PII detection (email/phone/name), faker masking, CLI (`start`, `stop`, `snapshot`), config loader | Capture → mask → replay deterministically |
| **2 — Schema + Generation** | Schema introspection (OpenAPI, GraphQL), Tier 1 generation (schema filler), edge cases, snapshot diffing, CLI (`generate`, `schema`), basic MCP tools | Generate data without live API, detect stale snapshots |
| **3 — AI + Integrations** | AI generation (Tier 2), scenario generation, AI Test Runner + Component Stage + DS Core integration, full MCP tools, UI panel | Full ecosystem — all four systems work together |
| **4 — Advanced** | tRPC/TS type extraction, WebSocket recording, tokenize + vault, SQLite store, latency/error simulation, HAR, Docker/K8s setup | Production-grade with all features |

---

## Appendix A: Feature Summary

| Area | Details |
|------|---------|
| **Package** | `packages/mock-server` — standalone, zero HyperCanvas dependencies |
| **Config** | `.hyperide/mock-server.config.ts` with `defineMockServer()` helper |
| **Server** | HTTP proxy (default :4100), CORS, WebSocket passthrough |
| **Modes** | snapshot, generate, hybrid (default), static, passthrough |
| **Snapshot** | FS (JSON) or SQLite store, HAR import/export, per-endpoint index, diffing |
| **PII** | Two-layer detection (regex + field names), 4 strategies (faker/hash/redact/tokenize), custom patterns |
| **Schema** | Auto-detect API type, OpenAPI, GraphQL, tRPC, TypeScript extraction |
| **Generation** | Three tiers: schema filler (fast) → AI (smart) → edge cases (17 types) |
| **Enrichment** | Template variables, latency simulation, error injection |
| **Stateful** | In-memory state store (CRUD), expression language (request context + store queries + JWT decode), side effects, session isolation with seed snapshots |
| **Security** | Raw snapshots gitignored, PII vault encrypted, unmask requires auth |
| **Surfaces** | SDK, CLI, 9 MCP tools, UI panel |
| **DI adapters** | HTTPInterceptor, SnapshotStore, PIIMasker, DataGenerator, AIProvider (shared), SchemaIntrospector |
| **Integrations** | AI Test Runner, Component Stage, DS Core, HyperIDE Docker/K8s |

## Appendix B: Prerequisites and Related Work

### Existing specs to align with

| Spec | Status | Relation |
|------|--------|----------|
| DS Core (`docs/specs/2026-04-01-ds-core-design.md`) | Draft | Shared AIProvider interface, co-consumer of mock data |
| Phase 2 All CSS Frameworks (`docs/specs/2026-03-11-phase2-all-css-frameworks-design.md`) | Approved | StyleReadAdapter used by DS Core which consumes mock data |
| Fiber-Based Element Tracing (`docs/specs/2026-03-24-fiber-based-element-tracing.md`) | Draft | Traced elements rendered with mock data for DS validation |
| Self-Improving Templates Research (`docs/specs/2026-04-01-self-improving-templates-research.md`) | Research | Unrelated to mock response templates — covers AI-to-deterministic decision template crystallization shared across the ecosystem |

> **Terminology note:** Smart Mock Server uses its own expression language for response
> templating (Sections 9–10), which is distinct from DS Core's decision template system.
> For the self-improving decision template architecture shared across the ecosystem, see
> `2026-04-01-self-improving-templates-research.md`.

### Key Technical Decisions

| Decision | Rationale | Alternatives considered |
|----------|-----------|----------------------|
| Proxy-based interception (not monkey-patching) | Works with any HTTP client, framework-agnostic | `msw` (requires specific handler setup), `nock` (Node.js only) |
| Faker.js for PII replacement | Deterministic with seeds, locale support, realistic output | Custom generators (more work), AI generation (too slow for masking) |
| JSON snapshot format (default) | Human-readable, diffable in git, easy to edit | HAR (Chrome-compatible but verbose), SQLite (fast but binary) |
| Schema-first generation | Validates output automatically, catches type mismatches | Freeform AI generation (creative but unreliable shapes) |
| Shared AIProvider with DS Core | One adapter implementation, consistent AI behavior | Separate interface (duplicated adapter code) |
| Seeded RNG for edge cases | Reproducible: same seed → same chaos → debuggable | True random (non-reproducible failures) |

### Dependencies

| Dependency | Purpose | Version Strategy |
|-----------|---------|-----------------|
| `@faker-js/faker` | Realistic data generation and PII replacement | Latest stable |
| `hono` | HTTP proxy server | Match project version |
| `zod` | Config and schema validation | Match project version |
| `yaml` | OpenAPI YAML parsing | Latest stable |
| `graphql` | GraphQL introspection query parsing | Latest stable |

---
