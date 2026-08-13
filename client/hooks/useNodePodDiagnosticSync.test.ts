import { describe, expect, it } from 'bun:test';

// Pure helpers extracted from useNodePodDiagnosticSync for unit testing.
// The hook itself is React-bound (useEffect + zustand store) — tested via integration.

function mapSource(line: string): 'server' | 'system' {
  if (
    line.startsWith('[npm]') ||
    line.startsWith('[npm:err]') ||
    line.startsWith('[vite]') ||
    line.startsWith('[vite:err]')
  )
    return 'server';
  if (line.startsWith('[error]')) return 'server';
  return 'system';
}

function isErrorLine(line: string): boolean {
  return line.startsWith('[error]') || line.startsWith('[npm:err]') || line.startsWith('[vite:err]');
}

describe('mapSource', () => {
  it('classifies npm output as server', () => {
    expect(mapSource('[npm] installing...')).toBe('server');
  });

  it('classifies npm errors as server', () => {
    expect(mapSource('[npm:err] ENOTFOUND')).toBe('server');
  });

  it('classifies vite output as server', () => {
    expect(mapSource('[vite] ready in 300ms')).toBe('server');
  });

  it('classifies vite errors as server', () => {
    expect(mapSource('[vite:err] HMR error')).toBe('server');
  });

  it('classifies [error] prefix as server', () => {
    expect(mapSource('[error] something failed')).toBe('server');
  });

  it('classifies runtime system messages as system', () => {
    expect(mapSource('NodePod starting...')).toBe('system');
    expect(mapSource('[system] boot complete')).toBe('system');
    expect(mapSource('')).toBe('system');
  });
});

describe('isErrorLine', () => {
  it('detects [error] prefix', () => {
    expect(isErrorLine('[error] something failed')).toBe(true);
  });

  it('detects [npm:err] prefix', () => {
    expect(isErrorLine('[npm:err] install failed')).toBe(true);
  });

  it('detects [vite:err] prefix', () => {
    expect(isErrorLine('[vite:err] HMR error')).toBe(true);
  });

  it('returns false for non-error lines', () => {
    expect(isErrorLine('[npm] installing')).toBe(false);
    expect(isErrorLine('[vite] ready')).toBe(false);
    expect(isErrorLine('NodePod starting')).toBe(false);
    expect(isErrorLine('')).toBe(false);
  });
});
