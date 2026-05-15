/**
 * @file Failing tests for AST-based i18n binding detection.
 *
 * Tests must fail (semantic failure: kind === 'unsupported') until Task 5
 * replaces the stub in detect-i18n-binding.ts with real AST analysis.
 *
 * Location contract:
 *   - For {expr} JSX children: pass the start of the expression inside the braces.
 *   - For <Component /> JSX children: pass the start of the opening '<'.
 *   - Babel convention: line 1-based, column 0-based.
 */
import { describe, expect, it } from 'bun:test';
import { detectI18nBinding } from '../detect-i18n-binding';

/** Return 1-based line and 0-based column of the first occurrence of needle in source. */
function loc(source: string, needle: string): { line: number; column: number } {
  const idx = source.indexOf(needle);
  if (idx === -1) throw new Error(`Fixture does not contain: ${JSON.stringify(needle)}`);
  const before = source.slice(0, idx);
  const lines = before.split('\n');
  return { line: lines.length, column: (lines.at(-1) ?? '').length };
}

// ---------------------------------------------------------------------------
// Fixture: useLanguage custom hook — the bulka-the-dog pattern
// ---------------------------------------------------------------------------

const customHookFixture = `export default function Index() {
  const { t } = useLanguage();
  return <p className="text-foreground/80">{t("habits.walks")}</p>;
}`;

describe('t("key") — custom hook or react-i18next', () => {
  it('detects binding with react-i18next library hint', () => {
    const result = detectI18nBinding({
      source: customHookFixture,
      filePath: 'Index.tsx',
      location: loc(customHookFixture, 't("habits.walks")'),
      library: 'react-i18next',
    });
    expect(result.kind).toBe('i18n');
    if (result.kind === 'i18n') {
      expect(result.key).toBe('habits.walks');
      expect(result.library).toBe('react-i18next');
    }
  });

  it('detects binding with custom library hint', () => {
    const result = detectI18nBinding({
      source: customHookFixture,
      filePath: 'Index.tsx',
      location: loc(customHookFixture, 't("habits.walks")'),
      library: 'custom',
    });
    expect(result.kind).toBe('i18n');
    if (result.kind === 'i18n') {
      expect(result.key).toBe('habits.walks');
      expect(result.library).toBe('custom');
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture: formatMessage({ id }) — react-intl hook binding
// ---------------------------------------------------------------------------

const formatMessageFixture = `function Component() {
  const { formatMessage } = useIntl();
  return <p>{formatMessage({ id: "habits.walks" })}</p>;
}`;

describe('formatMessage({ id }) — react-intl', () => {
  it('detects formatMessage call binding', () => {
    const result = detectI18nBinding({
      source: formatMessageFixture,
      filePath: 'Component.tsx',
      location: loc(formatMessageFixture, 'formatMessage({ id: "habits.walks" })'),
      library: 'react-intl',
    });
    expect(result.kind).toBe('i18n');
    if (result.kind === 'i18n') {
      expect(result.key).toBe('habits.walks');
      expect(result.library).toBe('react-intl');
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture: t({ id }) — Lingui object call form
// ---------------------------------------------------------------------------

const linguiCallObjectFixture = `function Component() {
  const { t } = useLingui();
  return <p>{t({ id: "habits.walks" })}</p>;
}`;

describe('t({ id }) — Lingui object call', () => {
  it('detects Lingui object-style binding', () => {
    const result = detectI18nBinding({
      source: linguiCallObjectFixture,
      filePath: 'Component.tsx',
      location: loc(linguiCallObjectFixture, 't({ id: "habits.walks" })'),
      library: 'lingui',
    });
    expect(result.kind).toBe('i18n');
    if (result.kind === 'i18n') {
      expect(result.key).toBe('habits.walks');
      expect(result.library).toBe('lingui');
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture: t`key` — Lingui template tag
// ---------------------------------------------------------------------------

const linguiTagFixture = `function Component() {
  return <p>{t\`habits.walks\`}</p>;
}`;

describe('t`key` — Lingui template tag', () => {
  it('detects Lingui template-tag binding', () => {
    const result = detectI18nBinding({
      source: linguiTagFixture,
      filePath: 'Component.tsx',
      location: loc(linguiTagFixture, 't`habits.walks`'),
      library: 'lingui',
    });
    expect(result.kind).toBe('i18n');
    if (result.kind === 'i18n') {
      expect(result.key).toBe('habits.walks');
      expect(result.library).toBe('lingui');
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture: <FormattedMessage id="key" /> — react-intl JSX child element
// ---------------------------------------------------------------------------

const formattedMessageFixture = `function Component() {
  return <p><FormattedMessage id="habits.walks" /></p>;
}`;

describe('<FormattedMessage id="key" /> — react-intl', () => {
  it('detects FormattedMessage JSX element child', () => {
    const result = detectI18nBinding({
      source: formattedMessageFixture,
      filePath: 'Component.tsx',
      // Location of the '<' starting the JSX child element
      location: loc(formattedMessageFixture, '<FormattedMessage'),
      library: 'react-intl',
    });
    expect(result.kind).toBe('i18n');
    if (result.kind === 'i18n') {
      expect(result.key).toBe('habits.walks');
      expect(result.library).toBe('react-intl');
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture: <Trans id="key" /> — Lingui JSX child element
// ---------------------------------------------------------------------------

const transFixture = `function Component() {
  return <p><Trans id="habits.walks" /></p>;
}`;

describe('<Trans id="key" /> — Lingui', () => {
  it('detects Trans JSX element child', () => {
    const result = detectI18nBinding({
      source: transFixture,
      filePath: 'Component.tsx',
      // Location of the '<' starting the JSX child element
      location: loc(transFixture, '<Trans'),
      library: 'lingui',
    });
    expect(result.kind).toBe('i18n');
    if (result.kind === 'i18n') {
      expect(result.key).toBe('habits.walks');
      expect(result.library).toBe('lingui');
    }
  });
});

// ---------------------------------------------------------------------------
// Unsupported cases — must return kind === 'unsupported' with correct reason
// ---------------------------------------------------------------------------

describe('unsupported expressions', () => {
  it('returns non-string-id for FormattedMessage with dynamic id prop', () => {
    const source = `function Component({ id }: { id: string }) {
  return <p><FormattedMessage id={id} /></p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: 'Component.tsx',
      location: loc(source, '<FormattedMessage'),
      library: 'react-intl',
    });
    expect(result.kind).toBe('unsupported');
    if (result.kind === 'unsupported') {
      expect(result.reason).toBe('non-string-id');
    }
  });

  it('returns dynamic-key for variable key argument', () => {
    const source = `function Component({ keyName }: { keyName: string }) {
  return <p>{t(keyName)}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: 'Component.tsx',
      location: loc(source, 't(keyName)'),
      library: 'react-i18next',
    });
    expect(result.kind).toBe('unsupported');
    if (result.kind === 'unsupported') {
      expect(result.reason).toBe('dynamic-key');
    }
  });

  it('returns unknown-wrapper for unrecognized function with null library', () => {
    const source = `function Component() {
  return <p>{translate("habits.walks")}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: 'Component.tsx',
      location: loc(source, 'translate("habits.walks")'),
      library: null,
    });
    expect(result.kind).toBe('unsupported');
    if (result.kind === 'unsupported') {
      expect(result.reason).toBe('unknown-wrapper');
    }
  });
});
