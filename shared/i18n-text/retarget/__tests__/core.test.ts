/**
 * @file Unit tests for the pure AST core of i18n key retargeting.
 *
 * Covers the design's "one parse" invariant: what scanBindings marks retargetable:true with a
 * bindingLoc, retargetBinding must locate deterministically by that loc; retargetable:false
 * must surface an honest error code, never a silent miss. Also covers the deterministic
 * fallback (unique t(oldKey) → ambiguous when >1) and dynamic/template → not-retargetable.
 */
import { describe, expect, it } from 'bun:test';
import { parseCode } from '../../../../lib/ast/parser';
import { retargetBinding, scanBindings } from '../core';

const REACT_I18NEXT = 'react-i18next' as const;

describe('scanBindings', () => {
  it('finds a static t(key) call and marks it retargetable with a bindingLoc', () => {
    const source = `import { useTranslation } from 'react-i18next';
function C() {
  const { t } = useTranslation();
  return <span>{t('hero.title')}</span>;
}
`;
    const bindings = scanBindings(source, { library: REACT_I18NEXT });
    const hit = bindings.find((b) => b.key === 'hero.title');
    expect(hit).toBeDefined();
    expect(hit?.retargetable).toBe(true);
    expect(hit?.bindingLoc).toBeDefined();
    expect(hit?.bindingLoc?.line).toBe(4);
  });

  it('marks a dynamic key (template / variable) as NOT retargetable', () => {
    const source = `import { useTranslation } from 'react-i18next';
function C({ name }: { name: string }) {
  const { t } = useTranslation();
  return <span>{t(\`greeting.\${name}\`)}</span>;
}
`;
    const bindings = scanBindings(source, { library: REACT_I18NEXT });
    // A dynamic key has no static key to surface; if it is reported at all it must be
    // retargetable:false. The contract is: never mark a dynamic binding retargetable.
    const anyRetargetable = bindings.some((b) => b.retargetable);
    expect(anyRetargetable).toBe(false);
  });

  it('reports multiple distinct static bindings in one file', () => {
    const source = `import { useTranslation } from 'react-i18next';
function C() {
  const { t } = useTranslation();
  return <div>{t('a.one')}<span>{t('a.two')}</span></div>;
}
`;
    const bindings = scanBindings(source, { library: REACT_I18NEXT });
    const keys = bindings
      .filter((b) => b.retargetable)
      .map((b) => b.key)
      .sort();
    expect(keys).toEqual(['a.one', 'a.two']);
  });

  // CODEX BOT FINDING (HYP-372): scan must not promise a capability the write path lacks.
  // detectI18nBinding recognizes object-style formatMessage({ id }) as kind:'i18n', but the
  // write path's locateByLoc/locateByKey only handle a first-arg StringLiteral t('key'). If
  // scan marked the object-style call retargetable:true the inspector would offer a retarget
  // the server could never perform — the capability ↔ locate invariant would be violated.
  it('object-style formatMessage({ id }) → NOT retargetable (write path cannot locate it)', () => {
    const source = `import { useIntl } from 'react-intl';
function C() {
  const { formatMessage } = useIntl();
  return <span>{formatMessage({ id: 'hero.title' })}</span>;
}
`;
    const bindings = scanBindings(source, { library: 'react-intl' });
    // The object-style call is reported, but never as retargetable.
    const objectStyle = bindings.find((b) => !b.retargetable);
    expect(objectStyle).toBeDefined();
    expect(objectStyle?.unretargetableReason).toBeDefined();
    expect(bindings.some((b) => b.retargetable)).toBe(false);
  });

  it('tagged-template msg`key` → NOT retargetable (write path only rewrites a StringLiteral arg)', () => {
    const source = `import { msg } from '@lingui/macro';
function C() {
  return <span>{msg\`hero.title\`}</span>;
}
`;
    const bindings = scanBindings(source, { library: 'lingui' });
    expect(bindings.some((b) => b.retargetable)).toBe(false);
  });

  // The invariant, asserted directly: every binding scan marks retargetable:true must be
  // locatable by retargetBinding at its bindingLoc; everything it marks false must NOT be.
  it('retargetable flag exactly matches what retargetBinding can locate', () => {
    const source = `import { useTranslation } from 'react-i18next';
import { useIntl } from 'react-intl';
function C({ name }: { name: string }) {
  const { t } = useTranslation();
  const { formatMessage } = useIntl();
  return (
    <div>
      {t('static.one')}
      {formatMessage({ id: 'object.style' })}
      {t(\`dynamic.\${name}\`)}
    </div>
  );
}
`;
    const bindings = scanBindings(source, { library: REACT_I18NEXT });
    for (const b of bindings) {
      // retargetBinding with the SAME oldKey scan saw, at the SAME bindingLoc (when present).
      const result = retargetBinding(source, {
        filePath: 'src/C.tsx',
        oldKey: b.key ?? '',
        newKey: `${b.key ?? ''}.renamed`,
        bindingLoc: b.bindingLoc ?? { line: 0, column: 0 },
        library: REACT_I18NEXT,
      });
      if (b.retargetable) {
        // Must locate + rewrite — never a locate failure.
        expect(result.code).toBe('ok');
      } else {
        // Must NOT be locatable as a successful rewrite at its (absent) loc.
        expect(result.code).not.toBe('ok');
      }
    }
  });
});

