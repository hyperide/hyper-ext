/**
 * @file Tests for the locale-code recognizer used by content-first i18n discovery.
 *
 * Accessed via: bun test shared/i18n-text/__tests__/locale-code.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { isLocaleCode } from '../locale-code';

describe('isLocaleCode — accepts real locale codes', () => {
  it('bare language codes', () => {
    for (const c of ['en', 'de', 'fr', 'ru', 'pl', 'zh', 'ja', 'pt', 'fil']) {
      expect(isLocaleCode(c)).toBe(true);
    }
  });

  it('region-qualified codes (dash and underscore)', () => {
    for (const c of ['en-US', 'pt-BR', 'es-419', 'zh-Hant', 'en_US', 'zh-Hant-TW']) {
      expect(isLocaleCode(c)).toBe(true);
    }
  });
});

describe('isLocaleCode — rejects non-locales', () => {
  it('common source/tooling dir names that collide with the bare-language shape', () => {
    for (const c of ['src', 'app', 'lib', 'api', 'www', 'js', 'ts', 'bin', 'env', 'dev', 'out', 'ios']) {
      expect(isLocaleCode(c)).toBe(false);
    }
  });

  it('words that are simply the wrong shape', () => {
    for (const c of ['common', 'config', 'messages', 'index', 'node', 'dist', 'settings', '']) {
      expect(isLocaleCode(c)).toBe(false);
    }
  });

  it('does not reject a real 2-letter locale that happens to look short', () => {
    expect(isLocaleCode('de')).toBe(true);
    expect(isLocaleCode('fr')).toBe(true);
  });
});
