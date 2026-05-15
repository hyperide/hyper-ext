/**
 * @file Tests for fiber-based element query utilities
 */

import { describe, expect, it } from 'bun:test';
import type { FrameworkAdapter, SourceLocation } from '../element-tracing/types';
import { buildSourceKey, computeFiberItemIndex, findDOMElementsBySource } from './fiber-element-query';

describe('buildSourceKey', () => {
  it('should create deterministic key from source location', () => {
    const source: SourceLocation = { fileName: '/app/src/App.tsx', line: 5, column: 4 };
    expect(buildSourceKey(source)).toBe('/app/src/App.tsx:5:4');
  });

  it('should handle column 0', () => {
    const source: SourceLocation = { fileName: 'index.tsx', line: 1, column: 0 };
    expect(buildSourceKey(source)).toBe('index.tsx:1:0');
  });
});

describe('findDOMElementsBySource', () => {
  it('should delegate to adapter.findDOMElement for single item', () => {
    const mockEl = document.createElement('div');
    const source: SourceLocation = { fileName: 'App.tsx', line: 5, column: 4 };

    const adapter: Pick<FrameworkAdapter, 'findDOMElement'> = {
      findDOMElement: (s, idx) => {
        if (s.fileName === 'App.tsx' && s.line === 5 && idx === 0) return mockEl;
        return null;
      },
    };

    const result = findDOMElementsBySource(adapter, source, 0);
    expect(result).toEqual([mockEl]);
  });

  it('should return empty array when adapter returns null', () => {
    const adapter: Pick<FrameworkAdapter, 'findDOMElement'> = {
      findDOMElement: () => null,
    };

    const source: SourceLocation = { fileName: 'App.tsx', line: 5, column: 4 };
    const result = findDOMElementsBySource(adapter, source, 0);
    expect(result).toEqual([]);
  });

  it('should collect all elements when itemIndex is null', () => {
    const els = [document.createElement('div'), document.createElement('span'), document.createElement('p')];
    const source: SourceLocation = { fileName: 'List.tsx', line: 10, column: 2 };

    const adapter: Pick<FrameworkAdapter, 'findDOMElement'> = {
      findDOMElement: (_s, idx) => els[idx] ?? null,
    };

    const result = findDOMElementsBySource(adapter, source, null);
    expect(result).toEqual(els);
  });

  it('should return empty array when itemIndex is null and no elements found', () => {
    const adapter: Pick<FrameworkAdapter, 'findDOMElement'> = {
      findDOMElement: () => null,
    };

    const source: SourceLocation = { fileName: 'App.tsx', line: 5, column: 4 };
    const result = findDOMElementsBySource(adapter, source, null);
    expect(result).toEqual([]);
  });
});

describe('computeFiberItemIndex', () => {
  it('should return adapter.getItemIndex result', () => {
    const mockEl = document.createElement('div');
    const adapter: Pick<FrameworkAdapter, 'getItemIndex'> = {
      getItemIndex: () => 2,
    };

    expect(computeFiberItemIndex(adapter, mockEl)).toBe(2);
  });

  it('should return 0 for first element', () => {
    const mockEl = document.createElement('div');
    const adapter: Pick<FrameworkAdapter, 'getItemIndex'> = {
      getItemIndex: () => 0,
    };

    expect(computeFiberItemIndex(adapter, mockEl)).toBe(0);
  });
});
