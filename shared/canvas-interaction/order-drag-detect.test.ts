/**
 * @file Unit tests for the iframe-side order-driven drag detector.
 *
 * Exercises the pure helpers in `order-drag-detect.ts` against the bulka hero-grid
 * scenario (Tasks 1+2 of `2026-05-08-tw-order-drag-ralphex-plan.md`) plus
 * representative edge cases: missing breakpoints, no-op drops, fragment siblings.
 */

import { describe, expect, it } from 'bun:test';
import {
  computeOrderWritePlan,
  findOrderBreakpointsInClassName,
  pickActiveBreakpoint,
  type SiblingInfo,
} from './order-drag-detect';

describe('findOrderBreakpointsInClassName', () => {
  it('returns base breakpoint as undefined', () => {
    expect(findOrderBreakpointsInClassName('flex order-1 p-4')).toEqual([undefined]);
  });

  it('extracts md / lg variants', () => {
    expect(findOrderBreakpointsInClassName('order-1 md:order-3 lg:order-5 flex')).toEqual([undefined, 'md', 'lg']);
  });

  it('returns empty array when no order class present', () => {
    expect(findOrderBreakpointsInClassName('flex p-4 grid')).toEqual([]);
  });

  it('handles undefined / empty input', () => {
    expect(findOrderBreakpointsInClassName(undefined)).toEqual([]);
    expect(findOrderBreakpointsInClassName('')).toEqual([]);
  });

  it('matches arbitrary value variants', () => {
    expect(findOrderBreakpointsInClassName('order-[7] md:order-[3]')).toEqual([undefined, 'md']);
  });
});

describe('pickActiveBreakpoint', () => {
  it('picks the largest active breakpoint that is also in use', () => {
    expect(pickActiveBreakpoint(new Set([undefined, 'md', 'lg']), 1440)).toBe('lg');
  });

  it('falls back to base when no named variant active', () => {
    expect(pickActiveBreakpoint(new Set([undefined, 'md']), 500)).toBeUndefined();
  });

  it('returns null when neither base nor any active bp is in use', () => {
    expect(pickActiveBreakpoint(new Set(['md']), 500)).toBeNull();
  });

  it('skips named variants that exceed viewport', () => {
    expect(pickActiveBreakpoint(new Set([undefined, 'md', 'xl']), 1100)).toBe('md');
  });

  it('threshold is inclusive (md = 768 selects md at exactly 768)', () => {
    expect(pickActiveBreakpoint(new Set([undefined, 'md']), 768)).toBe('md');
    expect(pickActiveBreakpoint(new Set([undefined, 'md']), 767)).toBeUndefined();
  });
});

describe('computeOrderWritePlan — bulka hero (base viewport, Task 1)', () => {
  // Scenario: parent has two children with `order-N md:order-M` classes.
  // Visual at base: image (order-1, top), text (order-2, bottom).
  // Drag image onto text → image should become order-2, text should become order-1.
  const siblings: SiblingInfo[] = [
    {
      elementId: 'pages/Index.tsx:533:5',
      filePath: 'pages/Index.tsx',
      className: 'order-1 md:order-2 flex flex-col gap-6',
      domIndex: 0,
    },
    {
      elementId: 'pages/Index.tsx:540:5',
      filePath: 'pages/Index.tsx',
      className: 'order-2 md:order-1 flex flex-col gap-4',
      domIndex: 1,
    },
  ];

  it('swaps base order-N when active breakpoint is base', () => {
    const plan = computeOrderWritePlan(
      siblings,
      'pages/Index.tsx:533:5',
      'pages/Index.tsx:540:5',
      'after',
      375, // narrow viewport — md not active
    );

    expect(plan).not.toBeNull();
    expect(plan?.breakpoint).toBeUndefined();
    expect(plan?.entries).toEqual([
      // Visual after the swap: [text (was order-2 → now order-1), image (was order-1 → now order-2)]
      {
        elementId: 'pages/Index.tsx:540:5',
        filePath: 'pages/Index.tsx',
        newClassName: 'order-1 md:order-1 flex flex-col gap-4',
      },
      {
        elementId: 'pages/Index.tsx:533:5',
        filePath: 'pages/Index.tsx',
        newClassName: 'order-2 md:order-2 flex flex-col gap-6',
      },
    ]);
  });

  it('preserves md: variants when writing base', () => {
    const plan = computeOrderWritePlan(siblings, 'pages/Index.tsx:533:5', 'pages/Index.tsx:540:5', 'after', 375);
    // md:order-2 / md:order-1 must survive in both entries.
    expect(plan?.entries[0].newClassName).toContain('md:order-1');
    expect(plan?.entries[1].newClassName).toContain('md:order-2');
  });
});

