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
import { describe, expect, it } from "bun:test";
import { detectI18nBinding } from "../detect-i18n-binding";

/** Return 1-based line and 0-based column of the first occurrence of needle in source. */
function loc(source: string, needle: string): { line: number; column: number } {
  const idx = source.indexOf(needle);
  if (idx === -1) throw new Error(`Fixture does not contain: ${JSON.stringify(needle)}`);
  const before = source.slice(0, idx);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1) ?? "").length };
}

// ---------------------------------------------------------------------------
// Fixture: useLanguage custom hook — the bulka-the-dog pattern
// ---------------------------------------------------------------------------

const customHookFixture = `export default function Index() {
  const { t } = useLanguage();
  return <p className="text-foreground/80">{t("habits.walks")}</p>;
}`;

describe('t("key") — custom hook or react-i18next', () => {
  it("detects binding with react-i18next library hint", () => {
    const result = detectI18nBinding({
      source: customHookFixture,
      filePath: "Index.tsx",
      location: loc(customHookFixture, 't("habits.walks")'),
      library: "react-i18next",
    });
    expect(result.kind).toBe("i18n");
    if (result.kind === "i18n") {
      expect(result.key).toBe("habits.walks");
      expect(result.library).toBe("react-i18next");
    }
  });

  it("detects binding with custom library hint", () => {
    const result = detectI18nBinding({
      source: customHookFixture,
      filePath: "Index.tsx",
      location: loc(customHookFixture, 't("habits.walks")'),
      library: "custom",
    });
    expect(result.kind).toBe("i18n");
    if (result.kind === "i18n") {
      expect(result.key).toBe("habits.walks");
      expect(result.library).toBe("custom");
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

describe("formatMessage({ id }) — react-intl", () => {
  it("detects formatMessage call binding", () => {
    const result = detectI18nBinding({
      source: formatMessageFixture,
      filePath: "Component.tsx",
      location: loc(formatMessageFixture, 'formatMessage({ id: "habits.walks" })'),
      library: "react-intl",
    });
    expect(result.kind).toBe("i18n");
    if (result.kind === "i18n") {
      expect(result.key).toBe("habits.walks");
      expect(result.library).toBe("react-intl");
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

describe("t({ id }) — Lingui object call", () => {
  it("detects Lingui object-style binding", () => {
    const result = detectI18nBinding({
      source: linguiCallObjectFixture,
      filePath: "Component.tsx",
      location: loc(linguiCallObjectFixture, 't({ id: "habits.walks" })'),
      library: "lingui",
    });
    expect(result.kind).toBe("i18n");
    if (result.kind === "i18n") {
      expect(result.key).toBe("habits.walks");
      expect(result.library).toBe("lingui");
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture: t`key` — Lingui template tag
// ---------------------------------------------------------------------------

const linguiTagFixture = `function Component() {
  return <p>{t\`habits.walks\`}</p>;
}`;

describe("t`key` — Lingui template tag", () => {
  it("detects Lingui template-tag binding", () => {
    const result = detectI18nBinding({
      source: linguiTagFixture,
      filePath: "Component.tsx",
      location: loc(linguiTagFixture, "t`habits.walks`"),
      library: "lingui",
    });
    expect(result.kind).toBe("i18n");
    if (result.kind === "i18n") {
      expect(result.key).toBe("habits.walks");
      expect(result.library).toBe("lingui");
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
  it("detects FormattedMessage JSX element child", () => {
    const result = detectI18nBinding({
      source: formattedMessageFixture,
      filePath: "Component.tsx",
      // Location of the '<' starting the JSX child element
      location: loc(formattedMessageFixture, "<FormattedMessage"),
      library: "react-intl",
    });
    expect(result.kind).toBe("i18n");
    if (result.kind === "i18n") {
      expect(result.key).toBe("habits.walks");
      expect(result.library).toBe("react-intl");
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
  it("detects Trans JSX element child", () => {
    const result = detectI18nBinding({
      source: transFixture,
      filePath: "Component.tsx",
      // Location of the '<' starting the JSX child element
      location: loc(transFixture, "<Trans"),
      library: "lingui",
    });
    expect(result.kind).toBe("i18n");
    if (result.kind === "i18n") {
      expect(result.key).toBe("habits.walks");
      expect(result.library).toBe("lingui");
    }
  });
});

// ---------------------------------------------------------------------------
// Unsupported cases — must return kind === 'unsupported' with correct reason
// ---------------------------------------------------------------------------

describe("unsupported expressions", () => {
  it("returns non-string-id for FormattedMessage with dynamic id prop", () => {
    const source = `function Component({ id }: { id: string }) {
  return <p><FormattedMessage id={id} /></p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, "<FormattedMessage"),
      library: "react-intl",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("non-string-id");
    }
  });

  it("returns dynamic-key for variable key argument", () => {
    const source = `function Component({ keyName }: { keyName: string }) {
  return <p>{t(keyName)}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, "t(keyName)"),
      library: "react-i18next",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("dynamic-key");
    }
  });

  it("returns unknown-wrapper for unrecognized function with null library", () => {
    const source = `function Component() {
  return <p>{translate("habits.walks")}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, 'translate("habits.walks")'),
      library: null,
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("unknown-wrapper");
    }
  });

  it('returns dynamic-key for t("key", { ns: dynamicVariable }) — dynamic namespace', () => {
    const source = `function Component({ ns }: { ns: string }) {
  return <p>{t("habits.walks", { ns })}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, 't("habits.walks"'),
      library: "react-i18next",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("dynamic-key");
    }
  });

  it('returns dynamic-key for t("key", { ns: someVar }) — dynamic ns expression', () => {
    const source = `function Component() {
  const currentNs = getNamespace();
  return <p>{t("habits.walks", { ns: currentNs })}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, 't("habits.walks"'),
      library: "react-i18next",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("dynamic-key");
    }
  });

  it('returns dynamic-key for t("key", opts) — variable second argument', () => {
    const source = `function Component() {
  const opts = { ns: 'common', count: 1 };
  return <p>{t("habits.walks", opts)}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, 't("habits.walks"'),
      library: "react-i18next",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("dynamic-key");
    }
  });

  it('returns dynamic-key for t("key", { ...opts }) — spread in options object, no static ns after', () => {
    const source = `function Component() {
  const opts = { ns: 'common' };
  return <p>{t("habits.walks", { ...opts })}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, 't("habits.walks"'),
      library: "react-i18next",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("dynamic-key");
    }
  });

  it("detects static ns after spread — last-property-wins over spread", () => {
    const source = `function Component() {
  const opts = { count: 1 };
  return <p>{t("habits.walks", { ...opts, ns: "common" })}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, 't("habits.walks"'),
      library: "react-i18next",
    });
    expect(result.kind).toBe("i18n");
    if (result.kind === "i18n") {
      expect(result.key).toBe("habits.walks");
      expect(result.namespace).toBe("common");
    }
  });

  it("returns dynamic-key when spread comes after static ns — spread can override", () => {
    const source = `function Component() {
  const opts = { ns: 'admin' };
  return <p>{t("habits.walks", { ns: "common", ...opts })}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, 't("habits.walks"'),
      library: "react-i18next",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("dynamic-key");
    }
  });

  it("still detects static ns option correctly after dynamic-ns fix", () => {
    const source = `function Component() {
  return <p>{t("habits.walks", { ns: "common" })}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, 't("habits.walks"'),
      library: "react-i18next",
    });
    expect(result.kind).toBe("i18n");
    if (result.kind === "i18n") {
      expect(result.key).toBe("habits.walks");
      expect(result.namespace).toBe("common");
    }
  });

  it("uses last ns when duplicate ns keys present — last-property-wins", () => {
    const source = `function Component() {
  return <p>{t("habits.walks", { ns: "common", ns: "admin" })}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, 't("habits.walks"'),
      library: "react-i18next",
    });
    expect(result.kind).toBe("i18n");
    if (result.kind === "i18n") {
      expect(result.key).toBe("habits.walks");
      expect(result.namespace).toBe("admin");
    }
  });

  it("returns dynamic-key when last ns is dynamic even if earlier ns is static", () => {
    const source = `function Component() {
  const currentNs = getNamespace();
  return <p>{t("habits.walks", { ns: "common", ns: currentNs })}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, 't("habits.walks"'),
      library: "react-i18next",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("dynamic-key");
    }
  });

  it('returns dynamic-key for t("key", { [ns]: "common" }) — computed key could be ns at runtime', () => {
    // { [ns]: "common" } — computed property, key is runtime value of variable ns.
    // If ns === "ns" at runtime, this supplies a namespace. Must be rejected as dynamic.
    const source = `function Component({ ns }: { ns: string }) {
  return <p>{t("habits.walks", { [ns]: "common" })}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, 't("habits.walks"'),
      library: "react-i18next",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("dynamic-key");
    }
  });

  it('returns dynamic-key for t({ [id]: "key" }) — computed id key in object form', () => {
    const source = `function Component({ id }: { id: string }) {
  return <p>{t({ [id]: "habits.walks" })}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, 't({ [id]: "habits.walks" })'),
      library: "lingui",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("non-string-id");
    }
  });

  it('returns dynamic-key for formatMessage({ id: "safe", ...opts }) — spread after static id can override', () => {
    const source = `function Component() {
  const opts = { id: 'dynamic' };
  return <p>{formatMessage({ id: "safe", ...opts })}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, 'formatMessage({ id: "safe"'),
      library: "react-intl",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("dynamic-key");
    }
  });

  it('returns dynamic-key for formatMessage({ id: "safe", id: currentId }) — last id is dynamic', () => {
    const source = `function Component({ currentId }: { currentId: string }) {
  return <p>{formatMessage({ id: "safe", id: currentId })}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, 'formatMessage({ id: "safe"'),
      library: "react-intl",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("dynamic-key");
    }
  });

  it('returns non-string-id for <FormattedMessage id="safe" {...props} /> — spread after id attr can override', () => {
    const source = `function Component(props: { id: string }) {
  return <p><FormattedMessage id="safe" {...props} /></p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, "<FormattedMessage"),
      library: "react-intl",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("non-string-id");
    }
  });

  it("detects static id when spread comes before it — last id wins", () => {
    const source = `function Component() {
  const opts = { id: 'dynamic' };
  return <p>{formatMessage({ ...opts, id: "safe" })}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, "formatMessage({ ...opts"),
      library: "react-intl",
    });
    expect(result.kind).toBe("i18n");
    if (result.kind === "i18n") {
      expect(result.key).toBe("safe");
    }
  });

  it("returns unknown-wrapper for formatMessage with custom library — formatMessage is react-intl specific, not generic custom", () => {
    const source = `function Component() {
  return <p>{formatMessage({ id: "habits.walks" })}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, 'formatMessage({ id: "habits.walks" })'),
      library: "custom",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("unknown-wrapper");
    }
  });

  it("returns unknown-wrapper for <FormattedMessage> with custom library — library-specific JSX, not a custom wrapper", () => {
    const source = `function Component() {
  return <p><FormattedMessage id="habits.walks" /></p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, "<FormattedMessage"),
      library: "custom",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("unknown-wrapper");
    }
  });

  it("returns unknown-wrapper for <Trans> with custom library — library-specific JSX, not a custom wrapper", () => {
    const source = `function Component() {
  return <p><Trans id="habits.walks" /></p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, "<Trans"),
      library: "custom",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("unknown-wrapper");
    }
  });

  it('returns dynamic-key for t("key", { ns: "common", [key]: "admin" }) — computed after static ns can override', () => {
    const source = `function Component({ key }: { key: string }) {
  return <p>{t("habits.walks", { ns: "common", [key]: "admin" })}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, 't("habits.walks"'),
      library: "react-i18next",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("dynamic-key");
    }
  });

  it('returns dynamic-key for t("key", { ns: "common", ["ns"]: "admin" }) — computed string literal key overrides static ns', () => {
    const source = `function Component() {
  return <p>{t("habits.walks", { ns: "common", ["ns"]: "admin" })}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, 't("habits.walks"'),
      library: "react-i18next",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("dynamic-key");
    }
  });

  it('returns dynamic-key for formatMessage({ id: "safe", [key]: "other" }) — computed after static id can override', () => {
    const source = `function Component({ key }: { key: string }) {
  return <p>{formatMessage({ id: "safe", [key]: "other" })}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, 'formatMessage({ id: "safe"'),
      library: "react-intl",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("dynamic-key");
    }
  });

  it('returns dynamic-key for formatMessage({ id: "safe", ["id"]: "other" }) — computed string literal key overrides static id', () => {
    const source = `function Component() {
  return <p>{formatMessage({ id: "safe", ["id"]: "other" })}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, 'formatMessage({ id: "safe"'),
      library: "react-intl",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("dynamic-key");
    }
  });
});

// ---------------------------------------------------------------------------
// Hook-level namespace: useTranslation('ns') and useTranslation({ ns: 'ns' })
// ---------------------------------------------------------------------------

describe("hook-level namespace via useTranslation", () => {
  it("picks up namespace from useTranslation('common') string argument", () => {
    const source = `import { useTranslation } from 'react-i18next';
function Component() {
  const { t } = useTranslation('common');
  return <p>{t('hello')}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, "t('hello')"),
      library: "react-i18next",
    });
    expect(result.kind).toBe("i18n");
    if (result.kind === "i18n") {
      expect(result.key).toBe("hello");
      expect(result.namespace).toBe("common");
    }
  });

  it("picks up namespace from useTranslation({ ns: 'common' }) object argument", () => {
    const source = `import { useTranslation } from 'react-i18next';
function Component() {
  const { t } = useTranslation({ ns: 'common' });
  return <p>{t('hello')}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, "t('hello')"),
      library: "react-i18next",
    });
    expect(result.kind).toBe("i18n");
    if (result.kind === "i18n") {
      expect(result.key).toBe("hello");
      expect(result.namespace).toBe("common");
    }
  });

  it("inline t('key', { ns: 'admin' }) wins over hook-level useTranslation('common')", () => {
    const source = `import { useTranslation } from 'react-i18next';
function Component() {
  const { t } = useTranslation('common');
  return <p>{t('hello', { ns: 'admin' })}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, "t('hello'"),
      library: "react-i18next",
    });
    expect(result.kind).toBe("i18n");
    if (result.kind === "i18n") {
      expect(result.key).toBe("hello");
      expect(result.namespace).toBe("admin");
    }
  });

  it("namespace is undefined when useTranslation() called without arguments", () => {
    const source = `import { useTranslation } from 'react-i18next';
function Component() {
  const { t } = useTranslation();
  return <p>{t('hello')}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, "t('hello')"),
      library: "react-i18next",
    });
    expect(result.kind).toBe("i18n");
    if (result.kind === "i18n") {
      expect(result.key).toBe("hello");
      expect(result.namespace).toBeUndefined();
    }
  });

  it("namespace is undefined when useTranslation receives a dynamic variable", () => {
    const source = `import { useTranslation } from 'react-i18next';
function Component({ ns }: { ns: string }) {
  const { t } = useTranslation(ns);
  return <p>{t('hello')}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Component.tsx",
      location: loc(source, "t('hello')"),
      library: "react-i18next",
    });
    expect(result.kind).toBe("i18n");
    if (result.kind === "i18n") {
      expect(result.key).toBe("hello");
      expect(result.namespace).toBeUndefined();
    }
  });

  it("scopes namespace to the nearest enclosing useTranslation binding (later component)", () => {
    const source = `import { useTranslation } from 'react-i18next';
function Header() {
  const { t } = useTranslation('common');
  return <p>{t('header.title')}</p>;
}
function AdminPanel() {
  const { t } = useTranslation('admin');
  return <p>{t('panel.title')}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Components.tsx",
      location: loc(source, "t('panel.title')"),
      library: "react-i18next",
    });
    expect(result.kind).toBe("i18n");
    if (result.kind === "i18n") {
      expect(result.key).toBe("panel.title");
      // Must resolve to AdminPanel's own 'admin' ns, NOT Header's first-in-file 'common'.
      expect(result.namespace).toBe("admin");
    }
  });

  it("scopes namespace to the nearest enclosing useTranslation binding (earlier component)", () => {
    const source = `import { useTranslation } from 'react-i18next';
function Header() {
  const { t } = useTranslation('common');
  return <p>{t('header.title')}</p>;
}
function AdminPanel() {
  const { t } = useTranslation('admin');
  return <p>{t('panel.title')}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Components.tsx",
      location: loc(source, "t('header.title')"),
      library: "react-i18next",
    });
    expect(result.kind).toBe("i18n");
    if (result.kind === "i18n") {
      expect(result.key).toBe("header.title");
      expect(result.namespace).toBe("common");
    }
  });

  it("does not borrow another component's namespace when the call's own hook has none", () => {
    const source = `import { useTranslation } from 'react-i18next';
function Header() {
  const { t } = useTranslation('common');
  return <p>{t('header.title')}</p>;
}
function Footer() {
  const { t } = useTranslation();
  return <p>{t('footer.title')}</p>;
}`;
    const result = detectI18nBinding({
      source,
      filePath: "Components.tsx",
      location: loc(source, "t('footer.title')"),
      library: "react-i18next",
    });
    expect(result.kind).toBe("i18n");
    if (result.kind === "i18n") {
      expect(result.key).toBe("footer.title");
      // Footer's own useTranslation() supplies no ns → undefined, NOT Header's 'common'.
      expect(result.namespace).toBeUndefined();
    }
  });
});
