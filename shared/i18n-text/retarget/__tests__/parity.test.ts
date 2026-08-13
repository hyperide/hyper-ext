/**
 * @file ACCEPTANCE TEST #1 — PARITY: one retarget Req against one source fixture, run through the
 *   real NodeFileStore AND an in-memory FileStore mock, must yield a byte-identical Response AND
 *   byte-identical resulting file content. This is the proof that the orchestrator is genuinely
 *   transport-agnostic — the same flow, same bytes, regardless of which FileStore is injected.
 *
 * Plus ACCEPTANCE TEST #2 (capability↔locate agree) at the module seam: a scanBindings-marked
 *   retargetable binding, driven through run(), lands exactly the rewrite; a non-retargetable one
 *   surfaces an honest error code.
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RetargetRequest } from '../contract';
import { scanBindings } from '../core';
import { NodeFileStore } from '../node-file-store';
import { OpfsFileStore } from '../opfs-file-store';
import { type OrchestratorContext, run } from '../orchestrator';
import { memStore } from './helpers/in-memory-store';
import { MockDirectoryHandle, MockLockManager } from './helpers/opfs-mock';

const FIXTURE = `import { useTranslation } from 'react-i18next';

export function Hero() {
  const { t } = useTranslation();
  return (
    <section className="hero">
      <h1>{t('hero.title')}</h1>
      <p>{t('hero.subtitle')}</p>
    </section>
  );
}
`;

describe('ACCEPTANCE #1 — NodeFileStore vs in-memory FileStore parity', () => {
  it('produces byte-identical Response and resulting file content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'retarget-parity-'));
    const abs = join(dir, 'Hero.tsx');
    await writeFile(abs, FIXTURE, 'utf-8');

    // Locate the binding via the SAME scan the read endpoint uses (capability↔locate agreement).
    const scanned = scanBindings(FIXTURE, { library: 'react-i18next' }).find((b) => b.key === 'hero.title');
    expect(scanned?.retargetable).toBe(true);

    const req: RetargetRequest = {
      filePath: 'Hero.tsx',
      oldKey: 'hero.title',
      newKey: 'hero.heading',
      bindingLoc: scanned!.bindingLoc!,
      library: 'react-i18next',
      createIfMissing: false,
    };
    const ctx: OrchestratorContext = {
      resolveAbsolute: () => abs,
      availableKeys: ['hero.title', 'hero.heading', 'hero.subtitle'],
    };

    // Path 1: real disk.
    const nodeStore = new NodeFileStore();
    const nodeRes = await run(ctx, nodeStore, req);
    const nodeContent = await readFile(abs, 'utf-8');

    // Path 2: in-memory mock, same fixture.
    const mem = memStore({ [abs]: FIXTURE });
    const memRes = await run({ ...ctx, resolveAbsolute: () => abs }, mem, req);
    const memContent = await mem.read(abs);

    // Path 3: OpfsFileStore over the in-memory OPFS + Web Locks mock — the NodePod transport. The
    // store keys on project-relative paths under hyper-nodepod/<projectId>/, so resolveAbsolute
    // returns the relative path here (the orchestrator just forwards whatever the ctx resolves).
    const opfsRoot = new MockDirectoryHandle();
    const opfs = new OpfsFileStore({
      projectId: 'parity-proj',
      getRoot: async () => opfsRoot as unknown as FileSystemDirectoryHandle,
      locks: new MockLockManager() as unknown as LockManager,
    });
    await opfs.write('Hero.tsx', FIXTURE);
    const opfsRes = await run({ ...ctx, resolveAbsolute: () => 'Hero.tsx' }, opfs, req);
    const opfsContent = await opfs.read('Hero.tsx');

    // Byte-identical responses across ALL THREE transports — the orchestrator is transport-agnostic.
    expect(memRes).toEqual(nodeRes);
    expect(opfsRes).toEqual(nodeRes);
    // Byte-identical resulting file content across disk, in-memory, and OPFS.
    expect(memContent).toBe(nodeContent);
    expect(opfsContent).toBe(nodeContent);
    // And the rewrite actually happened.
    expect(nodeRes.code).toBe('ok');
    expect(nodeContent).toContain("t('hero.heading')");
    expect(nodeContent).toContain("t('hero.subtitle')"); // sibling untouched
  });
});

describe('ACCEPTANCE #2 — capability ↔ locate agree (through orchestrator)', () => {
  it('a retargetable binding lands the rewrite; a non-retargetable one errors honestly', async () => {
    const dynamicFixture = `import { useTranslation } from 'react-i18next';
export function C({ id }: { id: string }) {
  const { t } = useTranslation();
  return <span>{t(\`dyn.\${id}\`)}</span>;
}
`;
    // Nothing in this file is retargetable.
    const scanned = scanBindings(dynamicFixture, { library: 'react-i18next' });
    expect(scanned.some((b) => b.retargetable)).toBe(false);

    const abs = '/virtual/C.tsx';
    const mem = memStore({ [abs]: dynamicFixture });
    const res = await run({ resolveAbsolute: () => abs, availableKeys: ['dyn.renamed'] }, mem, {
      filePath: 'C.tsx',
      oldKey: 'dyn',
      newKey: 'dyn.renamed',
      bindingLoc: { line: 4, column: 16 },
      library: 'react-i18next',
      createIfMissing: false,
    });
    // Honest error, not a silent miss / not a wrong write.
    expect(res.code).toBe('not-retargetable');
    expect(res.written).toBe(false);
    expect(await mem.read(abs)).toBe(dynamicFixture);
  });
});
