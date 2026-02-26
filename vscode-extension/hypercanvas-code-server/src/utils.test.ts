import { describe, expect, it } from 'bun:test';
import {
  buildPreviewUrl,
  extractComponentPath,
  parseSSELine,
  stripAppPrefix,
  toApiPosition,
  toVSCodePosition,
} from './utils';

describe('parseSSELine', () => {
  it('parses valid "data: {json}" line', () => {
    const result = parseSSELine('data: {"type":"gotoPosition","filePath":"/app/src/App.tsx","line":10,"column":5}');
    expect(result).toEqual({
      type: 'gotoPosition',
      filePath: '/app/src/App.tsx',
      line: 10,
      column: 5,
    });
  });

  it('returns null for non-data lines', () => {
    expect(parseSSELine(': comment')).toBeNull();
    expect(parseSSELine('')).toBeNull();
    expect(parseSSELine('event: message')).toBeNull();
  });

  it('returns null for "data: " with empty payload', () => {
    expect(parseSSELine('data: ')).toBeNull();
    expect(parseSSELine('data:  ')).toBeNull();
  });

  it('returns null for "data: invalid-json"', () => {
    expect(parseSSELine('data: not-json')).toBeNull();
  });

  it('parses command with partial fields', () => {
    const result = parseSSELine('data: {"type":"ping"}');
    expect(result).toEqual({ type: 'ping' });
  });
});

describe('extractComponentPath', () => {
  it('extracts from /app/src/components/Button.tsx', () => {
    expect(extractComponentPath('/app/src/components/Button.tsx')).toBe('src/components/Button.tsx');
  });

  it('extracts from /app/pages/index.tsx', () => {
    expect(extractComponentPath('/app/pages/index.tsx')).toBe('pages/index.tsx');
  });

  it('handles .jsx files', () => {
    expect(extractComponentPath('/app/src/App.jsx')).toBe('src/App.jsx');
  });

  it('returns undefined for non-tsx/jsx files', () => {
    expect(extractComponentPath('/app/src/utils.ts')).toBeUndefined();
    expect(extractComponentPath('/app/styles/main.css')).toBeUndefined();
  });

  it('returns undefined for paths without /app/ prefix', () => {
    expect(extractComponentPath('/home/user/Button.tsx')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(extractComponentPath('')).toBeUndefined();
  });
});

describe('buildPreviewUrl', () => {
  const origin = 'http://localhost:8080';
  const projectId = 'proj-123';

  it('builds URL without component', () => {
    expect(buildPreviewUrl(origin, projectId)).toBe('http://localhost:8080/project-preview/proj-123/test-preview');
  });

  it('appends ?component= with component', () => {
    expect(buildPreviewUrl(origin, projectId, 'src/Button.tsx')).toBe(
      'http://localhost:8080/project-preview/proj-123/test-preview?component=src%2FButton.tsx',
    );
  });

  it('encodes special characters in component path', () => {
    const url = buildPreviewUrl(origin, projectId, 'src/My Component.tsx');
    expect(url).toContain('My%20Component.tsx');
  });
});

describe('toApiPosition', () => {
  it('converts (0, 0) → { line: 1, column: 1 }', () => {
    expect(toApiPosition(0, 0)).toEqual({ line: 1, column: 1 });
  });

  it('converts (5, 10) → { line: 6, column: 11 }', () => {
    expect(toApiPosition(5, 10)).toEqual({ line: 6, column: 11 });
  });
});

describe('toVSCodePosition', () => {
  it('converts (1, 1) → { line: 0, column: 0 }', () => {
    expect(toVSCodePosition(1, 1)).toEqual({ line: 0, column: 0 });
  });

  it('converts (10, 5) → { line: 9, column: 4 }', () => {
    expect(toVSCodePosition(10, 5)).toEqual({ line: 9, column: 4 });
  });

  it('clamps column to 0 minimum', () => {
    expect(toVSCodePosition(1, 0)).toEqual({ line: 0, column: 0 });
  });
});

describe('stripAppPrefix', () => {
  it('strips /app/ prefix', () => {
    expect(stripAppPrefix('/app/src/components/Button.tsx')).toBe('src/components/Button.tsx');
  });

  it('returns unchanged without /app/ prefix', () => {
    expect(stripAppPrefix('/home/user/file.tsx')).toBe('/home/user/file.tsx');
  });

  it('only strips the leading /app/', () => {
    expect(stripAppPrefix('/app/nested/app/file.tsx')).toBe('nested/app/file.tsx');
  });
});
