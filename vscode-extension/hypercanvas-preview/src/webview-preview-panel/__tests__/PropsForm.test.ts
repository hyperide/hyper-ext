import { describe, expect, it } from 'bun:test';
import { canGenerateSomeValue } from '../PropsForm';

describe('canGenerateSomeValue', () => {
  it('returns false for empty fields', () => {
    expect(canGenerateSomeValue([])).toBe(false);
  });

  it('returns true when boolean field present', () => {
    expect(canGenerateSomeValue([{ name: 'active', typeInfo: { type: 'boolean', required: false } }])).toBe(true);
  });

  it('returns true when number field present', () => {
    expect(canGenerateSomeValue([{ name: 'count', typeInfo: { type: 'number', required: false } }])).toBe(true);
  });

  it('returns true when array field present', () => {
    expect(
      canGenerateSomeValue([
        {
          name: 'items',
          typeInfo: { type: 'array', required: false, arrayItemType: { type: 'string', required: false } },
        },
      ]),
    ).toBe(true);
  });

  it('returns true when enum field with values present', () => {
    expect(
      canGenerateSomeValue([
        { name: 'variant', typeInfo: { type: 'enum', required: false, enumValues: ['default', 'destructive'] } },
      ]),
    ).toBe(true);
  });

  it('returns false when enum has no values', () => {
    expect(
      canGenerateSomeValue([{ name: 'variant', typeInfo: { type: 'enum', required: false, enumValues: [] } }]),
    ).toBe(false);
  });

  it('returns false when only function and reactNode fields', () => {
    expect(
      canGenerateSomeValue([
        { name: 'onClick', typeInfo: { type: 'function', required: false } },
        { name: 'children', typeInfo: { type: 'reactNode', required: false } },
      ]),
    ).toBe(false);
  });

  it('returns false for className (string with no name-based generator)', () => {
    expect(canGenerateSomeValue([{ name: 'className', typeInfo: { type: 'string', required: false } }])).toBe(false);
  });

  it('returns true for title (string with name-based generator)', () => {
    expect(canGenerateSomeValue([{ name: 'title', typeInfo: { type: 'string', required: false } }])).toBe(true);
  });

  it('returns false when only unknown fields with no name-based generator', () => {
    expect(
      canGenerateSomeValue([
        { name: 'foo', typeInfo: { type: 'unknown', required: false } },
        { name: 'bar', typeInfo: { type: 'unknown', required: false } },
      ]),
    ).toBe(false);
  });

  it('returns true when unknown field has a name-based generator (email)', () => {
    expect(canGenerateSomeValue([{ name: 'email', typeInfo: { type: 'unknown', required: false } }])).toBe(true);
  });

  it('returns true for Alert-style props: className (no generator) + variant (enum)', () => {
    expect(
      canGenerateSomeValue([
        { name: 'className', typeInfo: { type: 'string', required: false } },
        { name: 'variant', typeInfo: { type: 'enum', required: false, enumValues: ['default', 'destructive'] } },
      ]),
    ).toBe(true);
  });

  it('returns true when object has generatable nested fields', () => {
    expect(
      canGenerateSomeValue([
        {
          name: 'user',
          typeInfo: {
            type: 'object',
            required: false,
            objectSchema: {
              name: { type: 'string', required: false },
              count: { type: 'number', required: false },
            },
          },
        },
      ]),
    ).toBe(true);
  });

  it('returns false when object schema has only non-generatable nested fields', () => {
    expect(
      canGenerateSomeValue([
        {
          name: 'config',
          typeInfo: {
            type: 'object',
            required: false,
            objectSchema: {
              onClick: { type: 'function', required: false },
              children: { type: 'reactNode', required: false },
            },
          },
        },
      ]),
    ).toBe(false);
  });

  it('returns false when object has no schema', () => {
    expect(canGenerateSomeValue([{ name: 'style', typeInfo: { type: 'object', required: false } }])).toBe(false);
  });

  it('button is disabled when all fields are functions — zero generatable fields', () => {
    const fields = [{ name: 'onPress', typeInfo: { type: 'function' as const, required: false } }];
    expect(canGenerateSomeValue(fields)).toBe(false);
  });
});
