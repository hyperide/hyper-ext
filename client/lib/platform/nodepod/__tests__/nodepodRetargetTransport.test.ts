/**
 * @file NodePod retarget transport tests — the serverless SaaS path that runs the SAME shared
 *   handler/orchestrator the Docker backend runs, only over OPFS (HYP-372 Phase 2 / HYP-746).
 *
 * Uses the in-memory OPFS + Web Locks mock (happy-dom has neither API). Seeds a project tree under
 * hyper-nodepod/<projectId>/ with a source file + a locale dictionary, then drives:
 *   - existing-key retarget (rewrites the JSX in OPFS, byte-for-byte the orchestrator's output),
 *   - new-key create (locale-JSON-first: writes the dictionary entry THEN the JSX),
 *   - scan (reads OPFS source, runs shared scanBindings),
 *   - full locale-key list (every dictionary key, the combobox candidate set),
 *   - the project-mismatch / no-project clean error (no split-brain, no guessing a tree).
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { MockDirectoryHandle, MockLockManager } from '@shared/i18n-text/retarget/__tests__/helpers/opfs-mock';
import { OpfsFileIO } from '../opfsFileIO';
import { listNodePodLocaleKeys, runNodePodRetarget, scanNodePodBindings } from '../nodepodRetargetTransport';

/**
 * Wrap a MockDirectoryHandle so that getFile() on any file whose name === `targetName` awaits
 * `onRead()` before yielding its text. Subdirectories are wrapped recursively; all other handle
 * methods pass through. Used to force two concurrent locale reads to overlap so the lost-write race
 * is observable without a real browser FS.
 */