describe('retargetBinding — capability ↔ locate agree', () => {
  it('locates the binding scanBindings marked retargetable by its bindingLoc and rewrites it', () => {
    const source = `import { useTranslation } from 'react-i18next';
function C() {
  const { t } = useTranslation();
  return <span>{t('hero.title')}</span>;
}
`;
    const scanned = scanBindings(source, { library: REACT_I18NEXT }).find((b) => b.key === 'hero.title');
    expect(scanned?.retargetable).toBe(true);

    const result = retargetBinding(source, {
      filePath: 'src/C.tsx',
      oldKey: 'hero.title',
      newKey: 'hero.heading',
      bindingLoc: scanned!.bindingLoc!,
      library: REACT_I18NEXT,
    });
    expect(result.code).toBe('ok');
    expect(result.source).toContain("t('hero.heading')");
    expect(result.source).not.toContain("t('hero.title')");
  });

  it('preserves the rest of the file byte-for-byte except the swapped key', () => {
    const source = `import { useTranslation } from 'react-i18next';
function C() {
  const { t } = useTranslation();
  return (
    <div className="wrap">
      {t('hero.title')}
    </div>
  );
}
`;
    const scanned = scanBindings(source, { library: REACT_I18NEXT }).find((b) => b.key === 'hero.title');
    const result = retargetBinding(source, {
      filePath: 'src/C.tsx',
      oldKey: 'hero.title',
      newKey: 'hero.heading',
      bindingLoc: scanned!.bindingLoc!,
      library: REACT_I18NEXT,
    });
    expect(result.code).toBe('ok');
    // Only the key changed; surrounding formatting/structure intact.
    expect(result.source).toBe(source.replace("t('hero.title')", "t('hero.heading')"));
  });

  it('dynamic / template key → not-retargetable (honest error, not a silent miss)', () => {
    const source = `import { useTranslation } from 'react-i18next';
function C({ name }: { name: string }) {
  const { t } = useTranslation();
  return <span>{t(\`greeting.\${name}\`)}</span>;
}
`;
    const result = retargetBinding(source, {
      filePath: 'src/C.tsx',
      oldKey: 'greeting',
      newKey: 'salutation',
      bindingLoc: { line: 4, column: 18 },
      library: REACT_I18NEXT,
    });
    expect(result.code).toBe('not-retargetable');
  });

  it('falls back to the UNIQUE t(oldKey) when bindingLoc misses', () => {
    const source = `import { useTranslation } from 'react-i18next';
function C() {
  const { t } = useTranslation();
  return <span>{t('only.key')}</span>;
}
`;
    const result = retargetBinding(source, {
      filePath: 'src/C.tsx',
      oldKey: 'only.key',
      newKey: 'only.renamed',
      // Deliberately wrong loc — must fall back to the unique t('only.key').
      bindingLoc: { line: 999, column: 0 },
      library: REACT_I18NEXT,
    });
    expect(result.code).toBe('ok');
    expect(result.source).toContain("t('only.renamed')");
  });

  it('multiple t(oldKey) with a missed bindingLoc → ambiguous-binding (never guess file-wide)', () => {
    const source = `import { useTranslation } from 'react-i18next';
function C() {
  const { t } = useTranslation();
  return <div>{t('dup.key')}<span>{t('dup.key')}</span></div>;
}
`;
    const result = retargetBinding(source, {
      filePath: 'src/C.tsx',
      oldKey: 'dup.key',
      newKey: 'dup.renamed',
      bindingLoc: { line: 999, column: 0 },
      library: REACT_I18NEXT,
    });
    expect(result.code).toBe('ambiguous-binding');
    expect(result.source).toBe(source); // unchanged
  });

  it('hard-conflict when the located node key is neither oldKey nor newKey', () => {
    const source = `import { useTranslation } from 'react-i18next';
function C() {
  const { t } = useTranslation();
  return <span>{t('someone.else')}</span>;
}
`;
    const scanned = scanBindings(source, { library: REACT_I18NEXT }).find((b) => b.key === 'someone.else');
    const result = retargetBinding(source, {
      filePath: 'src/C.tsx',
      oldKey: 'hero.title', // not what's actually there
      newKey: 'hero.heading',
      bindingLoc: scanned!.bindingLoc!,
      library: REACT_I18NEXT,
    });
    expect(result.code).toBe('hard-conflict');
    expect(result.source).toBe(source);
  });

  it('idempotent: when the located node already holds newKey → ok noop', () => {
    const source = `import { useTranslation } from 'react-i18next';
function C() {
  const { t } = useTranslation();
  return <span>{t('hero.heading')}</span>;
}
`;
    const scanned = scanBindings(source, { library: REACT_I18NEXT }).find((b) => b.key === 'hero.heading');
    const result = retargetBinding(source, {
      filePath: 'src/C.tsx',
      oldKey: 'hero.title',
      newKey: 'hero.heading',
      bindingLoc: scanned!.bindingLoc!,
      library: REACT_I18NEXT,
    });
    expect(result.code).toBe('ok');
    expect(result.written).toBe(false); // noop — nothing to write
    expect(result.source).toBe(source);
  });

  it('unparseable source → unsupported', () => {
    const source = `function C( { return <span>{t('x')}</span>;`;
    const result = retargetBinding(source, {
      filePath: 'src/C.tsx',
      oldKey: 'x',
      newKey: 'y',
      bindingLoc: { line: 1, column: 30 },
      library: REACT_I18NEXT,
    });
    expect(result.code).toBe('unsupported');
  });

  it('still rewrites on a CRLF source (offset-drift fallback, HYP-877 P2)', () => {
    // spliceNodeSource refuses CRLF sources (normalized offsets misindex the raw bytes), so the
    // rewrite must land through the whole-file printAST fallback: the change APPLIES and the
    // file stays valid — a silent 'unsupported' or a corrupted splice would both fail this
    // (codex P2: this caller previously had no AST-write fallback, unlike style-write).
    const source = `import { useTranslation } from 'react-i18next';

export function C() {
  const { t } = useTranslation();
  return <span>{t('hero.title')}</span>;
}
`.replaceAll('\n', '\r\n');
    const scanned = scanBindings(source, { library: REACT_I18NEXT }).find((b) => b.key === 'hero.title');
    expect(scanned?.retargetable).toBe(true);

    const result = retargetBinding(source, {
      filePath: 'src/C.tsx',
      oldKey: 'hero.title',
      newKey: 'hero.heading',
      bindingLoc: scanned!.bindingLoc!,
      library: REACT_I18NEXT,
    });
    expect(result.code).toBe('ok');
    expect(result.written).toBe(true);
    expect(result.source).toContain("t('hero.heading')");
    expect(result.source).not.toContain("t('hero.title')");
    expect(() => parseCode(result.source)).not.toThrow();

    // recast's whole-file reprint LF-joins every line ending on its own (verified empirically:
    // parseCode+printAST with zero edits already flattens CRLF -> LF), which would otherwise turn
    // a one-key rewrite into a diff touching every line — the churn class HYP-877 exists to
    // prevent, just on this callsite. wholeFileFallback restores CRLF, recovering full byte-
    // identity outside the touched call: pin the exact output so a regression (CRLF churn
    // creeping back in, or genuine corruption) is caught immediately.
    expect(result.source).toBe(source.replace("t('hero.title')", "t('hero.heading')"));
  });

  it('still rewrites on a tab-indented source (offset-drift fallback, HYP-877 P2)', () => {
    const source = `import { useTranslation } from 'react-i18next';

export function C() {
\tconst { t } = useTranslation();
\treturn <span>{t('hero.title')}</span>;
}
`;
    const result = retargetBinding(source, {
      filePath: 'src/C.tsx',
      oldKey: 'hero.title',
      newKey: 'hero.heading',
      // Deliberately wrong loc: exercises the write-path splice fallback via the "unique
      // t(oldKey)" locate path (same as the "falls back to the UNIQUE t(oldKey)" test above),
      // sidestepping a separate pre-existing bug where detectI18nBinding re-parses with plain
      // @babel/parser (no recast tab-expansion) so its column never matches the recast-derived
      // bindingLoc scanBindings would emit for a tab-indented line — unrelated to this guard.
      bindingLoc: { line: 999, column: 0 },
      library: REACT_I18NEXT,
    });
    expect(result.code).toBe('ok');
    expect(result.written).toBe(true);
    expect(() => parseCode(result.source)).not.toThrow();
    // Unlike CRLF, tabs round-trip through printAST unmodified — the fallback here is byte-
    // identical to the source except for the swapped key.
    expect(result.source).toBe(source.replace("t('hero.title')", "t('hero.heading')"));
  });

  it('composes the CRLF splice fallback with the "unique t(oldKey)" locate fallback', () => {
    // Both fallbacks in the same call: a missed bindingLoc AND a CRLF source. Guards against a
    // future refactor accidentally coupling one fallback's success to the other's.
    const source = `import { useTranslation } from 'react-i18next';

export function C() {
  const { t } = useTranslation();
  return <span>{t('only.key')}</span>;
}
`.replaceAll('\n', '\r\n');
    const result = retargetBinding(source, {
      filePath: 'src/C.tsx',
      oldKey: 'only.key',
      newKey: 'only.renamed',
      bindingLoc: { line: 999, column: 0 }, // miss → falls back to the unique t('only.key')
      library: REACT_I18NEXT,
    });
    expect(result.code).toBe('ok');
    expect(result.written).toBe(true);
    expect(result.source).toBe(source.replace("t('only.key')", "t('only.renamed')"));
  });

  it('refuses (not corrupts) a MIXED CRLF/LF source rather than risk flattening an embedded value (review round 3)', () => {
    // A stray bare '\n' (e.g. a cross-platform-edited file) means the source is not uniformly
    // CRLF: recast's whole-file reprint would LF-join everywhere, and on a mixed file that could
    // flatten a genuine '\r\n' living INSIDE a template literal / JSX text value elsewhere in the
    // file — corrupting that literal's runtime value, not just reformatting it. Refuse, same as
    // spliceNodeSource's own guard, rather than trade a safe 'unsupported' for an unsafe write.
    const source =
      "import { useTranslation } from 'react-i18next';\r\n" +
      '\r\n' +
      'export function C() {\r\n' +
      '  const { t } = useTranslation();\n' + // stray bare LF among CRLF siblings
      "  return <span>{t('hero.title')}</span>;\r\n" +
      '}\r\n';
    const result = retargetBinding(source, {
      filePath: 'src/C.tsx',
      oldKey: 'hero.title',
      newKey: 'hero.heading',
      bindingLoc: { line: 999, column: 0 }, // force the unique-key locate fallback
      library: REACT_I18NEXT,
    });
    expect(result.code).toBe('unsupported');
    expect(result.written).toBe(false);
    expect(result.source).toBe(source); // unchanged — refusal, not a partial/lossy write
  });

  it('refuses rather than flatten a genuine embedded CRLF inside a template literal on an otherwise-LF file (review round 3)', () => {
    // Empirically verified: printAST alone (zero mutations) turns a real embedded '\r\n' inside a
    // template literal's VALUE into '\n' on an LF-dominant file — a semantic corruption, not mere
    // reformatting. The source has '\r' (so spliceNodeSource's guard fires) but is not uniformly
    // CRLF, so wholeFileFallback must refuse rather than risk that corruption.
    const source =
      "import { useTranslation } from 'react-i18next';\n" +
      '\n' +
      'export function C() {\n' +
      '  const { t } = useTranslation();\n' +
      "  const banner = `line1\r\nline2`;\n" + // genuine embedded CRLF inside the literal's VALUE
      "  return <span>{t('hero.title')}</span>;\n" +
      '}\n';
    const result = retargetBinding(source, {
      filePath: 'src/C.tsx',
      oldKey: 'hero.title',
      newKey: 'hero.heading',
      bindingLoc: { line: 999, column: 0 },
      library: REACT_I18NEXT,
    });
    expect(result.code).toBe('unsupported');
    expect(result.written).toBe(false);
    expect(result.source).toBe(source);
  });

  it('refuses a lone-\\r (old-Mac-style) source rather than guess (review round 4)', () => {
    // A '\r' not immediately followed by '\n' is neither "no \\r at all" nor "uniformly CRLF" —
    // wholeFileFallback's third, unprovable case. Must refuse, not silently reprint.
    const source =
      "import { useTranslation } from 'react-i18next';\r" +
      '\r' +
      'export function C() {\r' +
      '  const { t } = useTranslation();\r' +
      "  return <span>{t('hero.title')}</span>;\r" +
      '}\r';
    const result = retargetBinding(source, {
      filePath: 'src/C.tsx',
      oldKey: 'hero.title',
      newKey: 'hero.heading',
      bindingLoc: { line: 999, column: 0 },
      library: REACT_I18NEXT,
    });
    expect(result.code).toBe('unsupported');
    expect(result.written).toBe(false);
    expect(result.source).toBe(source);
  });

  it('rewrites byte-identically (outside the swapped key) on a uniform-CRLF file with an embedded CRLF inside a template literal', () => {
    // The positive counterpart to the two refusal tests above: proves the uniform-CRLF branch is
    // actually SAFE, not just "doesn't obviously corrupt anything" — the template literal's own
    // internal CRLF (which matches the file's uniform convention) round-trips through
    // normalize-to-LF-then-restore-to-CRLF without being flattened or doubled.
    const source =
      "import { useTranslation } from 'react-i18next';\r\n" +
      '\r\n' +
      'export function C() {\r\n' +
      '  const { t } = useTranslation();\r\n' +
      "  const banner = `line1\r\nline2`;\r\n" + // embedded CRLF matches the file's own convention
      "  return <span>{t('hero.title')}</span>;\r\n" +
      '}\r\n';
    const result = retargetBinding(source, {
      filePath: 'src/C.tsx',
      oldKey: 'hero.title',
      newKey: 'hero.heading',
      bindingLoc: { line: 999, column: 0 },
      library: REACT_I18NEXT,
    });
    expect(result.code).toBe('ok');
    expect(result.written).toBe(true);
    expect(result.source).toBe(source.replace("t('hero.title')", "t('hero.heading')"));
  });

  it('rewrites byte-identically on a source that is BOTH uniform-CRLF AND tab-indented', () => {
    // The two "provably safe" branches (no-CRLF-with-tabs, and uniform-CRLF) are only tested in
    // isolation elsewhere — this combines them: tabs survive the CRLF-only '\n' -> '\r\n' restore
    // untouched, since that replace only ever targets line-ending characters.
    const source =
      "import { useTranslation } from 'react-i18next';\r\n" +
      '\r\n' +
      'export function C() {\r\n' +
      '\tconst { t } = useTranslation();\r\n' +
      "\treturn <span>{t('hero.title')}</span>;\r\n" +
      '}\r\n';
    const result = retargetBinding(source, {
      filePath: 'src/C.tsx',
      oldKey: 'hero.title',
      newKey: 'hero.heading',
      bindingLoc: { line: 999, column: 0 },
      library: REACT_I18NEXT,
    });
    expect(result.code).toBe('ok');
    expect(result.written).toBe(true);
    expect(result.source).toBe(source.replace("t('hero.title')", "t('hero.heading')"));
  });
});
