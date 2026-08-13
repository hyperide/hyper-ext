> **Companion to the master styles spec** (./2026-06-12-styles-system-master-spec.md). Still authoritative for the Phase 3–4 adapter implementation plan; cross-reference Part 3.3.
>
> **Consolidation update (HYP-722, D5 status-mark):** of the 12 typed `CssSystemId`s, four adapters
> are BUILT — `tailwind-v4`, `css-modules`, `inline`, `tamagui` (WORKS); the other eight are PLANNED
> (HYP-606/607/608/600). The master §3.3 owns the taxonomy + status; this plan stays the build tracker
> for the unbuilt remainder.

<!-- markdownlint-disable MD013 -->

# Style Adapters Phase 3+4 — Implementation Plan

> **Historical implementation plan:** Claude Code agents may use the referenced
> superpowers workflow. Codex agents must follow `CODEX.md` and `AGENTS.md`
> instead: no self-invoked `codex exec review`; use staged-diff self-review.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first two concrete `FrameworkStyleAdapter` implementations — TailwindV4Adapter and InlineStyleAdapter — that produce `StyleWritePlan` objects from the Phase 1+2 type system.

**Architecture:** New adapters live in `lib/style-adapters/` as standalone modules. They implement `FrameworkStyleAdapter` from `lib/style-write/types.ts`, produce `TailwindPlan` / `ScriptObjectStylePlan` write plans, and use `InspectorValueCodec` for input normalization. They do NOT yet replace the legacy `client/lib/canvas-engine/adapters/` — wiring happens in Phase 6.

**Tech Stack:** TypeScript, bun:test

**Depends on:** `lib/style-read/types.ts`, `lib/style-write/types.ts`, `lib/style-values/inspector-value-codec.ts`, `lib/tailwind/generator.ts`

---

## File Structure

```text
lib/style-adapters/
  tailwind-v4/
    index.ts                  # TailwindV4Adapter — FrameworkStyleAdapter umbrella
    reader.ts                 # Read className → StyleSourceOwner[]
    writer.ts                 # Canonical inspector value → TailwindPlan
    index.test.ts             # Integration tests
  inline-style/
    index.ts                  # InlineStyleAdapter — FrameworkStyleAdapter umbrella
    reader.ts                 # Read style={{}} → StyleSourceOwner[]
    writer.ts                 # Canonical inspector value → ScriptObjectStylePlan
    index.test.ts             # Integration tests
```

---

## Task 1: Create TailwindV4Adapter writer

The writer takes canonical inspector values and produces a `TailwindPlan`. It wraps the existing `generateTailwindClasses()` and `getConflictingPrefixesForProperty()` from `lib/tailwind/generator.ts`.

**Files:**

