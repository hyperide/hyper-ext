/**
 * @file Orchestrator tests: lock → locate → rewrite → write, plus the conflict/idempotency
 *   acceptance test (#4) and the Phase-1 create-key gating + locale-first ordering scaffold.
 *
 * Uses an in-memory FileStore so the orchestrator's flow is exercised without disk. The
 * NodeFileStore/in-memory PARITY check lives in parity.test.ts.
 */
import { describe, expect, it } from 'bun:test';
import type { RetargetRequest } from '../contract';
import { scanBindings } from '../core';
import type { FileStore } from '../file-store';
import { run } from '../orchestrator';
import { memStore } from './helpers/in-memory-store';

const FILE = 'src/Hero.tsx';
const ABS = '/proj/src/Hero.tsx';

const SRC_OLD = `import { useTranslation } from 'react-i18next';
function Hero() {
  const { t } = useTranslation();
  return <h1>{t('hero.title')}</h1>;
}
`;

// Derive the bindingLoc from the SAME scan the read endpoint uses, so the test can't rot if the
// fixture is reformatted (magic line/column numbers would).
const HERO_LOC = scanBindings(SRC_OLD, { library: 'react-i18next' }).find((b) => b.key === 'hero.title')!.bindingLoc!;

function baseReq(over: Partial<RetargetRequest> = {}): RetargetRequest {
  return {
    filePath: FILE,
    oldKey: 'hero.title',
    newKey: 'hero.heading',
    bindingLoc: HERO_LOC,
    library: 'react-i18next',
    createIfMissing: false,
    ...over,
  };
}

const ctx = { resolveAbsolute: (_p: string) => ABS, availableKeys: ['hero.title', 'hero.heading'] };

describe('orchestrator.run — existing-key retarget', () => {
  it('rewrites old→new and writes durably', async () => {
    const store = memStore({ [ABS]: SRC_OLD });
    const res = await run(ctx, store, baseReq());
    expect(res.code).toBe('ok');
    expect(res.written).toBe(true);
    expect(res.resultingKey).toBe('hero.heading');
    expect(store.dump(ABS)).toContain("t('hero.heading')");
    expect(res.observedHash).toBeDefined();
  });

  it('IDEMPOTENCY: running the same req again (new→new) is a noop, no write', async () => {
    const store = memStore({ [ABS]: SRC_OLD });
    await run(ctx, store, baseReq());
    const afterFirst = store.dump(ABS);

    // Second run: file now holds newKey; loc still points at the call.
    const res2 = await run(ctx, store, baseReq());
    expect(res2.code).toBe('ok');
    expect(res2.written).toBe(false);
    expect(store.dump(ABS)).toBe(afterFirst); // unchanged
  });

  it('CONFLICT: a third-party value (∉ {old,new}) → hard-conflict, no write', async () => {
    const src = SRC_OLD.replace("t('hero.title')", "t('completely.different')");
    const store = memStore({ [ABS]: src });
    const res = await run(ctx, store, baseReq());
    expect(res.code).toBe('hard-conflict');
    expect(res.written).toBe(false);
    expect(store.dump(ABS)).toBe(src);
  });
});

describe('orchestrator.run — validation gate', () => {
  it('rejects a prototype-pollution key', async () => {
    const store = memStore({ [ABS]: SRC_OLD });
    const res = await run(ctx, store, baseReq({ newKey: '__proto__.polluted' }));
    expect(res.code).toBe('invalid-key');
    expect(res.written).toBe(false);
  });

  it('rejects an empty key', async () => {
    const store = memStore({ [ABS]: SRC_OLD });
    const res = await run(ctx, store, baseReq({ newKey: '' }));
    expect(res.code).toBe('invalid-key');
  });

  it('rejects a key with JSX-structural chars', async () => {
    const store = memStore({ [ABS]: SRC_OLD });
    const res = await run(ctx, store, baseReq({ newKey: 'has{brace}' }));
    expect(res.code).toBe('invalid-key');
  });
});

