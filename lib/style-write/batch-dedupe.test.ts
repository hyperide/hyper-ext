/**
 * @file Unit tests for the shared same-source dedupe (D2 §5.4)
 *
 * Accessed via: the live server batch route AND the frozen BatchStyleWritePlan builder both call
 *   dedupeBySameSource — this is the one definition of "same source node" they must agree on.
 * Architecture: docs/specs/2026-06-11-270-d2-source-routing.md §5.4
 */

import { describe, expect, it } from 'bun:test';
import { dedupeBySameSource, sameSourceKey } from './batch-dedupe';

describe('sameSourceKey', () => {
  it('is file-scoped so the same ref in two files does not collide', () => {
    expect(sameSourceKey({ filePath: 'a.tsx', sourceRef: '10:4' })).not.toBe(
      sameSourceKey({ filePath: 'b.tsx', sourceRef: '10:4' }),
    );
  });

  it('is stable for the same (filePath, sourceRef)', () => {
    expect(sameSourceKey({ filePath: 'a.tsx', sourceRef: '10:4' })).toBe(
      sameSourceKey({ filePath: 'a.tsx', sourceRef: '10:4' }),
    );
  });
});

describe('dedupeBySameSource', () => {
  it('collapses repeated (filePath, sourceRef) entries to the first occurrence', () => {
    const out = dedupeBySameSource([
      { filePath: 'Card.tsx', sourceRef: '10:4', id: 'a' },
      { filePath: 'Card.tsx', sourceRef: '10:4', id: 'b' },
      { filePath: 'Card.tsx', sourceRef: '10:4', id: 'c' },
    ]);
    expect(out).toHaveLength(1);
    // First occurrence wins — input order preserved.
    expect(out[0].id).toBe('a');
  });

  it('keeps distinct source nodes even within one file', () => {
    const out = dedupeBySameSource([
      { filePath: 'Card.tsx', sourceRef: '10:4' },
      { filePath: 'Card.tsx', sourceRef: '20:2' },
    ]);
    expect(out).toHaveLength(2);
  });

  it('keeps the same ref across different files (cross-file D4)', () => {
    const out = dedupeBySameSource([
      { filePath: 'Card.tsx', sourceRef: '10:4' },
      { filePath: 'Hero.tsx', sourceRef: '10:4' },
    ]);
    expect(out).toHaveLength(2);
  });

  it('preserves order across a mix of duplicate and unique sources', () => {
    const out = dedupeBySameSource([
      { filePath: 'Card.tsx', sourceRef: 'x', id: '1' },
      { filePath: 'Card.tsx', sourceRef: 'y', id: '2' },
      { filePath: 'Card.tsx', sourceRef: 'x', id: '3' },
      { filePath: 'Card.tsx', sourceRef: 'z', id: '4' },
    ]);
    expect(out.map((e) => e.id)).toEqual(['1', '2', '4']);
  });
});
