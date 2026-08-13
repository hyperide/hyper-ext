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

  // Different-parent moves use REPARENT semantics (visual-foundation spec
  // Part C, Task 7). When source and target sit in different JSX parents, the
  // SOURCE node itself is spliced OUT of its old parent and INSERTED into the
  // TARGET's parent, at `position` relative to the target node. The source's
  // old parent empties out; the source lands INSIDE the target's container.
  // (The old "lift to a common ancestor + swap the outer cards" behavior is
  // gone from moveElement — it lives in a separate `swapElements` method.)
  describe("different JSX parents in the same file (reparent into target's container)", () => {
    it('sibling → cousin: reparents <a nav-a> into <main> after <p content>', async () => {
      const { service, fileIO, absPath, relPath } = await makeAppService();
      const sourceRef = refByClass(service, absPath, relPath, 'a', 'nav-a', APP_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'p', 'content', APP_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'after');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // Reparent: <a nav-a> is cut out of <nav> and inserted into <main>
      // (the target's parent), AFTER <p content>. So inside <main> the
      // order is <p content> then <a nav-a>.
      const mainOpenIdx = content.indexOf('<main');
      const mainCloseIdx = content.indexOf('</main>');
      const insideMain = content.slice(mainOpenIdx, mainCloseIdx);
      const contentIdx = insideMain.indexOf('"content"');
      const navAIdx = insideMain.indexOf('"nav-a"');
      expect(contentIdx).toBeGreaterThan(-1);
      expect(navAIdx).toBeGreaterThan(-1);
      expect(contentIdx).toBeLessThan(navAIdx);

      // The <a nav-a> source left its old parent <nav> entirely.
      const navOpenIdx = content.indexOf('<nav className="nav"');
      const navCloseIdx = content.indexOf('</nav>');
      const insideNav = content.slice(navOpenIdx, navCloseIdx);
      expect(insideNav.includes('"nav-a"')).toBe(false);
      // <a nav-b> stays behind in <nav>.
      expect(insideNav.includes('"nav-b"')).toBe(true);

      // No duplication — the source class exists exactly once.
      expect(content.match(/"nav-a"/g)?.length).toBe(1);
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

    it('root → deep: reparents <main> into <nav> before <a nav-b>', async () => {
      // Reverse direction: source <main> (root child), target <a nav-b> deep
      // in nav. Reparent splices <main> out of <div root> and inserts it into
      // <nav> (the target's parent), BEFORE <a nav-b> — so inside <nav> the
      // order is <a nav-a>, <main>, <a nav-b>. The root <div> empties of its
      // <main> child.
      const { service, fileIO, absPath, relPath } = await makeAppService();
      const sourceRef = refByClass(service, absPath, relPath, 'main', 'main', APP_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'a', 'nav-b', APP_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'before');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // <main> now lives INSIDE <nav>, before <a nav-b>.
      const navOpen = content.indexOf('<nav className="nav"');
      const navClose = content.indexOf('</nav>');
      const insideNav = content.slice(navOpen, navClose);
      const mainIdx = insideNav.indexOf('<main');
      const navBIdx = insideNav.indexOf('"nav-b"');
      const navAIdx = insideNav.indexOf('"nav-a"');
      expect(mainIdx).toBeGreaterThan(-1);
      expect(navAIdx).toBeLessThan(mainIdx);
      expect(mainIdx).toBeLessThan(navBIdx);

      // <main> is no longer a direct child of root: the only <main> in the
      // file is the one nested inside <nav>.
      expect(content.match(/<main/g)?.length).toBe(1);
      // The <p content> travelled inside <main> (we never split a node from
      // its children).
      const mainOpenIdx = content.indexOf('<main');
      const mainCloseIdx = content.indexOf('</main>');
      expect(content.slice(mainOpenIdx, mainCloseIdx).includes('"content"')).toBe(true);
    });
  });

  // Grid-of-cards fixture matching the PI-5-DR-17 E2E. Source is an inner <p>
  // inside one card, target is an inner <h3> inside another card. Under
  // reparent semantics the inner <p> itself moves into the OTHER card's
  // container, next to the target <h3> — the outer cards are NOT reordered.
  describe("reparent inline elements into the target card's container", () => {
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

    it('drag <p> in card1 onto <h3> in card2 reparents <p> into card2', async () => {
      const { service, fileIO, absPath, relPath } = await makeGridService();
      const sourceRef = refByClass(service, absPath, relPath, 'p', 'b1', GRID_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'h3', 't2', GRID_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'after');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // Outer cards keep their order: card1 still precedes card2 in the grid.
      const card1Idx = content.indexOf('"card1"');
      const card2Idx = content.indexOf('"card2"');
      expect(card1Idx).toBeLessThan(card2Idx);

      // Reparent: <p b1> is cut out of card1 and inserted into card2 (the
      // target's parent), AFTER <h3 t2>. Inside card2 the order is t2, b1, b2.
      const card2OpenIdx = content.indexOf('"card2"');
      const card2CloseIdx = content.indexOf('</div>', card2OpenIdx);
      const insideCard2 = content.slice(card2OpenIdx, card2CloseIdx);
      const t2Idx = insideCard2.indexOf('"t2"');
      const b1Idx = insideCard2.indexOf('"b1"');
      const b2Idx = insideCard2.indexOf('"b2"');
      expect(t2Idx).toBeLessThan(b1Idx);
      expect(b1Idx).toBeLessThan(b2Idx);
      // The moved <p> kept its text content.
      expect(content).toContain('<p className="b1">Body One</p>');

      // card1 lost its <p b1>: only its title <h3 t1> remains there.
      const card1OpenIdx = content.indexOf('"card1"');
      const card1CloseIdx = content.indexOf('</div>', card1OpenIdx);
      const insideCard1 = content.slice(card1OpenIdx, card1CloseIdx);
      expect(insideCard1).toContain('"t1"');
      expect(insideCard1.includes('"b1"')).toBe(false);

      // No duplication.
      expect(content.match(/"b1"/g)?.length).toBe(1);
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
