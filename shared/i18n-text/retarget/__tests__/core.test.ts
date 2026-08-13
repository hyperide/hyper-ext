/**
 * @file Unit tests for the pure AST core of i18n key retargeting.
 *
 * Covers the design's "one parse" invariant: what scanBindings marks retargetable:true with a
 * bindingLoc, retargetBinding must locate deterministically by that loc; retargetable:false
 * must surface an honest error code, never a silent miss. Also covers the deterministic
 * fallback (unique t(oldKey) → ambiguous when >1) and dynamic/template → not-retargetable.
 */
import { describe, expect, it } from 'bun:test';
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
});
