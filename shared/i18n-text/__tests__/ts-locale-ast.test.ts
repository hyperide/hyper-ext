/**
 * @file Direct unit tests for `writeTsLocaleValue` AST helper.
 *
 * Accessed via: shared.i18n-text resource write path
 * Assumptions: pure string-in / string-out; no fileIO. These tests target the
 * AST helper in isolation so we can pinpoint whether merged-TS write bugs live
 * in `setStringProperty` itself or higher in `writeI18nResource`.
 */

import { describe, expect, it } from 'bun:test';
import { parse as babelParse } from '@babel/parser';
import { writeTsLocaleValue } from '../ts-locale-ast';

function parsesAsTs(source: string): boolean {
  try {
    babelParse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    return true;
  } catch {
    return false;
  }
}

function expectString(value: string | null): string {
  if (value === null) throw new Error('expected non-null result from writeTsLocaleValue');
  return value;
}

describe('writeTsLocaleValue — single-locale TS', () => {
  it('updates an existing flat key', () => {
    const input = `export default { greeting: 'Hello' } as const;\n`;
    const out = writeTsLocaleValue(input, 'en', 'greeting', 'Hi');
    expect(out).not.toBeNull();
    expect(expectString(out)).toContain('Hi');
    expect(parsesAsTs(expectString(out))).toBe(true);
  });

  it('inserts a new flat key in a single-locale module', () => {
    const input = `export default { greeting: 'Hello' } as const;\n`;
    const out = writeTsLocaleValue(input, 'en', 'farewell', 'Bye');
    expect(out).not.toBeNull();
    expect(expectString(out)).toContain('Bye');
    expect(parsesAsTs(expectString(out))).toBe(true);
  });
});

describe('writeTsLocaleValue — merged TS dictionary', () => {
  const mergedSource = [
    `export type Language = "ru" | "rs" | "en";`,
    ``,
    `export interface Translations {`,
    `  ru: Record<string, any>;`,
    `  rs: Record<string, any>;`,
    `  en: Record<string, any>;`,
    `}`,
    ``,
    `export const translations: Translations = {`,
    `  ru: { brand: { name: "Булка" } },`,
    `  rs: { brand: { name: "Bulka (rs)" } },`,
    `  en: { brand: { name: "Bun" } },`,
    `};`,
    ``,
  ].join('\n');

  it('updates an existing nested key inside the active locale (ASCII)', () => {
    const out = writeTsLocaleValue(mergedSource, 'ru', 'brand.name', 'Bagel');
    expect(out).not.toBeNull();
    expect(expectString(out)).toContain('Bagel');
    // Other locales unaffected
    expect(expectString(out)).toContain('Bulka (rs)');
    expect(expectString(out)).toContain('Bun');
    expect(parsesAsTs(expectString(out))).toBe(true);
  });

  it('inserts a new top-level key inside the active locale (bulka shape)', () => {
    const out = writeTsLocaleValue(mergedSource, 'ru', 'q', 'Q!');
    expect(out).not.toBeNull();
    // New key with new value must appear inside ru's object
    expect(expectString(out)).toMatch(/ru\s*:\s*\{[\s\S]*?q\s*:\s*"Q!"[\s\S]*?\},/);
    // Existing keys preserved across all locales
    expect(expectString(out)).toContain('Булка');
    expect(expectString(out)).toContain('Bulka (rs)');
    expect(expectString(out)).toContain('Bun');
    expect(parsesAsTs(expectString(out))).toBe(true);
  });

  it('inserts a nested new key under the active locale, creating intermediate objects', () => {
    const out = writeTsLocaleValue(mergedSource, 'ru', 'e2e.merged.newkey', 'MERGED NEW');
    expect(out).not.toBeNull();
    expect(expectString(out)).toContain('MERGED NEW');
    expect(expectString(out)).toMatch(
      /ru\s*:\s*\{[\s\S]*e2e\s*:\s*\{[\s\S]*merged\s*:\s*\{[\s\S]*newkey\s*:\s*"MERGED NEW"/,
    );
    expect(parsesAsTs(expectString(out))).toBe(true);
  });

  // RED on current main — babel-generator default escapes non-ASCII when emitting
  // a freshly-constructed t.stringLiteral. Pre-existing literals are kept verbatim
  // because retainLines preserves their original source. Task 2 fixes the new-value
  // case so bulka-the-dog's plain Cyrillic file does not gain a \uXXXX-escaped
  // dialect after a single new key write.
  it('preserves non-ASCII when inserting a new value', () => {
    const out = writeTsLocaleValue(mergedSource, 'ru', 'greeting', 'Привет, Бублик');
    expect(out).not.toBeNull();
    expect(expectString(out)).toContain('Привет, Бублик');
    expect(expectString(out)).not.toContain('\\u04');
    expect(parsesAsTs(expectString(out))).toBe(true);
  });

  it('preserves non-ASCII when updating an existing value', () => {
    const out = writeTsLocaleValue(mergedSource, 'ru', 'brand.name', 'Бублик');
    expect(out).not.toBeNull();
    expect(expectString(out)).toContain('Бублик');
    expect(expectString(out)).not.toContain('\\u04');
    expect(parsesAsTs(expectString(out))).toBe(true);
  });

  it('returns null when the active locale is missing from a merged dictionary', () => {
    const out = writeTsLocaleValue(mergedSource, 'fr', 'q', 'Q!');
    expect(out).toBeNull();
  });

  it('rejects forbidden key parts (prototype pollution)', () => {
    expect(writeTsLocaleValue(mergedSource, 'ru', '__proto__.polluted', 'x')).toBeNull();
    expect(writeTsLocaleValue(mergedSource, 'ru', 'constructor.prototype.polluted', 'x')).toBeNull();
  });
});

describe('writeTsLocaleValue — failure modes', () => {
  it('returns null when the file does not declare a known dictionary export', () => {
    const input = `export const unrelated = { en: { greeting: 'Hi' } };\n`;
    expect(writeTsLocaleValue(input, 'en', 'greeting', 'Hello')).toBeNull();
  });

  it('returns null when a path segment exists but is not an object', () => {
    const input = `export const translations = {\n  en: { nav: 'Home' }, ru: { nav: 'Главная' },\n};\n`;
    expect(writeTsLocaleValue(input, 'en', 'nav.title', 'Navigation')).toBeNull();
  });

  it('returns null when content is not a parseable module', () => {
    expect(writeTsLocaleValue('this is not valid <ts/> at all {', 'en', 'q', 'Q!')).toBeNull();
  });
});
