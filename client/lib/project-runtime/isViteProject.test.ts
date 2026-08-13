import { describe, expect, it } from 'bun:test';
import type { ProjectData } from '@/pages/Editor/components/hooks/useProjectControl';
import { isViteProject } from './isViteProject';

const base = {
  id: 'p1',
  name: 'Test',
  slug: 'test',
  type: 'vite',
} as unknown as ProjectData;

describe('isViteProject', () => {
  it('returns true when clientSideRuntime is true', () => {
    expect(isViteProject({ ...base, clientSideRuntime: true })).toBe(true);
  });

  it('returns false when clientSideRuntime is false', () => {
    expect(isViteProject({ ...base, clientSideRuntime: false })).toBe(false);
  });

  it('returns false when clientSideRuntime is undefined', () => {
    expect(isViteProject({ ...base, clientSideRuntime: undefined })).toBe(false);
  });

  it('returns false when clientSideRuntime is null', () => {
    expect(isViteProject({ ...base, clientSideRuntime: null as unknown as boolean })).toBe(false);
  });
});
