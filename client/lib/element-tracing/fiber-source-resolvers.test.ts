import { describe, expect, it } from 'bun:test';
import { getOwnFiberSourceLocation } from '@shared/element-tracing/fiber-source-index';
import type { SourceLocation } from '@shared/element-tracing/types';
import type { Fiber } from './fiber-utils';
import {
  createFiberSourceResolvers,
  type MappedFiberSourceResolver,
} from './fiber-source-resolvers';

function mockFiber(overrides: Partial<Fiber> = {}): Fiber {
  return {
    tag: 5,
    type: 'div',
    stateNode: null,
    return: null,
    child: null,
    sibling: null,
    memoizedProps: {},
    _debugSource: null,
    _debugOwner: null,
    ...overrides,
  } as Fiber;
}

/** A React-19 fiber: no `_debugSource`, only a `_debugStack` pointing at a TRANSFORMED module. */
function react19Fiber(): Fiber {
  return mockFiber({
    _debugStack: {
      stack: 'Error\n    at App (http://localhost:8080/src/App.tsx:101:32)',
    } as Error,
  });
}

/** Stands in for `ModuleSourceMapResolver` returning a fixed value regardless of the fiber. */
function fakeMappedResolver(value: SourceLocation | null): MappedFiberSourceResolver {
  return { resolveFiberSource: () => value };
}

describe('createFiberSourceResolvers', () => {
  // Guards the exact production wiring: useElementTracer injects `forAdapter` into ReactAdapter.
  // The COMPOSITION the field bug lived in is `moduleSourceMapResolver.resolveFiberSource(fiber)
  // ?? getOwnFiberSourceLocation(fiber)` — on a cold map the mapped lookup is null and the fold
  // returns the RAW COMPILED `_debugStack` seed, which ReactAdapter's `if (mapped) return mapped`
  // commits BEFORE its `isUnsymbolicatedReact19Fiber` guard can defer. Injecting `() => null`
  // (the earlier react-adapter unit test) hid this — that is NOT the production shape.
  describe('forAdapter (ReactAdapter leaf-seed path — mapped-only)', () => {
    it('returns null for an unsymbolicated React-19 fiber on a cold map (does NOT commit the compiled _debugStack seed) — HYP-974', () => {
      const fiber = react19Fiber();
      // Precondition proving the bug is reachable: the folded resolver WOULD have committed a
      // truthy compiled position for this fiber (this is what `() => null` failed to exercise).
      expect(getOwnFiberSourceLocation(fiber)).not.toBeNull();

      const { forAdapter } = createFiberSourceResolvers(fakeMappedResolver(null));

      expect(forAdapter(fiber)).toBeNull();
    });

    it('returns the mapped original position when the source map is WARM (no over-suppression)', () => {
      const mapped: SourceLocation = { fileName: 'src/App.tsx', line: 30, column: 11 };
      const { forAdapter } = createFiberSourceResolvers(fakeMappedResolver(mapped));

      expect(forAdapter(react19Fiber())).toEqual(mapped);
    });
  });

  describe('forSourceIndex (FiberSourceIndex identity keys — folded)', () => {
    it('falls back to the fiber own (compiled) position on a cold map so the index still has a key', () => {
      const fiber = react19Fiber();
      const { forSourceIndex } = createFiberSourceResolvers(fakeMappedResolver(null));

      expect(forSourceIndex(fiber)).toEqual(getOwnFiberSourceLocation(fiber));
    });

    it('prefers the mapped original position when the source map is WARM', () => {
      const mapped: SourceLocation = { fileName: 'src/App.tsx', line: 30, column: 11 };
      const { forSourceIndex } = createFiberSourceResolvers(fakeMappedResolver(mapped));

      expect(forSourceIndex(react19Fiber())).toEqual(mapped);
    });
  });
});
