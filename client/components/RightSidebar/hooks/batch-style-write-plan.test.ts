/**
 * @file Unit tests for the D2 frozen BatchStyleWritePlan builder + stale guard + dedupe
 *
 * Accessed via: useStyleSync builds one frozen plan per batch gesture; the host applies exactly it.
 * Architecture: docs/specs/2026-06-11-270-d2-source-routing.md §5
 */

import { describe, expect, it } from 'bun:test';
import { buildBatchStyleWritePlan, type BatchPlanElement, isPlanStale } from './batch-style-write-plan';

function el(partial: Partial<BatchPlanElement> & Pick<BatchPlanElement, 'elementId'>): BatchPlanElement {
  return {
    filePath: 'src/Card.tsx',
    elementRef: `ref:${partial.elementId}`,
    route: { cssSystem: 'tailwind-v4', channel: 'styles' },
    ...partial,
  };
}

const READ = {
  requestId: 'req-1',
  sequence: 1,
  selectionRevision: 7,
  sourceSnapshot: new Map([['src/Card.tsx', 'snap-a']]),
  condition: { state: 'base' as const },
  routingMode: 'auto' as const,
};

describe('buildBatchStyleWritePlan', () => {
  it('produces one planned entry per element with the shared property/value', () => {
    const plan = buildBatchStyleWritePlan({
      ...READ,
      elements: [el({ elementId: 'a' }), el({ elementId: 'b' })],
      property: 'color',
      newValue: 'red',
    });
    expect(plan.entries).toHaveLength(2);
    expect(plan.entries.every((e) => e.status === 'planned')).toBe(true);
    expect(plan.entries[0]).toMatchObject({ elementId: 'a', property: 'color', newValue: 'red' });
  });

  it('marks an element with a null route as skipped with NO_WRITABLE_TARGET', () => {
    const plan = buildBatchStyleWritePlan({
      ...READ,
      elements: [el({ elementId: 'a' }), el({ elementId: 'b', route: null, skipReason: 'NO_WRITABLE_TARGET' })],
      property: 'color',
      newValue: 'red',
    });
    const b = plan.entries.find((e) => e.elementId === 'b');
    expect(b?.status).toBe('skipped');
    expect(b?.skipReason).toBe('NO_WRITABLE_TARGET');
    expect(b?.route).toBeNull();
  });

  it('dedupes elements that resolve to the same (filePath, elementRef) source node', () => {
    // Two rendered instances of one items.map(...) source element collapse to one mutation.
    const plan = buildBatchStyleWritePlan({
      ...READ,
      elements: [
        el({ elementId: 'a', elementRef: 'src/Card.tsx:10:4' }),
        el({ elementId: 'b', elementRef: 'src/Card.tsx:10:4' }),
      ],
      property: 'color',
      newValue: 'red',
    });
    const planned = plan.entries.filter((e) => e.status === 'planned');
    expect(planned).toHaveLength(1);
  });

  it('freezes the plan so it cannot be re-routed after construction', () => {
    const plan = buildBatchStyleWritePlan({
      ...READ,
      elements: [el({ elementId: 'a' })],
      property: 'color',
      newValue: 'red',
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.entries)).toBe(true);
    expect(() => {
      // @ts-expect-error — runtime mutation must throw in strict mode / be a no-op when frozen.
      plan.routingMode = 'override';
    }).toThrow();
  });
});

describe('isPlanStale', () => {
  const plan = buildBatchStyleWritePlan({
    ...READ,
    elements: [el({ elementId: 'a' })],
    property: 'color',
    newValue: 'red',
  });

  it('is fresh when selectionRevision and snapshots are unchanged', () => {
    expect(isPlanStale(plan, { selectionRevision: 7, sourceSnapshot: new Map([['src/Card.tsx', 'snap-a']]) })).toBe(
      false,
    );
  });

  it('is stale when selectionRevision changed', () => {
    expect(isPlanStale(plan, { selectionRevision: 8, sourceSnapshot: new Map([['src/Card.tsx', 'snap-a']]) })).toBe(
      true,
    );
  });

  it('is stale when a touched file snapshot changed', () => {
    expect(isPlanStale(plan, { selectionRevision: 7, sourceSnapshot: new Map([['src/Card.tsx', 'snap-b']]) })).toBe(
      true,
    );
  });

  it('is stale when a touched file snapshot is missing from current state', () => {
    expect(isPlanStale(plan, { selectionRevision: 7, sourceSnapshot: new Map() })).toBe(true);
  });

  it('snapshots a defensive copy — mutating the input map after build cannot defeat the guard', () => {
    const liveSnapshot = new Map([['src/Card.tsx', 'snap-a']]);
    const p = buildBatchStyleWritePlan({
      ...READ,
      sourceSnapshot: liveSnapshot,
      elements: [el({ elementId: 'a' })],
      property: 'color',
      newValue: 'red',
    });
    // Caller mutates the original map after the plan was frozen.
    liveSnapshot.set('src/Card.tsx', 'snap-b');
    // The plan still holds snap-a, so a current state at snap-b is correctly detected as stale.
    expect(isPlanStale(p, { selectionRevision: 7, sourceSnapshot: new Map([['src/Card.tsx', 'snap-b']]) })).toBe(true);
  });
});
