/**
 * @file AstService cache-invalidation tests — Task 3 of move-any-intermittent plan.
 *
 * Accessed via: every AstService mutation (moveElement, updateStyles, etc.) — they
 * implicitly rely on a cache that stays consistent with disk. This file exercises
 * the explicit `invalidateFile()` API and the defensive freshen at the top of
 * `moveElement` that protects against stale NodeMapService state after an
 * external rewrite (HMR, prettier-on-save, file watcher event).
 * Assumptions: source-location nodeRefs resolve through NodeMapService; an external
 *   rewrite that shifts line numbers must be reflected before the next op.
 */
import { describe, expect, it } from 'bun:test';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import { AstService } from '../services/AstService';

const FIXTURE_V1 = `export default function FlexList() {
  return (
    <div className="parent">
      <div className="a">A</div>
      <div className="b">B</div>
      <div className="c">C</div>
    </div>
  );
}
`;

// Same logical structure but a leading line of whitespace shifts every JSX
// element down by one line. NodeMapService entries from V1 will all be off
// by one — exactly the failure mode external HMR / prettier-on-save creates.
const FIXTURE_V2 = `
export default function FlexList() {
  return (
    <div className="parent">
      <div className="a">A</div>
      <div className="b">B</div>
      <div className="c">C</div>
    </div>
  );
}
`;

interface NodeMapEntryLike {
  loc: { line: number; column: number };
  tag: string;
}

function refByClass(service: AstService, absPath: string, relPath: string, className: string, source: string): string {
  const entries = (service.nodeMapService.getNodeMap(absPath) ?? []) as NodeMapEntryLike[];
  const lines = source.split('\n');
  for (const e of entries) {
    if (e.tag !== 'div') continue;
    const sourceLine = lines[e.loc.line - 1] ?? '';
    if (sourceLine.includes(`className="${className}"`)) {
      return `${relPath}:${e.loc.line}:${e.loc.column}`;
    }
  }
  throw new Error(`No <div className="${className}"> in ${absPath}`);
}

