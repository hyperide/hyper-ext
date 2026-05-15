/**
 * @file AstService.moveElement unit tests — Task 2 scope: same-file moves.
 *
 * Accessed via: iframe drag-drop → hypercanvas:moveElement → ast:moveElement → AstService.moveElement
 * Assumptions:
 *   - both nodeRefs resolve to the same file (cross-file lands in Task 3);
 *   - nodeRefs are source-location strings in `relPath:line:col` format,
 *     resolved through NodeMapService;
 *   - moveElement throws on internal failure (no `success: false` branch).
 */
import { describe, expect, it } from 'bun:test';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import { AstService } from '../services/AstService';

// Fixture covers the three same-file move shapes the plan requires:
//   - sibling → cousin   (different parents, both deep)
//   - deep → root        (deep child moved to be a top-level child of <div className="root">)
//   - root → deep        (top-level child moved deep into the tree)
// className tags are unique so we can assert visible order in the printed file.
const APP_FIXTURE = `export default function App() {
  return (
    <div className="root">
      <header className="hdr">
        <h1 className="title">Title</h1>
        <nav className="nav">
          <a className="nav-a">A</a>
          <a className="nav-b">B</a>
        </nav>
      </header>
      <main className="main">
        <p className="content">Content</p>
      </main>
    </div>
  );
}
`;

