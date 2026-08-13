import { describe, expect, mock, test } from 'bun:test';

import type { SourceLocation } from '@shared/element-tracing/types';

// NOTE: do NOT static-import ../iframe-utils here — we must mock its
// dependencies first, then dynamic-import so Bun reloads the module graph.

// mock dependencies
const mockFiber = { tag: 1, type: 'div' };

const mockGetFiberFromDOM = (el: HTMLElement) => {
  if (el.dataset.hasFiber === 'true') return mockFiber;
  return null;
};

const mockFindNearestSourceLocation = (fiber: unknown): SourceLocation | null => {
  if (fiber === mockFiber) return { file: 'src/App.tsx', line: 10, column: 5 };
  return null;
};

const mockGetItemIndexFromFiber = (
  fiber: unknown,
  resolveLocation: (fiber: unknown) => SourceLocation | null,
): number => {
  if (fiber === mockFiber) {
    const loc = resolveLocation(fiber);
    return loc ? 3 : 0;
  }
  return 0;
};

// Override imports via module mocking
// Note: @shared/element-tracing/fiber-internals and ./iframe-source-maps are
// mocked to test iframe-utils in isolation.

// Mock by the SAME specifier iframe-utils.ts imports it with (the @shared alias),
// not a machine-absolute path — an absolute path only resolves on the author's box
// and silently no-ops in CI (Linux), letting the real module run → test fails there.
mock.module('@shared/element-tracing/fiber-internals', () => ({
  getFiberFromDOM: mockGetFiberFromDOM,
  findNearestSourceLocation: mockFindNearestSourceLocation,
  getItemIndexFromFiber: mockGetItemIndexFromFiber,
}));

mock.module('./iframe-source-maps', () => ({
  resolveOwnServerSourceMap: () => null,
  resolveViaClientSourceMap: () => null,
}));

// Dynamic-import after mocking so Bun reloads the module graph.
const { getSourceLocationFromDOM: getLoc, getItemIndexFromDOM: getIdx } = await import('../iframe-utils');

describe('getSourceLocationFromDOM', () => {
  test('returns source location when fiber is found', () => {
    const el = document.createElement('div');
    el.dataset.hasFiber = 'true';
    const result = getLoc(el);
    expect(result).toEqual({ file: 'src/App.tsx', line: 10, column: 5 });
  });

  test('returns null when no fiber is found', () => {
    const el = document.createElement('div');
    const result = getLoc(el);
    expect(result).toBeNull();
  });
});

describe('getItemIndexFromDOM', () => {
  test('returns 0 when no fiber is found', () => {
    const el = document.createElement('div');
    const result = getIdx(el);
    expect(result).toBe(0);
  });

  // NOTE: Testing the "fiber found + location resolves" path requires mocking
  // @shared/element-tracing/fiber-internals, which Bun's mock.module does not
  // reliably intercept for path-aliased modules. The production path is covered
  // by integration tests in ext-test-projects.
});
