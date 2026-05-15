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

  describe('different JSX parents in the same file', () => {
    it('sibling → cousin: <a className="nav-a"> from <nav> into <main>', async () => {
      const { service, fileIO, absPath, relPath } = await makeAppService();
      const sourceRef = refByClass(service, absPath, relPath, 'a', 'nav-a', APP_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'p', 'content', APP_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'after');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // <a className="nav-a"> must now live inside <main>, after <p className="content">.
      const navAIdx = content.indexOf('"nav-a"');
      const contentIdx = content.indexOf('"content"');
      const mainCloseIdx = content.indexOf('</main>');
      expect(contentIdx).toBeLessThan(navAIdx);
      expect(navAIdx).toBeLessThan(mainCloseIdx);

      // <a className="nav-b"> stays inside <nav> with its parent unchanged.
      const navBIdx = content.indexOf('"nav-b"');
      const navOpenIdx = content.indexOf('"nav"');
      const navCloseIdx = content.indexOf('</nav>');
      expect(navOpenIdx).toBeLessThan(navBIdx);
      expect(navBIdx).toBeLessThan(navCloseIdx);

      // <a className="nav-a"> no longer inside <nav>.
      const insideNav = content.slice(navOpenIdx, navCloseIdx);
      expect(insideNav.includes('"nav-a"')).toBe(false);
    });

    it('deep → root: <a className="nav-a"> moves to before <header> at top level', async () => {
      const { service, fileIO, absPath, relPath } = await makeAppService();
      const sourceRef = refByClass(service, absPath, relPath, 'a', 'nav-a', APP_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'header', 'hdr', APP_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'before');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // Order check: <a className="nav-a"> must appear before <header className="hdr">.
      expect(content.indexOf('"nav-a"')).toBeLessThan(content.indexOf('"hdr"'));

      // And it must be a child of <div className="root"> — i.e. between
      // the opening `<div className="root">` and the `<header`.
      const rootOpenIdx = content.indexOf('"root"');
      expect(rootOpenIdx).toBeLessThan(content.indexOf('"nav-a"'));

      // Original site emptied: searching inside the surviving <nav> tag should not find nav-a.
      const navOpen = content.indexOf('"nav"');
      const navClose = content.indexOf('</nav>');
      expect(content.slice(navOpen, navClose).includes('"nav-a"')).toBe(false);
    });

    it('root → deep: <main> moves to before <a className="nav-b"> deep inside <nav>', async () => {
      const { service, fileIO, absPath, relPath } = await makeAppService();
      const sourceRef = refByClass(service, absPath, relPath, 'main', 'main', APP_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'a', 'nav-b', APP_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'before');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // <main> must now live INSIDE <nav>, immediately before <a className="nav-b">.
      const navOpen = content.indexOf('<nav className="nav"');
      const navClose = content.indexOf('</nav>');
      const inside = content.slice(navOpen, navClose);
      expect(inside.includes('<main')).toBe(true);
      expect(inside.indexOf('<main')).toBeLessThan(inside.indexOf('"nav-b"'));

      // <main> no longer at top level — i.e. there is no `<main` between
      // `</header>` and `</div>` at the outermost level.
      const headerCloseIdx = content.indexOf('</header>');
      const rootCloseIdx = content.lastIndexOf('</div>');
      const topLevelTail = content.slice(headerCloseIdx, rootCloseIdx);
      // The only <main> tags allowed in this slice are the closing ones from
      // the moved subtree; an open `<main` followed by `className="main"` at
      // top level would mean the move did not happen.
      expect(/\<main\s+className="main"/.test(topLevelTail.replace(inside, ''))).toBe(false);
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