- Create: `lib/style-adapters/tailwind-v4/writer.ts`
- Test: `lib/style-adapters/tailwind-v4/writer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// lib/style-adapters/tailwind-v4/writer.test.ts
import { describe, expect, it } from 'bun:test';
import { TailwindV4Writer } from './writer';

describe('TailwindV4Writer', () => {
  const writer = new TailwindV4Writer();

  describe('createPlan', () => {
    const baseContext = {
      projectCapabilities: {
        projectCssSystems: ['tailwind-v4' as const],
        projectUiKits: [],
        componentPropMappers: [],
        cssSyntaxes: ['css' as const],
        projectThemeCapabilities: { axes: [], mechanisms: [], tokenSources: [] },
        packageEvidence: [],
        configEvidence: [],
        sourceEvidence: [],
      },
      elementFacts: {
        elementCssSystems: ['tailwind-v4' as const],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [],
      },
      runtimeThemeContext: {
        ideThemePreference: 'light' as const,
        resolvedColorScheme: 'light' as const,
        source: 'test-fixture' as const,
      },
      condition: { state: 'base' as const },
      requestedStyles: { paddingLeft: '16' },
    };

    const baseOwner = {
      cssSystem: 'tailwind-v4' as const,
      sourceForm: 'elementClass' as const,
      filePath: 'src/App.tsx',
      property: 'padding-left',
      condition: { state: 'base' as const },
      confidence: 'exact' as const,
    };

    it('produces TailwindPlan with static strategy for simple values', () => {
      const plan = writer.createPlan({
        context: baseContext,
        sourceOwner: baseOwner,
      });
      expect(plan.sourceForm).toBe('elementClass');
      expect(plan.cssSystem).toBe('tailwind-v4');
      expect(plan.strategy.mode).toBe('static');
      expect(plan.strategy.addClasses).toContain('pl-');
      expect(plan.strategy.removeForProperties).toContain('paddingLeft');
    });

    it('converts inspector opacity 50 to Tailwind opacity-50', () => {
      const plan = writer.createPlan({
        context: { ...baseContext, requestedStyles: { opacity: '50' } },
        sourceOwner: { ...baseOwner, property: 'opacity' },
      });
      expect(plan.strategy.addClasses).toContain('opacity-');
      expect(plan.targetStyles.opacity).toBe('50');
    });

    it('converts inspector backgroundColor to Tailwind bg class', () => {
      const plan = writer.createPlan({
        context: { ...baseContext, requestedStyles: { backgroundColor: '#4285f4' } },
        sourceOwner: { ...baseOwner, property: 'background-color' },
      });
      expect(plan.strategy.addClasses).toContain('bg-');
    });

    it('includes state prefix for hover condition', () => {
      const plan = writer.createPlan({
        context: {
          ...baseContext,
          condition: { state: 'hover' },
          requestedStyles: { backgroundColor: '#ef4444' },
        },
        sourceOwner: { ...baseOwner, property: 'background-color', condition: { state: 'hover' } },
      });
      expect(plan.strategy.addClasses).toContain('hover:');
      expect(plan.condition.state).toBe('hover');
    });

    it('sets correct removeForProperties', () => {
      const plan = writer.createPlan({
        context: {
          ...baseContext,
          requestedStyles: { paddingLeft: '16', paddingRight: '16' },
        },
        sourceOwner: baseOwner,
      });
      expect(plan.strategy.removeForProperties).toContain('paddingLeft');
      expect(plan.strategy.removeForProperties).toContain('paddingRight');
    });

    it('produces empty addClasses for empty value (remove)', () => {
      const plan = writer.createPlan({
        context: { ...baseContext, requestedStyles: { paddingLeft: '' } },
        sourceOwner: baseOwner,
      });
      expect(plan.strategy.addClasses).toBe('');
      expect(plan.strategy.removeForProperties).toContain('paddingLeft');
    });
  });
});
```

- [ ] **Step 2: Run test — verify it fails (module not found)**
- [ ] **Step 3: Implement TailwindV4Writer**

Key logic:

- Takes canonical inspector values from `context.requestedStyles`
- Calls `generateTailwindClasses(requestedStyles, statePrefix)` from `lib/tailwind/generator.ts`
- Calls `getConflictingPrefixesForProperty()` for each key to build `removeForProperties`
- Maps state from `context.condition.state` to Tailwind prefix ('hover' → 'hover:', 'base' → undefined)
- Returns `TailwindPlan` with `strategy.mode: 'static'`
- `targetStyles` = same as `requestedStyles` (Tailwind uses inspector values directly)

- [ ] **Step 4: Run test — verify it passes**
- [ ] **Step 5: Commit** `feat(style-adapters): add TailwindV4Writer producing TailwindPlan from inspector values`

---

## Task 2: Create TailwindV4Adapter umbrella

Wire reader + writer into the `FrameworkStyleAdapter` interface.

**Files:**