describe('computeOrderWritePlan — bulka hero (md viewport, Task 2)', () => {
  // Same fixture as Task 1. At md+ viewport visual order is [text (md:order-1), image (md:order-2)].
  // Drag image onto text → image should become md:order-1, text should become md:order-2.
  const siblings: SiblingInfo[] = [
    {
      elementId: 'pages/Index.tsx:533:5',
      filePath: 'pages/Index.tsx',
      className: 'order-1 md:order-2 flex flex-col gap-6',
      domIndex: 0,
    },
    {
      elementId: 'pages/Index.tsx:540:5',
      filePath: 'pages/Index.tsx',
      className: 'order-2 md:order-1 flex flex-col gap-4',
      domIndex: 1,
    },
  ];

  it('swaps md:order when active breakpoint is md', () => {
    const plan = computeOrderWritePlan(siblings, 'pages/Index.tsx:533:5', 'pages/Index.tsx:540:5', 'before', 1440);

    expect(plan).not.toBeNull();
    expect(plan?.breakpoint).toBe('md');
    // Visual at md was [text (md:order-1), image (md:order-2)].
    // Inserting image BEFORE text → [image, text]. Renumber md: image=1, text=2.
    expect(plan?.entries).toEqual([
      {
        elementId: 'pages/Index.tsx:533:5',
        filePath: 'pages/Index.tsx',
        newClassName: 'order-1 md:order-1 flex flex-col gap-6',
      },
      {
        elementId: 'pages/Index.tsx:540:5',
        filePath: 'pages/Index.tsx',
        newClassName: 'order-2 md:order-2 flex flex-col gap-4',
      },
    ]);
  });

  it('does not touch base order-* when writing md', () => {
    const plan = computeOrderWritePlan(siblings, 'pages/Index.tsx:533:5', 'pages/Index.tsx:540:5', 'before', 1440);
    // Base order-1 / order-2 must survive in both entries.
    expect(plan?.entries[0].newClassName.startsWith('order-1 ')).toBe(true);
    expect(plan?.entries[1].newClassName.startsWith('order-2 ')).toBe(true);
  });
});

