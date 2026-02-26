import { describe, expect, it } from 'bun:test';
import { filterChildPaths } from './directory-tree';

describe('filterChildPaths', () => {
  it('filters child paths (keeps parent, removes child)', () => {
    const paths = ['src/components', 'src/components/ui', 'src/pages'];
    expect(filterChildPaths(paths)).toEqual(['src/components', 'src/pages']);
  });

  it('keeps unrelated paths', () => {
    const paths = ['src/utils', 'lib/helpers', 'test/fixtures'];
    expect(filterChildPaths(paths)).toEqual(['src/utils', 'lib/helpers', 'test/fixtures']);
  });

  it('handles empty array', () => {
    expect(filterChildPaths([])).toEqual([]);
  });

  it('handles single path', () => {
    expect(filterChildPaths(['src'])).toEqual(['src']);
  });

  it('handles paths with no parent-child relationships', () => {
    const paths = ['a', 'b', 'c'];
    expect(filterChildPaths(paths)).toEqual(['a', 'b', 'c']);
  });

  it('handles deeply nested children', () => {
    const paths = ['src', 'src/components', 'src/components/ui/atoms'];
    expect(filterChildPaths(paths)).toEqual(['src']);
  });
});