- Create: `lib/style-adapters/tailwind-v4/reader.ts`
- Create: `lib/style-adapters/tailwind-v4/index.ts`
- Test: `lib/style-adapters/tailwind-v4/index.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// lib/style-adapters/tailwind-v4/index.test.ts
import { describe, expect, it } from 'bun:test';
import { tailwindV4Adapter } from './index';

describe('TailwindV4Adapter', () => {
  it('has id tailwind-v4', () => {
    expect(tailwindV4Adapter.id).toBe('tailwind-v4');
  });

  it('has writer', () => {
    expect(tailwindV4Adapter.writer).toBeDefined();
  });

  it('has reader', () => {
    expect(tailwindV4Adapter.reader).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**
- [ ] **Step 3: Implement reader.ts (minimal) and index.ts (umbrella)**

Reader: minimal implementation that returns empty `StyleSourceOwner[]` for now — full read path is Phase 7.

Index: creates `FrameworkStyleAdapter` with `id: 'tailwind-v4'`, wires reader + writer.

- [ ] **Step 4: Run test — verify it passes**
- [ ] **Step 5: Commit** `feat(style-adapters): add TailwindV4Adapter umbrella with reader and writer`

---

## Task 3: Create InlineStyleAdapter writer

The writer takes canonical inspector values and produces a `ScriptObjectStylePlan` for `style={{}}` writes. It converts inspector values to CSS target values (opacity 50 → 0.5, length 16 → '16px') using `CssRuntimeNormalizer`.

**Files:**

- Create: `lib/style-adapters/inline-style/writer.ts`
- Test: `lib/style-adapters/inline-style/writer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// lib/style-adapters/inline-style/writer.test.ts
import { describe, expect, it } from 'bun:test';
import { InlineStyleWriter } from './writer';

describe('InlineStyleWriter', () => {
  const writer = new InlineStyleWriter();

  // same baseContext/baseOwner pattern as TailwindV4Writer tests
  // but with cssSystem: 'inline-style', sourceForm: 'scriptReactStyleRule'

  it('produces ScriptObjectStylePlan', () => {
    // plan.sourceForm === 'scriptReactStyleRule'
    // plan.cssSystem === 'inline-style'
  });

  it('converts inspector opacity 50 to CSS 0.5', () => {
    // targetStyles.opacity === '0.5'
  });

  it('converts inspector paddingLeft 16 to CSS 16px', () => {
    // targetStyles.paddingLeft === '16px'
  });

  it('passes through color values unchanged', () => {
    // targetStyles.backgroundColor === '#4285f4'
  });

  it('sets mergeMode to object', () => {
    // plan.target.mergeMode === 'object'
  });

  it('handles empty value as remove', () => {
    // targetStyles is empty, plan still valid
  });
});
```

- [ ] **Step 2: Run test — verify it fails**
- [ ] **Step 3: Implement InlineStyleWriter**

Key logic:

- Takes canonical inspector values, converts each to CSS target value:
  - opacity: divide by 100 → string (e.g., "50" → "0.5")
  - lengths: pass through CssRuntimeNormalizer (appends px to bare numbers)
  - colors: passthrough
  - keywords: passthrough
- Returns `ScriptObjectStylePlan` with `cssSystem: 'inline-style'`, `mergeMode: 'object'`

- [ ] **Step 4: Run test — verify it passes**
- [ ] **Step 5: Commit** `feat(style-adapters): add InlineStyleWriter producing ScriptObjectStylePlan`

---

## Task 4: Create InlineStyleAdapter umbrella

**Files:**

- Create: `lib/style-adapters/inline-style/reader.ts`
- Create: `lib/style-adapters/inline-style/index.ts`
- Test: `lib/style-adapters/inline-style/index.test.ts`

- [ ] **Step 1-5:** Same pattern as Task 2 but for inline-style adapter.

Commit: `feat(style-adapters): add InlineStyleAdapter umbrella with reader and writer`

---

## Task 5: Verify all tests pass

- [ ] Run `bun run test lib/style-adapters/`
- [ ] Run `bun run test` (full suite)
- [ ] Run `npx tsc --noEmit`
- [ ] Run `biome check lib/style-adapters/`
