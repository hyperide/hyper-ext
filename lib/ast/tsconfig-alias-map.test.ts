/**
 * Tests for tsconfig-alias-map — builds the alias prefix → absolute dir map that
 * `resolveMasterComponent` consumes for tsconfig path-alias imports (HYP-563).
 */

import { describe, expect, it } from 'bun:test';
import { buildAliasMapFromTsconfig } from './tsconfig-alias-map';

describe('buildAliasMapFromTsconfig', () => {
  it('maps a wildcard path alias to an absolute dir prefix', () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } },
    });
    const map = buildAliasMapFromTsconfig(tsconfig, '/proj');
    expect(map['@/']).toBe('/proj/src/');
  });

  it('respects baseUrl when resolving path targets', () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { baseUrl: './app', paths: { '~/*': ['components/*'] } },
    });
    const map = buildAliasMapFromTsconfig(tsconfig, '/proj');
    expect(map['~/']).toBe('/proj/app/components/');
  });

  it('tolerates comments and trailing commas in tsconfig (JSONC)', () => {
    const tsconfig = [
      '{',
      '  // editor config',
      '  "compilerOptions": {',
      '    "baseUrl": ".",',
      '    "paths": {',
      '      "@/*": ["src/*"], // alias',
      '    },',
      '  },',
      '}',
    ].join('\n');
    const map = buildAliasMapFromTsconfig(tsconfig, '/proj');
    expect(map['@/']).toBe('/proj/src/');
  });

  it('returns an empty map when there are no paths', () => {
    const tsconfig = JSON.stringify({ compilerOptions: { baseUrl: '.' } });
    expect(buildAliasMapFromTsconfig(tsconfig, '/proj')).toEqual({});
  });

  it('returns an empty map for unparseable input', () => {
    expect(buildAliasMapFromTsconfig('not json at all {{{', '/proj')).toEqual({});
  });

  it('handles a non-wildcard exact alias', () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@app': ['src/app/index.ts'] } },
    });
    const map = buildAliasMapFromTsconfig(tsconfig, '/proj');
    // Exact (non-wildcard) alias maps the bare prefix to the target file's base.
    expect(map['@app']).toBe('/proj/src/app/index.ts');
  });
});
