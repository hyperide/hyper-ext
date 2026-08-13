/**
 * @file AstService.swapElements unit tests — visual-foundation spec Part C,
 * Task 8: container swap ("drag card A onto card B → the two cards trade
 * places").
 *
 * Accessed via: a future swap gesture → ast:swapElements → AstService.swapElements.
 * swapElements is the SEPARATE gesture from moveElement (Task 7 = reparent):
 * dragging an element now reparents it; swapping two containers is this method.
 *
 * Assumptions:
 *   - both nodeRefs resolve to the same file (cross-file swap is unsupported);
 *   - nodeRefs are `relPath:line:col` strings resolved through NodeMapService;
 *   - swapElements throws on internal failure (no `success: false` branch).
 *
 * The card-swap geometry that the old liftToCommonJsxParent path inside
 * moveElement used to serve (PI-5-DR-16 / PI-5-DR-17) lives here now: when the
 * two refs point at INNER elements of two sibling cards, swapElements lifts
 * each to the outer card and swaps the cards, contents intact.
 */
import { describe, expect, it } from 'bun:test';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import { AstService } from '../services/AstService';

const GRID_FIXTURE = `export default function Grid() {
  return (
    <div className="grid">
      <div className="card1">
        <h3 className="t1">Title One</h3>
        <p className="b1">Body One</p>
      </div>
      <div className="card2">
        <h3 className="t2">Title Two</h3>
        <p className="b2">Body Two</p>
      </div>
    </div>
  );
}
`;

const SIBLINGS_FIXTURE = `export default function Row() {
  return (
    <div className="row">
      <span className="a">A</span>
      <span className="b">B</span>
      <span className="c">C</span>
    </div>
  );
}
`;

interface NodeMapEntryLike {
  loc: { line: number; column: number };
  tag: string;
}

function refByClass(
  service: AstService,
  absPath: string,
  relPath: string,
  tag: string,
  className: string,
  source: string,
): string {
  const entries = (service.nodeMapService.getNodeMap(absPath) ?? []) as NodeMapEntryLike[];
  const candidates = entries.filter((e) => e.tag === tag);
  const lines = source.split('\n');
  for (const cand of candidates) {
    const sourceLine = lines[cand.loc.line - 1] ?? '';
    if (sourceLine.includes(`className="${className}"`)) {
      return `${relPath}:${cand.loc.line}:${cand.loc.column}`;
    }
  }
  throw new Error(`No <${tag} className="${className}"> in ${absPath}`);
}

async function makeService(fixture: string, relPath = 'src/Grid.tsx') {
  const absPath = `/workspace/${relPath}`;
  const fileIO = new InMemoryFileIO({ [absPath]: fixture });
  const service = new AstService('/workspace', fileIO);
  await service.ensureInitialized();
  return { service, fileIO, absPath, relPath };
}