function makeLocaleReadGate(
  dir: MockDirectoryHandle,
  targetName: string,
  onRead: () => Promise<void>,
): MockDirectoryHandle {
  const wrap = (d: MockDirectoryHandle): MockDirectoryHandle =>
    new Proxy(d, {
      get(target, prop, receiver) {
        if (prop === 'getDirectoryHandle') {
          return async (name: string, opts?: { create?: boolean }) => wrap(await target.getDirectoryHandle(name, opts));
        }
        if (prop === 'getFileHandle') {
          return async (name: string, opts?: { create?: boolean }) => {
            const fh = await target.getFileHandle(name, opts);
            if (name !== targetName) return fh;
            return new Proxy(fh, {
              get(fhTarget, fhProp, fhReceiver) {
                if (fhProp === 'getFile') {
                  return async () => {
                    await onRead();
                    return fhTarget.getFile();
                  };
                }
                return Reflect.get(fhTarget, fhProp, fhReceiver);
              },
            });
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  return wrap(dir);
}

const PROJECT_ID = 'proj-42';

const SRC = `import { useTranslation } from 'react-i18next';
export function Hero() {
  const { t } = useTranslation();
  return <h1>{t('hero.title')}</h1>;
}
`;

const LOCALE_EN = JSON.stringify({ hero: { title: 'Title', subtitle: 'Sub' }, other: 'X' }, null, 2);

let root: MockDirectoryHandle;
let locks: MockLockManager;

function deps() {
  return {
    projectId: PROJECT_ID,
    getRoot: async () => root as unknown as FileSystemDirectoryHandle,
    locks: locks as unknown as LockManager,
  };
}

async function seedProject() {
  const io = new OpfsFileIO({
    projectId: PROJECT_ID,
    getRoot: async () => root as unknown as FileSystemDirectoryHandle,
  });
  await io.writeFile('/src/Hero.tsx', SRC);
  await io.writeFile('/locales/en.json', LOCALE_EN);
  await io.writeFile('/package.json', JSON.stringify({ dependencies: { 'react-i18next': '^14.0.0' } }));
}

beforeEach(async () => {
  root = new MockDirectoryHandle();
  locks = new MockLockManager();
  await seedProject();
});

describe('runNodePodRetarget — existing-key retarget over OPFS', () => {
  it('rewrites the JSX call site in OPFS and reports ok/written', async () => {
    const scan = await scanNodePodBindings({ filePath: 'src/Hero.tsx', library: 'react-i18next' }, deps());
    const binding = scan.bindings.find((b) => b.key === 'hero.title');
    expect(binding?.retargetable).toBe(true);

    const res = await runNodePodRetarget(
      {
        filePath: 'src/Hero.tsx',
        oldKey: 'hero.title',
        newKey: 'hero.subtitle', // exists in the dictionary
        bindingLoc: binding!.bindingLoc!,
        library: 'react-i18next',
        activeLocale: 'en',
        createIfMissing: false,
      },
      deps(),
    );
    expect(res.code).toBe('ok');
    expect(res.written).toBe(true);
    expect(res.resultingKey).toBe('hero.subtitle');

    const io = new OpfsFileIO({
      projectId: PROJECT_ID,
      getRoot: async () => root as unknown as FileSystemDirectoryHandle,
    });
    expect(await io.readFile('/src/Hero.tsx')).toContain("t('hero.subtitle')");
  });

  it('a NEW key without createIfMissing → not-retargetable, JSX untouched', async () => {
    const scan = await scanNodePodBindings({ filePath: 'src/Hero.tsx', library: 'react-i18next' }, deps());
    const binding = scan.bindings.find((b) => b.key === 'hero.title');
    const res = await runNodePodRetarget(
      {
        filePath: 'src/Hero.tsx',
        oldKey: 'hero.title',
        newKey: 'hero.brandNew',
        bindingLoc: binding!.bindingLoc!,
        library: 'react-i18next',
        activeLocale: 'en',
        createIfMissing: false,
      },
      deps(),
    );
    expect(res.code).toBe('not-retargetable');
    expect(res.written).toBe(false);
  });
});

describe('runNodePodRetarget — new-key create (locale-JSON-first)', () => {
  it('createIfMissing writes the locale entry THEN rewrites the JSX', async () => {
    const scan = await scanNodePodBindings({ filePath: 'src/Hero.tsx', library: 'react-i18next' }, deps());
    const binding = scan.bindings.find((b) => b.key === 'hero.title');

    const res = await runNodePodRetarget(
      {
        filePath: 'src/Hero.tsx',
        oldKey: 'hero.title',
        newKey: 'hero.fresh',
        bindingLoc: binding!.bindingLoc!,
        library: 'react-i18next',
        activeLocale: 'en',
        createIfMissing: true,
      },
      deps(),
    );
    expect(res.code).toBe('ok');
    expect(res.written).toBe(true);
    expect(res.resultingKey).toBe('hero.fresh');

    const io = new OpfsFileIO({
      projectId: PROJECT_ID,
      getRoot: async () => root as unknown as FileSystemDirectoryHandle,
    });
    // JSX rewritten...
    expect(await io.readFile('/src/Hero.tsx')).toContain("t('hero.fresh')");
    // ...and the locale dictionary now holds the new key, SEEDED from the old key's value (so the
    // call site keeps rendering the same text), not a blank or the raw key string (locale-first).
    const locale = JSON.parse(await io.readFile('/locales/en.json')) as { hero: Record<string, string> };
    expect(locale.hero.fresh).toBe('Title'); // = resolve('hero.title')
  });
});

describe('runNodePodRetarget — concurrent new-key creates serialize on the locale file', () => {
  it('two tabs creating DIFFERENT keys in the SAME locale → both keys survive (no lost write)', async () => {
    // Two distinct JSX files (so the orchestrator's per-JSX-file lock does NOT incidentally
    // serialize them — the locale read-modify-write is the ONLY shared critical section). Both
    // create a NEW key in the SAME en.json. Without the locale Web Lock both creates read the same
    // old JSON and the last write wins → one created key is lost.
    const io = new OpfsFileIO({
      projectId: PROJECT_ID,
      getRoot: async () => root as unknown as FileSystemDirectoryHandle,
    });
    await io.writeFile('/src/A.tsx', SRC);
    await io.writeFile('/src/B.tsx', SRC.replace('Hero', 'HeroB'));

    // A barrier that forces both en.json reads to overlap: a tracked read parks until BOTH creates
    // have entered their read, so absent serialization they observe identical old JSON (lost write).
    // A real Web Lock keeps the second read from starting until the first create's write commits, so
    // only ONE read can be in flight at a time → the barrier never reaches 2 and times out releasing
    // itself, but each create reads the OTHER's already-written key. Both keys survive.
    let entered = 0;
    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => {
      releaseGate = r;
    });
    const onTrackedRead = async () => {
      entered += 1;
      if (entered >= 2) releaseGate();
      // Cap the park so a correctly-serialized run (only ever 1 reader in flight) still completes.
      await Promise.race([gate, new Promise<void>((r) => setTimeout(r, 25))]);
    };
    const slowRoot = makeLocaleReadGate(root, 'en.json', onTrackedRead);

    const concurrentDeps = {
      projectId: PROJECT_ID,
      getRoot: async () => slowRoot as unknown as FileSystemDirectoryHandle,
      locks: locks as unknown as LockManager,
    };

    const reqFor = (filePath: string, newKey: string) => ({
      filePath,
      oldKey: 'hero.title',
      newKey,
      bindingLoc: { line: 4, column: 13 },
      library: 'react-i18next' as const,
      activeLocale: 'en',
      createIfMissing: true,
    });

    const [resA, resB] = await Promise.all([
      runNodePodRetarget(reqFor('src/A.tsx', 'hero.alpha'), concurrentDeps),
      runNodePodRetarget(reqFor('src/B.tsx', 'hero.beta'), concurrentDeps),
    ]);

    expect(resA.code).toBe('ok');
    expect(resB.code).toBe('ok');

    const locale = JSON.parse(await io.readFile('/locales/en.json')) as { hero: Record<string, string> };
    // BOTH created keys must survive — the lock serialized the read-modify-write.
    expect(locale.hero.alpha).toBeDefined();
    expect(locale.hero.beta).toBeDefined();
  });
});

describe('runNodePodRetarget — mirrors the write into the running pod FS (HMR)', () => {
  it('an existing-key retarget writes the updated JSX into the pod FS at /app/<path>', async () => {
    const scan = await scanNodePodBindings({ filePath: 'src/Hero.tsx', library: 'react-i18next' }, deps());
    const binding = scan.bindings.find((b) => b.key === 'hero.title');
    const writeToPod = mock<(path: string, content: string) => Promise<void>>(async () => {});

    const res = await runNodePodRetarget(
      {
        filePath: 'src/Hero.tsx',
        oldKey: 'hero.title',
        newKey: 'hero.subtitle',
        bindingLoc: binding!.bindingLoc!,
        library: 'react-i18next',
        activeLocale: 'en',
        createIfMissing: false,
      },
      { ...deps(), writeToPod },
    );
    expect(res.code).toBe('ok');

    // The JSX file is mirrored into the pod (project-relative path; the runtime prefixes /app/),
    // carrying the REWRITTEN source so Vite HMR fires on the running dev server.
    expect(writeToPod).toHaveBeenCalledTimes(1);
    const [path, content] = writeToPod.mock.calls[0]!;
    expect(path).toBe('src/Hero.tsx');
    expect(content).toContain("t('hero.subtitle')");
  });

  it('a new-key create mirrors BOTH the JSX and the locale JSON into the pod FS', async () => {
    const scan = await scanNodePodBindings({ filePath: 'src/Hero.tsx', library: 'react-i18next' }, deps());
    const binding = scan.bindings.find((b) => b.key === 'hero.title');
    const writeToPod = mock<(path: string, content: string) => Promise<void>>(async () => {});

    const res = await runNodePodRetarget(
      {
        filePath: 'src/Hero.tsx',
        oldKey: 'hero.title',
        newKey: 'hero.fresh',
        bindingLoc: binding!.bindingLoc!,
        library: 'react-i18next',
        activeLocale: 'en',
        createIfMissing: true,
      },
      { ...deps(), writeToPod },
    );
    expect(res.code).toBe('ok');

    const paths = writeToPod.mock.calls.map(([p]) => p);
    const mirrored = new Map(writeToPod.mock.calls.map(([p, c]) => [p, c]));
    // The locale dictionary write must reach the pod so the new translation is live for HMR...
    expect(mirrored.has('locales/en.json')).toBe(true);
    expect(JSON.parse(mirrored.get('locales/en.json')!).hero.fresh).toBe('Title');
    // ...and the rewritten JSX call site too.
    expect(mirrored.get('src/Hero.tsx')).toContain("t('hero.fresh')");
    // Locale-first: the dictionary is mirrored BEFORE the JSX, so the pod never has a live HMR
    // window where the source references a key the dictionary doesn't yet hold.
    expect(paths.indexOf('locales/en.json')).toBeLessThan(paths.indexOf('src/Hero.tsx'));
  });

  it('locale create succeeds but JSX rewrite fails → locale still mirrored, JSX not (retry-safe)', async () => {
    const writeToPod = mock<(path: string, content: string) => Promise<void>>(async () => {});

    // oldKey 'hero.subtitle' exists in the dictionary but is NOT bound anywhere in Hero.tsx, and the
    // bindingLoc points at no matching call → after the locale-first create writes hero.fresh, the
    // JSX rewrite can't locate the binding → not-retargetable. The pod must still get the locale (so a
    // retry, which now sees hero.fresh as existing, isn't left with a poisoned pod dictionary), but
    // must NOT get a JSX mirror (the rewrite failed).
    const res = await runNodePodRetarget(
      {
        filePath: 'src/Hero.tsx',
        oldKey: 'hero.subtitle',
        newKey: 'hero.fresh',
        bindingLoc: { line: 999, column: 0 },
        library: 'react-i18next',
        activeLocale: 'en',
        createIfMissing: true,
      },
      { ...deps(), writeToPod },
    );
    expect(res.code).not.toBe('ok');

    const paths = writeToPod.mock.calls.map(([p]) => p);
    expect(paths).toContain('locales/en.json');
    expect(paths).not.toContain('src/Hero.tsx');
  });

  it('does not throw when no pod is attached (writeToPod omitted)', async () => {
    const scan = await scanNodePodBindings({ filePath: 'src/Hero.tsx', library: 'react-i18next' }, deps());
    const binding = scan.bindings.find((b) => b.key === 'hero.title');
    const res = await runNodePodRetarget(
      {
        filePath: 'src/Hero.tsx',
        oldKey: 'hero.title',
        newKey: 'hero.subtitle',
        bindingLoc: binding!.bindingLoc!,
        library: 'react-i18next',
        activeLocale: 'en',
        createIfMissing: false,
      },
      deps(),
    );
    expect(res.code).toBe('ok');
  });
});

describe('scanNodePodBindings', () => {
  it('returns the retargetable binding from the OPFS source', async () => {
    const scan = await scanNodePodBindings({ filePath: 'src/Hero.tsx', library: 'react-i18next' }, deps());
    expect(scan.success).toBe(true);
    expect(scan.bindings.some((b) => b.retargetable && b.key === 'hero.title')).toBe(true);
  });

  it('a missing file is a clean failure, not a throw', async () => {
    const scan = await scanNodePodBindings({ filePath: 'src/Ghost.tsx', library: 'react-i18next' }, deps());
    expect(scan.success).toBe(false);
    expect(scan.bindings).toEqual([]);
  });
});

describe('listNodePodLocaleKeys — full dictionary (item 4)', () => {
  it('returns EVERY key in the active locale, not just in-file retargetable ones', async () => {
    const keys = await listNodePodLocaleKeys({ library: 'react-i18next', activeLocale: 'en' }, deps());
    // hero.subtitle and other are NOT bound in Hero.tsx, but ARE in the dictionary — must appear.
    expect(keys).toContain('hero.title');
    expect(keys).toContain('hero.subtitle');
    expect(keys).toContain('other');
  });
});

describe('project mismatch / no project — clean error, no split-brain', () => {
  it('a blank projectId yields unsupported, never operating on a guessed tree', async () => {
    const res = await runNodePodRetarget(
      {
        filePath: 'src/Hero.tsx',
        oldKey: 'hero.title',
        newKey: 'hero.subtitle',
        bindingLoc: { line: 4, column: 13 },
        library: 'react-i18next',
        activeLocale: 'en',
      },
      {
        projectId: '',
        getRoot: async () => root as unknown as FileSystemDirectoryHandle,
        locks: locks as unknown as LockManager,
      },
    );
    expect(res.code).toBe('unsupported');
    expect(res.written).toBe(false);
  });
});
