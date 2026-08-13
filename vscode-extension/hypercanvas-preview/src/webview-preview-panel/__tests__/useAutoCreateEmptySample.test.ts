import { describe, expect, it } from 'bun:test';
import { nextAutoCreateKey } from '../useAutoCreateEmptySample';

describe('nextAutoCreateKey (HYP-649 auto-create decision)', () => {
  it('returns a key when schema is empty and the error has no prop hints', () => {
    expect(
      nextAutoCreateKey(null, {
        componentPath: 'src/Foo.tsx',
        error: 'Error: Cannot find sample',
        errorSeq: 1,
        propsSchema: [],
      }),
    ).toBe('src/Foo.tsx:1');
  });

  it('returns null when the error names a prop (schema empty but hints present)', () => {
    expect(
      nextAutoCreateKey(null, {
        componentPath: 'src/Foo.tsx',
        error: "Cannot read properties of undefined (reading 'title')",
        errorSeq: 1,
        propsSchema: [],
      }),
    ).toBeNull();
  });

  it('returns null while the schema is still loading (undefined)', () => {
    expect(
      nextAutoCreateKey(null, {
        componentPath: 'src/Foo.tsx',
        error: 'Error: Cannot find sample',
        errorSeq: 1,
        propsSchema: undefined,
      }),
    ).toBeNull();
  });

  it('returns null when there is no error', () => {
    expect(
      nextAutoCreateKey(null, { componentPath: 'src/Foo.tsx', error: null, errorSeq: 1, propsSchema: [] }),
    ).toBeNull();
  });

  it('returns null when the key matches the last fired key (no re-fire on re-render)', () => {
    const input = { componentPath: 'src/Foo.tsx', error: 'Error: Cannot find sample', errorSeq: 1, propsSchema: [] };
    expect(nextAutoCreateKey('src/Foo.tsx:1', input)).toBeNull();
  });

  it('returns a new key when errorSeq advances (a fresh error re-fires)', () => {
    const input = { componentPath: 'src/Foo.tsx', error: 'Error: Cannot find sample', errorSeq: 2, propsSchema: [] };
    expect(nextAutoCreateKey('src/Foo.tsx:1', input)).toBe('src/Foo.tsx:2');
  });

  it('defaults errorSeq to 0 in the key when omitted', () => {
    expect(
      nextAutoCreateKey(null, { componentPath: 'src/Foo.tsx', error: 'Error: Cannot find sample', propsSchema: [] }),
    ).toBe('src/Foo.tsx:0');
  });

  it('returns null when the schema has entries (overlay should show the form)', () => {
    expect(
      nextAutoCreateKey(null, {
        componentPath: 'src/Foo.tsx',
        error: 'Error: Cannot find sample',
        errorSeq: 1,
        propsSchema: [{ name: 'title', type: 'string', required: true }],
      }),
    ).toBeNull();
  });

  it('returns null when hasSample is true — prevents overwriting existing SampleDefault (HYP-648 P1 fix)', () => {
    expect(
      nextAutoCreateKey(null, {
        componentPath: 'src/Foo.tsx',
        error: 'Error: boom',
        errorSeq: 1,
        propsSchema: [],
        hasSample: true,
      }),
    ).toBeNull();
  });

  it('still returns a key when hasSample is false — new component, safe to auto-create', () => {
    expect(
      nextAutoCreateKey(null, {
        componentPath: 'src/Foo.tsx',
        error: 'Error: boom',
        errorSeq: 1,
        propsSchema: [],
        hasSample: false,
      }),
    ).toBe('src/Foo.tsx:1');
  });
});