describe('AstService cache invalidation (Task 3)', () => {
  it('invalidateFile() refreshes NodeMapService after external rewrite', async () => {
    const relPath = 'src/FlexList.tsx';
    const absPath = `/workspace/${relPath}`;
    const fileIO = new InMemoryFileIO({ [absPath]: FIXTURE_V1 });
    const service = new AstService('/workspace', fileIO);
    await service.ensureInitialized();

    // Capture refs against V1.
    const v1Entries = service.nodeMapService.getNodeMap(absPath) ?? [];
    const v1AEntry = (v1Entries as NodeMapEntryLike[]).find(
      (e) => e.tag === 'div' && (FIXTURE_V1.split('\n')[e.loc.line - 1] ?? '').includes('className="a"'),
    );
    expect(v1AEntry).toBeDefined();
    const v1Line = v1AEntry!.loc.line;

    // External rewrite — file content changes on disk without going through AstService.writeAST.
    await fileIO.writeFile(absPath, FIXTURE_V2);

    // Without invalidateFile() the NodeMapService still has the old line.
    const stale = service.nodeMapService.getNodeMap(absPath) ?? [];
    const staleAEntry = (stale as NodeMapEntryLike[]).find(
      (e) => e.tag === 'div' && (FIXTURE_V1.split('\n')[e.loc.line - 1] ?? '').includes('className="a"'),
    );
    expect(staleAEntry?.loc.line).toBe(v1Line);

    // After invalidateFile, NodeMapService reflects V2 line numbers (everything shifted +1).
    await service.invalidateFile(relPath);
    const fresh = service.nodeMapService.getNodeMap(absPath) ?? [];
    const freshAEntry = (fresh as NodeMapEntryLike[]).find(
      (e) => e.tag === 'div' && (FIXTURE_V2.split('\n')[e.loc.line - 1] ?? '').includes('className="a"'),
    );
    expect(freshAEntry).toBeDefined();
    expect(freshAEntry!.loc.line).toBe(v1Line + 1);
  });

  it('moveElement defensively freshens stale NodeMapService before resolving', async () => {
    const relPath = 'src/FlexList.tsx';
    const absPath = `/workspace/${relPath}`;
    const fileIO = new InMemoryFileIO({ [absPath]: FIXTURE_V1 });
    const service = new AstService('/workspace', fileIO);
    await service.ensureInitialized();

    // Capture refs against V1 (these have V1 line numbers).
    const sourceRefV1 = refByClass(service, absPath, relPath, 'a', FIXTURE_V1);
    const targetRefV1 = refByClass(service, absPath, relPath, 'b', FIXTURE_V1);

    // External rewrite shifts every element down by one line. The cached
    // NodeMapService still has V1 coords; without the defensive freshen
    // inside moveElement, `findElementByPosition` would resolve those V1
    // coords against the V2 AST and either miss entirely or land on the
    // wrong element ("source disappeared after re-parse").
    await fileIO.writeFile(absPath, FIXTURE_V2);

    // Build V2 refs and use them — these are the "fresh" refs the iframe
    // would send post-HMR. They expose whether moveElement re-syncs
    // NodeMapService before resolving (it must, since the cached V1 refs
    // are the source of truth in NodeMapService until refresh).
    // We can't compute V2 refs without invalidating first; the runtime
    // analogue is that the iframe sends source-location refs computed
    // against V2's text, and AstService must accept them.
    await service.invalidateFile(relPath);
    const sourceRefV2 = refByClass(service, absPath, relPath, 'a', FIXTURE_V2);
    const targetRefV2 = refByClass(service, absPath, relPath, 'b', FIXTURE_V2);
    expect(sourceRefV2).not.toBe(sourceRefV1);
    expect(targetRefV2).not.toBe(targetRefV1);

    // Now corrupt the cache again to simulate "iframe sends V2 refs but
    // NodeMapService caches V1": rewrite back-and-forth so NodeMapService
    // again holds outdated coords relative to file content.
    await fileIO.writeFile(absPath, FIXTURE_V1);
    // At this point: file=V1, NodeMapService=V2 → NodeMapService stale.
    // Iframe sends V1-style refs (sourceRefV1, targetRefV1). The defensive
    // freshen in moveElement must drop NodeMapService's V2 cache and
    // re-parse against V1 before resolving → move succeeds.
    const result = await service.moveElement(relPath, sourceRefV1, targetRefV1, 'after');
    expect(result.success).toBe(true);
    const after = fileIO.content(absPath);
    // Move semantics: A is moved after B → B precedes A.
    expect(after.indexOf('"b"')).toBeLessThan(after.indexOf('"a"'));
  });

  it('parser invalidate() drops cached AST so the next read re-parses', async () => {
    // Direct unit test for the parser-layer invalidate(). After invalidate(),
    // the next readAndParseFile call must re-read disk and re-parse — even
    // if the content matches what was cached, since invalidate signals a
    // forced re-parse for cases the content-equality check can't detect
    // (e.g. NodeMapService relies on a fresh AST instance).
    const { createFileParser } = await import('@lib/ast/parser');
    const fileIO = new InMemoryFileIO({ '/workspace/src/Foo.tsx': FIXTURE_V1 });
    const parser = createFileParser(fileIO);

    const r1 = await parser.readAndParseFile('/workspace/src/Foo.tsx');
    const r2 = await parser.readAndParseFile('/workspace/src/Foo.tsx');
    // Without invalidate, the cache returns the SAME ast instance.
    expect(r1.ast).toBe(r2.ast);

    parser.invalidate('/workspace/src/Foo.tsx');
    const r3 = await parser.readAndParseFile('/workspace/src/Foo.tsx');
    // After invalidate, re-parse produced a fresh ast instance even though
    // disk content is byte-identical.
    expect(r3.ast).not.toBe(r1.ast);
  });
});