describe('AstService.swapElements — container swap (Task 8)', () => {
  describe('same direct parent', () => {
    it('swaps two direct sibling spans: A and C trade places, B stays', async () => {
      const { service, fileIO, absPath, relPath } = await makeService(SIBLINGS_FIXTURE, 'src/Row.tsx');
      const aRef = refByClass(service, absPath, relPath, 'span', 'a', SIBLINGS_FIXTURE);
      const cRef = refByClass(service, absPath, relPath, 'span', 'c', SIBLINGS_FIXTURE);

      const result = await service.swapElements(relPath, aRef, cRef);

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);
      // Order is now C, B, A.
      expect(content.indexOf('"c"')).toBeLessThan(content.indexOf('"b"'));
      expect(content.indexOf('"b"')).toBeLessThan(content.indexOf('"a"'));
      // Each element appears exactly once — no duplication.
      expect(content.match(/"a"/g)?.length).toBe(1);
      expect(content.match(/"c"/g)?.length).toBe(1);
    });

    it('swap is a no-op when both refs point at the same element', async () => {
      const { service, fileIO, absPath, relPath } = await makeService(SIBLINGS_FIXTURE, 'src/Row.tsx');
      const aRef = refByClass(service, absPath, relPath, 'span', 'a', SIBLINGS_FIXTURE);
      const before = fileIO.content(absPath);

      const result = await service.swapElements(relPath, aRef, aRef);

      expect(result.success).toBe(true);
      expect(fileIO.content(absPath)).toBe(before);
    });
  });

  describe('cross-parent card swap via lift (the PI-5-DR-16/17 geometry)', () => {
    it('swapping an inner <p> of card1 with an inner <h3> of card2 swaps the OUTER cards', async () => {
      const { service, fileIO, absPath, relPath } = await makeService(GRID_FIXTURE);
      const b1Ref = refByClass(service, absPath, relPath, 'p', 'b1', GRID_FIXTURE);
      const t2Ref = refByClass(service, absPath, relPath, 'h3', 't2', GRID_FIXTURE);

      const result = await service.swapElements(relPath, b1Ref, t2Ref);

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // Outer cards swapped: card2 now precedes card1.
      expect(content.indexOf('"card2"')).toBeLessThan(content.indexOf('"card1"'));

      // Each card kept its own contents — lift swaps containers, never their
      // inner children.
      const card1Open = content.indexOf('"card1"');
      const card1Close = content.indexOf('</div>', card1Open);
      const insideCard1 = content.slice(card1Open, card1Close);
      expect(insideCard1).toContain('"t1"');
      expect(insideCard1).toContain('"b1"');

      const card2Open = content.indexOf('"card2"');
      const card2Close = content.indexOf('</div>', card2Open);
      const insideCard2 = content.slice(card2Open, card2Close);
      expect(insideCard2).toContain('"t2"');
      expect(insideCard2).toContain('"b2"');

      // No element duplicated.
      expect(content.match(/"b1"/g)?.length).toBe(1);
      expect(content.match(/"t2"/g)?.length).toBe(1);
    });

    it('swapping the outer cards directly (no lift needed) trades their order', async () => {
      const { service, fileIO, absPath, relPath } = await makeService(GRID_FIXTURE);
      const card1Ref = refByClass(service, absPath, relPath, 'div', 'card1', GRID_FIXTURE);
      const card2Ref = refByClass(service, absPath, relPath, 'div', 'card2', GRID_FIXTURE);

      const result = await service.swapElements(relPath, card1Ref, card2Ref);

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);
      expect(content.indexOf('"card2"')).toBeLessThan(content.indexOf('"card1"'));
      // Both cards intact, single copy each.
      expect(content.match(/"card1"/g)?.length).toBe(1);
      expect(content.match(/"card2"/g)?.length).toBe(1);
    });
  });

  describe('error cases (throw, no success:false branch)', () => {
    it('throws when element A nodeRef cannot be resolved', async () => {
      const { service, absPath, relPath } = await makeService(GRID_FIXTURE);
      const b1Ref = refByClass(service, absPath, relPath, 'p', 'b1', GRID_FIXTURE);
      await expect(service.swapElements(relPath, `${relPath}:999:1`, b1Ref)).rejects.toThrow(/element A not found/i);
    });

    it('throws when element B nodeRef cannot be resolved', async () => {
      const { service, absPath, relPath } = await makeService(GRID_FIXTURE);
      const b1Ref = refByClass(service, absPath, relPath, 'p', 'b1', GRID_FIXTURE);
      await expect(service.swapElements(relPath, b1Ref, `${relPath}:999:1`)).rejects.toThrow(/element B not found/i);
    });

    it('throws when one element is an ancestor of the other', async () => {
      // card1 contains b1; swapping them would be ill-defined (a node with its
      // own descendant). The lift resolves both to card-level, but a direct
      // card1 ↔ b1 pair has no common-ancestor lift that separates them, so the
      // ancestor guard fires.
      const { service, absPath, relPath } = await makeService(GRID_FIXTURE);
      const card1Ref = refByClass(service, absPath, relPath, 'div', 'card1', GRID_FIXTURE);
      const b1Ref = refByClass(service, absPath, relPath, 'p', 'b1', GRID_FIXTURE);
      await expect(service.swapElements(relPath, card1Ref, b1Ref)).rejects.toThrow(/ancestor|descendant/i);
    });
  });
});
