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

  // Locale-JSON-first ordering scaffold: for a new key, Phase 2 must write the locale dictionary
  // BEFORE touching the JSX. Phase 1 hard-returns before any write — this test pins that the
  // create flow performs NO file write yet (neither locale nor JSX), so the future Phase-2
  // addition is the only thing that introduces the locale write.
  it('createIfMissing=true for a new key → deferred to Phase 2, performs NO write', async () => {
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
    expect(wrote).toBe(false); // no locale write, no JSX write — ordering scaffold only
  });
});