describe('computeOrderWritePlan — fallthrough cases', () => {
  it('returns null when no sibling has any order class', () => {
    const siblings: SiblingInfo[] = [
      { elementId: 'a:1:1', filePath: 'a.tsx', className: 'flex p-4', domIndex: 0 },
      { elementId: 'b:1:1', filePath: 'a.tsx', className: 'grid gap-4', domIndex: 1 },
    ];
    expect(computeOrderWritePlan(siblings, 'a:1:1', 'b:1:1', 'after', 1440)).toBeNull();
  });

  it('returns null when only one sibling exists', () => {
    const siblings: SiblingInfo[] = [{ elementId: 'a:1:1', filePath: 'a.tsx', className: 'order-1', domIndex: 0 }];
    expect(computeOrderWritePlan(siblings, 'a:1:1', 'a:1:1', 'after', 1440)).toBeNull();
  });

  it('returns null when source is not in siblings (cross-parent drag)', () => {
    const siblings: SiblingInfo[] = [
      { elementId: 'a:1:1', filePath: 'a.tsx', className: 'order-1', domIndex: 0 },
      { elementId: 'b:1:1', filePath: 'a.tsx', className: 'order-2', domIndex: 1 },
    ];
    expect(computeOrderWritePlan(siblings, 'foreign:1:1', 'a:1:1', 'after', 1440)).toBeNull();
  });

  it('returns null when only md:order-* exists but md viewport not active', () => {
    const siblings: SiblingInfo[] = [
      { elementId: 'a:1:1', filePath: 'a.tsx', className: 'md:order-1 flex', domIndex: 0 },
      { elementId: 'b:1:1', filePath: 'a.tsx', className: 'md:order-2 flex', domIndex: 1 },
    ];
    // Narrow viewport → md not active, no base order in use → null.
    expect(computeOrderWritePlan(siblings, 'a:1:1', 'b:1:1', 'after', 500)).toBeNull();
  });

  it('returns null on no-op drop (move source to its current visual slot)', () => {
    const siblings: SiblingInfo[] = [
      { elementId: 'a:1:1', filePath: 'a.tsx', className: 'order-1 flex', domIndex: 0 },
      { elementId: 'b:1:1', filePath: 'a.tsx', className: 'order-2 flex', domIndex: 1 },
    ];
    // Drop a "before" b — but a is already before b at the active base breakpoint.
    // After the move and renumber, classNames would be: a → order-1, b → order-2 (unchanged).
    expect(computeOrderWritePlan(siblings, 'a:1:1', 'b:1:1', 'before', 500)).toBeNull();
  });

  it('renumbers densely 1..N for three siblings, only writing the changed entries', () => {
    const siblings: SiblingInfo[] = [
      { elementId: 'a:1:1', filePath: 'a.tsx', className: 'order-1', domIndex: 0 },
      { elementId: 'b:1:1', filePath: 'a.tsx', className: 'order-2', domIndex: 1 },
      { elementId: 'c:1:1', filePath: 'a.tsx', className: 'order-3', domIndex: 2 },
    ];
    // Move a to after b → visual [b, a, c]. Renumber: b=1, a=2, c=3.
    // a was 1 → 2 (changed); b was 2 → 1 (changed); c was 3 → 3 (no change, skip).
    const plan = computeOrderWritePlan(siblings, 'a:1:1', 'b:1:1', 'after', 500);
    expect(plan?.breakpoint).toBeUndefined();
    expect(plan?.entries).toEqual([
      { elementId: 'b:1:1', filePath: 'a.tsx', newClassName: 'order-1' },
      { elementId: 'a:1:1', filePath: 'a.tsx', newClassName: 'order-2' },
    ]);
  });

  it('returns null when source and target elementIds are equal (drop on self)', () => {
    const siblings: SiblingInfo[] = [
      { elementId: 'a:1:1', filePath: 'a.tsx', className: 'order-1', domIndex: 0 },
      { elementId: 'b:1:1', filePath: 'a.tsx', className: 'order-2', domIndex: 1 },
    ];
    expect(computeOrderWritePlan(siblings, 'a:1:1', 'a:1:1', 'after', 500)).toBeNull();
    expect(computeOrderWritePlan(siblings, 'a:1:1', 'a:1:1', 'before', 500)).toBeNull();
  });

  it('returns null when sibling list contains duplicate elementIds (e.g. .map() rows)', () => {
    // Repeated-instance host: every iteration of `{items.map(item => <Card .../>)}`
    // yields the same source location. Renumbering by elementId would pick the
    // first occurrence and rewrite the wrong row. Plan must defer to AST move.
    const siblings: SiblingInfo[] = [
      { elementId: 'card:10:5', filePath: 'a.tsx', className: 'order-1', domIndex: 0 },
      { elementId: 'card:10:5', filePath: 'a.tsx', className: 'order-2', domIndex: 1 },
      { elementId: 'card:10:5', filePath: 'a.tsx', className: 'order-3', domIndex: 2 },
    ];
    expect(computeOrderWritePlan(siblings, 'card:10:5', 'card:10:5', 'after', 500)).toBeNull();
  });

  it('uses DOM index as tiebreaker when two siblings share the same effective order value', () => {
    const siblings: SiblingInfo[] = [
      { elementId: 'a:1:1', filePath: 'a.tsx', className: 'flex', domIndex: 0 },
      { elementId: 'b:1:1', filePath: 'a.tsx', className: 'flex', domIndex: 1 },
      { elementId: 'c:1:1', filePath: 'a.tsx', className: 'order-2', domIndex: 2 },
    ];
    // Visual at base: a (0, dom 0), b (0, dom 1), c (2). DOM index breaks the a/b tie.
    // Drag c before a → visual [c, a, b]. Renumber: c=1, a=2, b=3.
    const plan = computeOrderWritePlan(siblings, 'c:1:1', 'a:1:1', 'before', 500);
    expect(plan?.entries).toEqual([
      { elementId: 'c:1:1', filePath: 'a.tsx', newClassName: 'order-1' },
      { elementId: 'a:1:1', filePath: 'a.tsx', newClassName: 'flex order-2' },
      { elementId: 'b:1:1', filePath: 'a.tsx', newClassName: 'flex order-3' },
    ]);
  });
});

