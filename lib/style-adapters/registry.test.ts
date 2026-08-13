/**
 * @file Tests for the style-adapter registry — the single source of truth behind the writable gate
 *
 * Accessed via: bun test lib/style-adapters/registry.test.ts
 * Spec §3.3 (Adapters — System B): only four adapters have a working writer
 * (tailwind-v4 / css-modules / tamagui / inline-style); the inline-style floor (§8.3) is excluded
 * from the NATIVE writer-backed set. Proves the registry-derived gate reports emotion/styled-
 * components NOT-writable (no adapter), the root fix for the silent-inline-pollution / unsupported()
 * bugs (HYP-796).
 */
import type { CssSystemId } from '@lib/style-read/types';
import type { FrameworkStyleAdapter, FrameworkStyleWriter, StyleWritePlan } from '@lib/style-write/types';
import { describe, expect, it } from 'bun:test';
import { DEFAULT_STYLE_ADAPTERS, getWriterBackedCssSystemIds, INLINE_FALLBACK_ADAPTER_ID } from './registry';

const stubWriter: FrameworkStyleWriter = {
  createPlan: () => ({}) as StyleWritePlan,
};

describe('getWriterBackedCssSystemIds — default registry', () => {
  it('returns exactly the native (non-fallback) writers: tailwind-v4, css-modules, tamagui', () => {
    const ids = getWriterBackedCssSystemIds();
    expect([...ids].sort()).toEqual(['css-modules', 'tailwind-v4', 'tamagui']);
  });

  it('excludes the inline-style fallback even though it has a writer (§8.3 base-state floor)', () => {
    // Inline-style IS registered with a writer (it is the universal floor), but counting it would
    // make every system "writable" via the floor — precisely the emotion bug. It must be excluded.
    const inlineAdapter = DEFAULT_STYLE_ADAPTERS.find((a) => a.id === INLINE_FALLBACK_ADAPTER_ID);
    expect(inlineAdapter?.writer).toBeDefined();
    expect(getWriterBackedCssSystemIds().has('inline-style')).toBe(false);
  });

  it('reports emotion NOT writer-backed (no adapter → no silent inline pollution)', () => {
    expect(getWriterBackedCssSystemIds().has('emotion')).toBe(false);
  });

  it('reports styled-components NOT writer-backed (no adapter → no unsupported() dead-click)', () => {
    expect(getWriterBackedCssSystemIds().has('styled-components')).toBe(false);
  });

  it('reports the other typed-but-unbuilt systems NOT writer-backed (§3.3 / D31)', () => {
    const ids = getWriterBackedCssSystemIds();
    for (const unbuilt of ['mui-system', 'chakra-ui', 'mantine', 'vanilla-extract', 'plain-css', 'tailwind-v3']) {
      expect(ids.has(unbuilt as CssSystemId)).toBe(false);
    }
  });
});

describe('getWriterBackedCssSystemIds — derivation is registry-driven, not hardcoded', () => {
  it('adds a system once an adapter with a writer is registered (proves derivation)', () => {
    const emotionAdapter: FrameworkStyleAdapter = { id: 'emotion', writer: stubWriter };
    const ids = getWriterBackedCssSystemIds([...DEFAULT_STYLE_ADAPTERS, emotionAdapter]);
    // The gate flips emotion writable the moment its writer exists — no list edit needed.
    expect(ids.has('emotion')).toBe(true);
  });

  it('a reader-only adapter (no writer) is NOT writer-backed', () => {
    const readerOnly: FrameworkStyleAdapter = { id: 'mui-system', reader: { read: () => ({}) as never } };
    expect(getWriterBackedCssSystemIds([...DEFAULT_STYLE_ADAPTERS, readerOnly]).has('mui-system')).toBe(false);
  });

  it('still excludes inline-style even in a custom adapter list', () => {
    const onlyInline: FrameworkStyleAdapter[] = [{ id: 'inline-style', writer: stubWriter }];
    expect(getWriterBackedCssSystemIds(onlyInline).size).toBe(0);
  });
});
