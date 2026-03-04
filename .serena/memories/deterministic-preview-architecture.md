# Deterministic Preview Pipeline Architecture

## Overview

The preview pipeline generates `__canvas_preview__.tsx` deterministically (no AI required)
for component previews. AI is used only as fallback when deterministic generation fails,
and for generating `Sample*` exports in component files.

Created in HYP-203. Lives in `lib/preview-generator/`.

---

## lib/preview-generator/ — Core Modules

### scanner.ts

AST-based scanner for component source files (uses `@babel/parser`):

- `extractComponentName(source, fileName)` — finds the main exported component name
- `scanSampleExports(source)` — finds all `export const Sample*` names
- `detectExportStyle(source, name)` — returns `'named' | 'default-named' | 'default-anonymous'`
- `escapeRegex(str)` — utility for safe regex construction

### generator.ts

String-template generator for `__canvas_preview__.tsx`:

- `generatePreviewContent(entries, options?)` — builds the full file content
- Three maps: `componentRegistry`, `sampleRenderMap`, `sampleRenderersMap`
- `callbackStubs` for event handlers (onClick, onChange, etc.)
- `CanvasPreview` component with single/multi mode rendering
- `isNextPagesRouter` option: `useRouter` (pages) vs `URLSearchParams` (universal, default)
- Multi-mode uses `window.parent.__CANVAS_INSTANCES__` for positioned rendering

### preview-file-manager.ts

Orchestrator with `FileIO` abstraction for Node.js / VS Code portability:

- `PreviewFileManager` class — main entry point
  - `getPreviewFilePath()` — detects monorepo (`apps/next/`) vs standard (`src/`)
  - `ensureComponent(paths)` — reads existing preview, merges new components, regenerates
  - `rebuild(paths)` — full regeneration from scratch
  - `buildEntry(path, previewDir)` — reads component, scans exports, computes import path
  - `computeImportPath(path, previewDir)` — async, handles monorepo package imports
  - `getPackageImportPath(path)` — async, reads `package.json` for scoped names (`@acme/ui`)
- `parseExistingPreview(content)` — AST-based parser for existing `__canvas_preview__.tsx`
  Handles both deterministic format (componentRegistry) and server-generated (SampleDefaultMap)
- `isValidTypeScript(code)` — Babel parser validation (sync, static import)
- `PreviewGenerationError` — thrown when no valid components

### sample-ensurer.ts

Generalized sample component ensurer:

- `ensureSample(config)` — checks if `Sample*` export exists, generates via AI callback if missing
- `SampleGeneratorFn` type — `(sourceCode, componentName, sampleName) => Promise<string | null>`
- `validateGeneratedSample(code, sampleName, existingSource)` — validates AI output:
  starts with export/import, no jest/vitest, contains expected export, no duplicates, no self-import
- Works in both server and extension via injectable `generate` callback

### sample-prompt.ts

Shared AI prompt and response extraction (used by server and extension):

- `buildSamplePrompt(sourceCode, sampleName, frameworkInstructions?)` — base prompt with
  requirements, structure rules, container/wrapper handling
- `extractCodeFromAIResponse(raw)` — strips markdown code fences, validates basic structure
- Server adds framework-specific instructions via optional parameter
- Extension uses base prompt without framework detection

### index.ts

Barrel export for all public APIs.

---

## Server Integration

### generatePreview.ts route

- Creates `PreviewFileManager` with `NodeFileIO`
- Calls `ensureComponent(components)` for deterministic generation
- Falls back to `ai-code-generator` if `PreviewGenerationError` (with error logging)
- Preview path detection: `apps/next/` check for monorepo

### parseComponent.ts

- `createServerSampleGenerator(projectPath, workspaceId)` — wraps `generateSampleDefault`
  as `SampleGeneratorFn` for `ensureSample()`
- `generateSampleDefault()` — uses shared `buildSamplePrompt` + `extractCodeFromAIResponse`,
  adds server-specific framework detection via `buildFrameworkInstructions()`
- `detectFramework(projectPath)` — filesystem-based detection (nextjs-app, nextjs-pages,
  react-router, remix, solito, none)
- `buildFrameworkInstructions(frameworkInfo)` — routing examples + framework-specific rules
- Validation delegated to `ensureSample()` → `validateGeneratedSample()` (no duplication)

### ai-config-resolver.ts

- `resolveServerAIConfig(workspaceId)` — resolves DB config to `ResolvedAIConfig`
- Handles proxy provider (litellm Docker container)
- Throws `AppError` for opencode provider (contract: check provider before calling)
- Returns null for missing config / API key

---

## VS Code Extension Integration

### SampleAIGenerator.ts

- `createExtensionSampleGenerator(context)` — creates `SampleGeneratorFn` using extension secrets
- Uses shared `buildSamplePrompt` and `extractCodeFromAIResponse` from lib
- Resolves AI config from VS Code settings (`hypercanvas.ai.*`)
- Returns null on missing API key (silent skip)

### extension.ts

- Uses `PreviewFileManager` with extension's `FileIO` implementation
- Calls `ensureSample()` with extension sample generator
- Cancellation support via AbortController for component switching

---

## lib/ai-client/ — Unified AI Client

- `callAI(config, prompt, options?)` — non-streaming, returns text
- `callAIStream(config, prompt, options?)` — async generator, yields text chunks
- `resolveAIConfig(params)` — normalizes provider settings to `ResolvedAIConfig`
- Supports `provider: 'anthropic' | 'openai'` (OpenAI-compatible: Gemini, DeepSeek, etc.)
- Anthropic client cache: max 8 entries, FIFO eviction

---

## Key Patterns

- **Component map keys**: relative file path (e.g. `'src/components/Button.tsx'`)
- **Import aliases**: `${uniquePrefix}SampleDefault` to avoid collisions (Card vs CardGrid)
- **Sample export convention**: `export const Sample[A-Z][a-zA-Z0-9]*`
- **FileIO abstraction**: `readFile`, `writeFile`, `access` — works in Node.js and VS Code
- **Deterministic-first**: no AI config required for basic preview generation
- **AI as fallback**: only when deterministic fails or for Sample* generation