describe('computeOrderWritePlan — default-order item gets correct visual slot (Task 1)', () => {
  // Codex finding 1 repro: parent has `order-2`, no-order, `order-3`.
  // CSS default `order` is 0 → no-order child must sort BEFORE `order-2`,
  // not after. Current main treats missing as null → sorted last → bug.
  const siblings: SiblingInfo[] = [
    { elementId: 'a:1:1', filePath: 'a.tsx', className: 'order-2', domIndex: 0 },
    { elementId: 'b:1:1', filePath: 'a.tsx', className: '', domIndex: 1 },
    { elementId: 'c:1:1', filePath: 'a.tsx', className: 'order-3', domIndex: 2 },
  ];

  it('places no-order sibling first (treats missing class as order: 0)', () => {
    // Correct visual: [B (0), A (2), C (3)]. Drop C before B → visual [C, B, A].
    // Renumber: C=1, B=2, A=3.
    const plan = computeOrderWritePlan(siblings, 'c:1:1', 'b:1:1', 'before', 500);
    expect(plan).not.toBeNull();
    expect(plan?.breakpoint).toBeUndefined();
    expect(plan?.entries).toEqual([
      { elementId: 'c:1:1', filePath: 'a.tsx', newClassName: 'order-1' },
      { elementId: 'b:1:1', filePath: 'a.tsx', newClassName: 'order-2' },
      { elementId: 'a:1:1', filePath: 'a.tsx', newClassName: 'order-3' },
    ]);
  });

  it('treats `order-first` as the leftmost slot', () => {
    const fixt: SiblingInfo[] = [
      { elementId: 'a:1:1', filePath: 'a.tsx', className: 'order-2', domIndex: 0 },
      { elementId: 'b:1:1', filePath: 'a.tsx', className: 'order-first', domIndex: 1 },
      { elementId: 'c:1:1', filePath: 'a.tsx', className: 'order-3', domIndex: 2 },
    ];
    // Visual: [B (-9999), A (2), C (3)]. Drop A after C → visual [B, C, A].
    // Renumber: B=1, C=2, A=3. B was order-first → order-1 (changed).
    const plan = computeOrderWritePlan(fixt, 'a:1:1', 'c:1:1', 'after', 500);
    expect(plan).not.toBeNull();
    expect(plan?.entries).toEqual([
      { elementId: 'b:1:1', filePath: 'a.tsx', newClassName: 'order-1' },
      { elementId: 'c:1:1', filePath: 'a.tsx', newClassName: 'order-2' },
      { elementId: 'a:1:1', filePath: 'a.tsx', newClassName: 'order-3' },
    ]);
  });

  it('treats `order-last` as the rightmost slot', () => {
    const fixt: SiblingInfo[] = [
      { elementId: 'a:1:1', filePath: 'a.tsx', className: 'order-last', domIndex: 0 },
      { elementId: 'b:1:1', filePath: 'a.tsx', className: 'order-2', domIndex: 1 },
      { elementId: 'c:1:1', filePath: 'a.tsx', className: 'order-3', domIndex: 2 },
    ];
    // Visual: [B (2), C (3), A (9999)]. Drop B before A → visual [C, B, A].
    // Renumber: C=1, B=2, A=3. B unchanged (order-2).
    const plan = computeOrderWritePlan(fixt, 'b:1:1', 'a:1:1', 'before', 500);
    expect(plan).not.toBeNull();
    expect(plan?.entries).toEqual([
      { elementId: 'c:1:1', filePath: 'a.tsx', newClassName: 'order-1' },
      { elementId: 'a:1:1', filePath: 'a.tsx', newClassName: 'order-3' },
    ]);
  });

  it('treats `order-none` as default 0', () => {
    const fixt: SiblingInfo[] = [
      { elementId: 'a:1:1', filePath: 'a.tsx', className: 'order-2', domIndex: 0 },
      { elementId: 'b:1:1', filePath: 'a.tsx', className: 'order-none', domIndex: 1 },
    ];
    // Visual: [B (0), A (2)]. Drop A before B → visual [A, B]. Renumber: A=1, B=2.
    const plan = computeOrderWritePlan(fixt, 'a:1:1', 'b:1:1', 'before', 500);
    expect(plan).not.toBeNull();
    expect(plan?.entries).toEqual([
      { elementId: 'a:1:1', filePath: 'a.tsx', newClassName: 'order-1' },
      { elementId: 'b:1:1', filePath: 'a.tsx', newClassName: 'order-2' },
    ]);
  });
});