describe('orchestrator.run — Phase 1 create-key gating', () => {
  it('newKey absent from dictionary + createIfMissing=false → not-retargetable', async () => {
    const store = memStore({ [ABS]: SRC_OLD });
    const res = await run(
      { resolveAbsolute: () => ABS, availableKeys: ['hero.title'] }, // newKey not present
      store,
      baseReq({ newKey: 'hero.brandNew' }),
    );
    expect(res.code).toBe('not-retargetable');
    expect(res.written).toBe(false);
    expect(res.reason).toBeDefined();
  });

  // Without a createLocaleKey hook (the Docker Phase-1 context shape), createIfMissing for a new
  // key STILL cannot create — the orchestrator has no way to write the dictionary. It stays
  // not-retargetable and performs no write. This preserves the Docker backend's Phase-1 behavior
  // until that route opts into create by supplying the hook.
  it('createIfMissing=true but NO createLocaleKey hook → not-retargetable, no write', async () => {
    const store = memStore({ [ABS]: SRC_OLD });
    let wrote = false;
    const spyStore: FileStore = {
      read: store.read,
      hash: store.hash,
      withLock: store.withLock,
      async write(p, c) {
        wrote = true;
        return store.write(p, c);
      },
    };
    const res = await run(
      { resolveAbsolute: () => ABS, availableKeys: ['hero.title'] },
      spyStore,
      baseReq({ newKey: 'hero.brandNew', createIfMissing: true }),
    );
    expect(res.code).toBe('not-retargetable');
    expect(res.written).toBe(false);
    expect(wrote).toBe(false);
  });
});

describe('orchestrator.run — Phase 2 new-key create (locale-JSON-first)', () => {
  it('createIfMissing=true + createLocaleKey: writes locale FIRST, then rewrites JSX', async () => {
    const store = memStore({ [ABS]: SRC_OLD });
    const calls: string[] = [];
    const res = await run(
      {
        resolveAbsolute: () => ABS,
        availableKeys: ['hero.title'], // newKey NOT present → triggers create
        async createLocaleKey(req) {
          // The locale write must happen before any JSX write.
          calls.push(`locale:${req.newKey}`);
          return { ok: true, localePath: '/proj/locales/en.json' };
        },
      },
      store,
      baseReq({ newKey: 'hero.brandNew', createIfMissing: true, activeLocale: 'en' }),
    );
    expect(res.code).toBe('ok');
    expect(res.written).toBe(true);
    expect(res.resultingKey).toBe('hero.brandNew');
    expect(store.dump(ABS)).toContain("t('hero.brandNew')");
    // The JSX now binds the new key, AND the locale write ran (locale-first ordering).
    expect(calls).toEqual(['locale:hero.brandNew']);
  });

  it('createLocaleKey FAILS → locale-write-failed, JSX is left UNTOUCHED', async () => {
    const store = memStore({ [ABS]: SRC_OLD });
    let jsxWrote = false;
    const spyStore: FileStore = {
      read: store.read,
      hash: store.hash,
      withLock: store.withLock,
      async write(p, c) {
        jsxWrote = true;
        return store.write(p, c);
      },
    };
    const res = await run(
      {
        resolveAbsolute: () => ABS,
        availableKeys: ['hero.title'],
        async createLocaleKey() {
          return { ok: false };
        },
      },
      spyStore,
      baseReq({ newKey: 'hero.brandNew', createIfMissing: true, activeLocale: 'en' }),
    );
    expect(res.code).toBe('locale-write-failed');
    expect(res.written).toBe(false);
    expect(jsxWrote).toBe(false); // JSX untouched — locale failed before it
    expect(store.dump(ABS)).toBe(SRC_OLD);
  });

  it('createLocaleKey is NOT called when the key already exists (plain existing-key retarget)', async () => {
    const store = memStore({ [ABS]: SRC_OLD });
    let createCalled = false;
    const res = await run(
      {
        resolveAbsolute: () => ABS,
        availableKeys: ['hero.title', 'hero.heading'], // newKey present
        async createLocaleKey() {
          createCalled = true;
          return { ok: true };
        },
      },
      store,
      baseReq({ newKey: 'hero.heading', createIfMissing: true }),
    );
    expect(res.code).toBe('ok');
    expect(res.written).toBe(true);
    expect(createCalled).toBe(false); // existing key — no locale create needed
  });
});