const SIMPLE_FIXTURE = `export default function FlexList() {
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

async function makeAppService() {
  const relPath = 'src/App.tsx';
  const absPath = `/workspace/${relPath}`;
  const fileIO = new InMemoryFileIO({ [absPath]: APP_FIXTURE });
  const service = new AstService('/workspace', fileIO);
  await service.ensureInitialized();
  return { service, fileIO, absPath, relPath };
}

async function makeSimpleService() {
  const relPath = 'src/FlexList.tsx';
  const absPath = `/workspace/${relPath}`;
  const fileIO = new InMemoryFileIO({ [absPath]: SIMPLE_FIXTURE });
  const service = new AstService('/workspace', fileIO);
  await service.ensureInitialized();
  return { service, fileIO, absPath, relPath };
}

/**
 * Find a JSX element by tag + className in the node map, return its source-location ref.
 * Falls back to a tag-only match when className is omitted (e.g. <h1>Title</h1>).
 */
function refByClass(
  service: AstService,
  absPath: string,
  relPath: string,
  tag: string,
  className?: string,
  source?: string,
): string {
  const entries = (service.nodeMapService.getNodeMap(absPath) ?? []) as NodeMapEntryLike[];
  const candidates = entries.filter((e) => e.tag === tag);
  if (candidates.length === 0) {
    throw new Error(`No <${tag}> entries in node map for ${absPath}`);
  }
  const text = source ?? '';
  // We don't have direct access to attributes from NodeMapEntry, so we
  // resolve by line: pick the first entry whose source line literally
  // contains `className="${className}"`.
  if (className) {
    const lines = text.split('\n');
    for (const cand of candidates) {
      const sourceLine = lines[cand.loc.line - 1] ?? '';
      if (sourceLine.includes(`className="${className}"`)) {
        return `${relPath}:${cand.loc.line}:${cand.loc.column}`;
      }
    }
    throw new Error(`No <${tag} className="${className}"> in ${absPath}`);
  }
  return `${relPath}:${candidates[0].loc.line}:${candidates[0].loc.column}`;
}

describe('AstService.moveElement — same-file moves (Task 2)', () => {
  describe('same JSX parent (sibling reorder)', () => {
    it('moves first sibling after second', async () => {
      const { service, fileIO, absPath, relPath } = await makeSimpleService();
      const sourceRef = refByClass(service, absPath, relPath, 'div', 'a', SIMPLE_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'div', 'b', SIMPLE_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'after');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);
      // After move: B then A
      expect(content.indexOf('"b"')).toBeLessThan(content.indexOf('"a"'));
      // C still last
      expect(content.indexOf('"a"')).toBeLessThan(content.indexOf('"c"'));
    });

    it('drop-on-self is a no-op (no throw, no rewrite)', async () => {
      const { service, fileIO, absPath, relPath } = await makeSimpleService();
      const ref = refByClass(service, absPath, relPath, 'div', 'b', SIMPLE_FIXTURE);
      const before = fileIO.content(absPath);

      const result = await service.moveElement(relPath, ref, ref, 'after');

      expect(result.success).toBe(true);
      // File unchanged
      expect(fileIO.content(absPath)).toBe(before);
    });
  });

  // Different-parent moves use server-side liftToCommonJsxParent (Task 4 of
  // the move-any-intermittent plan). The user dragging an inner element of
  // one card onto an inner element of another card expects the OUTER cards
  // to swap — not for the source to be rehomed inside the target's parent.
  // The old "nest into target's parent" semantic from move-any-to-any
  // Task 2 is replaced by lift in every case where parents differ.
  describe('different JSX parents in the same file (lift to common ancestor)', () => {
    it('sibling → cousin: lifts <header> next to <main> at root level', async () => {
      const { service, fileIO, absPath, relPath } = await makeAppService();
      const sourceRef = refByClass(service, absPath, relPath, 'a', 'nav-a', APP_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'p', 'content', APP_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'after');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // Lift: source ancestor at root level = <header>, target ancestor at
      // root level = <main>. Move <header> AFTER <main> — header subtree
      // ends up second among root's children.
      const headerOpenIdx = content.indexOf('<header');
      const mainOpenIdx = content.indexOf('<main');
      expect(mainOpenIdx).toBeLessThan(headerOpenIdx);

      // The <a nav-a> source itself was NOT extracted — it still lives
      // inside the (now reordered) header subtree.
      const headerCloseIdx = content.indexOf('</header>');
      const insideHeader = content.slice(headerOpenIdx, headerCloseIdx);
      expect(insideHeader.includes('"nav-a"')).toBe(true);
    });

    it('deep → root (target ancestor of source): extracts source out next to <header>', async () => {
      const { service, fileIO, absPath, relPath } = await makeAppService();
      const sourceRef = refByClass(service, absPath, relPath, 'a', 'nav-a', APP_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'header', 'hdr', APP_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'before');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // Target is an ancestor of source. Lift extracts source to be a sibling
      // of target inside <div className="root">. Source's lifted node = <a nav-a>
      // climbed up through <nav> → <header>, becomes a direct child of root.
      // Position 'before': <a nav-a> precedes <header>.
      const navAOpenIdx = content.indexOf('<a className="nav-a"');
      const headerOpenIdx = content.indexOf('<header');
      expect(navAOpenIdx).toBeLessThan(headerOpenIdx);

      // <a nav-a> is no longer inside <nav>.
      const navOpen = content.indexOf('<nav className="nav"');
      const navClose = content.indexOf('</nav>');
      const insideNav = content.slice(navOpen, navClose);
      expect(insideNav.includes('"nav-a"')).toBe(false);
    });

    it('root → deep: lifts <header> before <main> at root level', async () => {
      // Reverse direction: source <main> (root child), target <a nav-b> deep
      // in nav. Source-chain = [main, root]. Target-chain = [a-nav-b, nav,
      // header, root]. Common = root. Lifted source = <main>, lifted target
      // = <header>. Moving main BEFORE header reorders root's children.
      const { service, fileIO, absPath, relPath } = await makeAppService();
      const sourceRef = refByClass(service, absPath, relPath, 'main', 'main', APP_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'a', 'nav-b', APP_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'before');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      const mainOpenIdx = content.indexOf('<main');
      const headerOpenIdx = content.indexOf('<header');
      expect(mainOpenIdx).toBeLessThan(headerOpenIdx);

      // Source <main> still at top level (NOT nested inside <nav>).
      const navOpen = content.indexOf('<nav className="nav"');
      const navClose = content.indexOf('</nav>');
      expect(content.slice(navOpen, navClose).includes('<main')).toBe(false);
    });
  });

  // Task 4 of the move-any-intermittent plan: explicit grid-of-cards fixture
  // matching the failing PI-5-DR-17 E2E. Source is an inner <p> inside one
  // card, target is an inner <h3> inside another card. Lift must reorder the
  // outer cards (the grid's direct children) — not nest <p> into card2.
  describe('Task 4: lift inline elements to common grid container', () => {
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

    async function makeGridService() {
      const relPath = 'src/Grid.tsx';
      const absPath = `/workspace/${relPath}`;
      const fileIO = new InMemoryFileIO({ [absPath]: GRID_FIXTURE });
      const service = new AstService('/workspace', fileIO);
      await service.ensureInitialized();
      return { service, fileIO, absPath, relPath };
    }

    it('drag <p> in card1 onto <h3> in card2 swaps the outer cards', async () => {
      const { service, fileIO, absPath, relPath } = await makeGridService();
      const sourceRef = refByClass(service, absPath, relPath, 'p', 'b1', GRID_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'h3', 't2', GRID_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'after');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // Outer cards swapped: card2 now precedes card1 in the grid.
      const card2Idx = content.indexOf('"card2"');
      const card1Idx = content.indexOf('"card1"');
      expect(card2Idx).toBeLessThan(card1Idx);

      // The inner <p className="b1"> was NOT extracted — it still lives
      // inside the (now relocated) card1 subtree, intact.
      expect(content).toContain('<p className="b1">Body One</p>');
      // And card1 still has its title alongside its body.
      const card1OpenIdx = content.indexOf('"card1"');
      const card1CloseIdx = content.indexOf('</div>', card1OpenIdx);
      const insideCard1 = content.slice(card1OpenIdx, card1CloseIdx);
      expect(insideCard1).toContain('"t1"');
      expect(insideCard1).toContain('"b1"');
    });

    it('drag <h3> in card1 BEFORE <p> in card2 places card1 before card2 (already true → swaps NOT)', async () => {
      // card1 is already before card2; dragging an inner element of card1
      // BEFORE an inner element of card2 should leave the order unchanged.
      const { service, fileIO, absPath, relPath } = await makeGridService();
      const sourceRef = refByClass(service, absPath, relPath, 'h3', 't1', GRID_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'p', 'b2', GRID_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'before');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);
      // Order preserved.
      expect(content.indexOf('"card1"')).toBeLessThan(content.indexOf('"card2"'));
    });
  });

  describe('error cases (throw, no `success: false` branch)', () => {
    it('throws when source nodeRef cannot be resolved', async () => {
      const { service, relPath } = await makeAppService();
      const targetRef = `${relPath}:4:5`; // first JSX line — exists
      await expect(service.moveElement(relPath, `${relPath}:999:1`, targetRef, 'before')).rejects.toThrow(
        /source element not found/i,
      );
    });

    it('throws when target nodeRef cannot be resolved', async () => {
      const { service, absPath, relPath } = await makeAppService();
      const sourceRef = refByClass(service, absPath, relPath, 'a', 'nav-a', APP_FIXTURE);
      await expect(service.moveElement(relPath, sourceRef, `${relPath}:999:1`, 'after')).rejects.toThrow(
        /target element not found/i,
      );
    });

    it('throws when moving a node into one of its own descendants', async () => {
      const { service, absPath, relPath } = await makeAppService();
      // <header> contains <nav>; moving <header> into <nav> would create a cycle.
      const sourceRef = refByClass(service, absPath, relPath, 'header', 'hdr', APP_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'a', 'nav-a', APP_FIXTURE);
      await expect(service.moveElement(relPath, sourceRef, targetRef, 'before')).rejects.toThrow(/descendant/i);
    });
  });
});
