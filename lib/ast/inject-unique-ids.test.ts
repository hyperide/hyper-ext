import { describe, expect, test } from 'bun:test';
import { injectIdsIntoSource } from './inject-unique-ids';

describe('injectIdsIntoSource', () => {
  test('should add data-uniq-id to elements without one', () => {
    const source = `export const A = () => <div><span>text</span></div>;`;
    const result = injectIdsIntoSource(source);

    expect(result.addedCount).toBe(2);
    expect(result.code).toMatch(/<div data-uniq-id="[^"]+"/);
    expect(result.code).toMatch(/<span data-uniq-id="[^"]+"/);
  });

  test('should preserve existing data-uniq-id', () => {
    const source = `export const A = () => <div data-uniq-id="keep-me"><span>text</span></div>;`;
    const result = injectIdsIntoSource(source);

    expect(result.addedCount).toBe(1); // only span
    expect(result.code).toContain('data-uniq-id="keep-me"');
    expect(result.code).toMatch(/<span data-uniq-id="[^"]+"/);
  });

  test('should deduplicate identical data-uniq-id values', () => {
    const source = `export const A = () => (
  <div data-uniq-id="dup">
    <span data-uniq-id="dup">text</span>
  </div>
);`;
    const result = injectIdsIntoSource(source);

    expect(result.addedCount).toBe(1); // second "dup" replaced
    const matches = result.code.match(/data-uniq-id="([^"]+)"/g);
    expect(matches).toHaveLength(2);
    // Two different IDs
    expect(matches).toBeDefined();
    const ids = (matches ?? []).map((m) => m.match(/"([^"]+)"/)?.[1]);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test('should be idempotent (no changes on second run)', () => {
    const source = `export const A = () => <div><span>text</span></div>;`;
    const first = injectIdsIntoSource(source);
    const second = injectIdsIntoSource(first.code);

    expect(second.addedCount).toBe(0);
    expect(second.code).toBe(first.code);
  });

  test('should inject into nested helper function JSX too (HYP-210)', () => {
    const source = `
export const MyComponent = () => {
  const renderHelper = () => {
    return <span>helper</span>;
  };
  return <div>main</div>;
};`;
    const result = injectIdsIntoSource(source);

    // Both main and helper elements get IDs
    expect(result.addedCount).toBe(2);
    expect(result.code).toMatch(/<div data-uniq-id="[^"]+"/);
    expect(result.code).toMatch(/<span data-uniq-id="[^"]+"/);
  });

  test('should inject into all components in a file', () => {
    const source = `
export const CompA = () => <div>a</div>;
export const CompB = () => <span>b</span>;`;
    const result = injectIdsIntoSource(source);

    expect(result.addedCount).toBe(2);
    expect(result.code).toMatch(/<div data-uniq-id="[^"]+"/);
    expect(result.code).toMatch(/<span data-uniq-id="[^"]+"/);
  });

  test('should handle memo/forwardRef wrapped components', () => {
    const source = `
import { memo, forwardRef } from 'react';
export const MyComponent = memo(forwardRef((props, ref) => {
  return <div>wrapped</div>;
}));`;
    const result = injectIdsIntoSource(source);

    expect(result.addedCount).toBe(1);
    expect(result.code).toMatch(/<div data-uniq-id="[^"]+"/);
  });
});
