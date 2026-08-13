/**
 * @file AstService.moveElement unit tests — Task 6 scope: drop into a
 *       non-container leaf (self-closing JSX with no children).
 *
 * Accessed via: iframe drag-drop → hypercanvas:moveElement → ast:moveElement → AstService.moveElement
 *
 * Assumptions:
 *   - moveElement(source, target, position) treats `target` as a sibling-adjacent
 *     reference: it uses `target.parent.children`, finds the target's index,
 *     and splices `source` at `position` ('before' / 'after'). When the target
 *     is a self-closing leaf (`<img />`, `<input />`, `<br />`) the existing
 *     branch in AstService.moveElement therefore inserts the source as a
 *     sibling without ever attempting to nest INTO the leaf — there is no
 *     special-case code path needed for void elements;
 *   - the leaf invariant must hold for both same-parent leaves (sibling
 *     reorder around a leaf) and different-parent leaves (cross-subtree
 *     move using a leaf as the landing reference);
 *   - moveElement throws on internal failure (no `success: false` branch).
 */
import { describe, expect, it } from 'bun:test';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import { AstService } from '../services/AstService';

// Fixture covers same-parent leaf-target reorder: <img>/<input>/<br /> all live
// directly inside <form>, so we can drop a sibling block before/after them and
// assert the leaf itself stays self-closing (`/>` is preserved, no children
// were spliced inside it).
const FORM_FIXTURE = `export default function SignUp() {
  return (
    <form className="signup">
      <label className="lbl-name">Name</label>
      <input className="in-name" type="text" />
      <img className="avatar" src="/avatar.png" alt="" />
      <br />
      <button className="submit">Go</button>
    </form>
  );
}
`;

// Fixture covers different-parent leaf-target moves: <img className="hero-art" />
// is a leaf sitting inside <header>, and we drop a block from <main>'s subtree
// next to it. Round-trips assert the leaf stays self-closing post-move.
const PAGE_FIXTURE = `export default function Page() {
  return (
    <div className="page">
      <header className="hdr">
        <h1 className="title">Title</h1>
        <img className="hero-art" src="/hero.svg" alt="" />
      </header>
      <main className="main">
        <p className="lede">Lede paragraph.</p>
        <aside className="aside">
          <span className="badge">New</span>
        </aside>
      </main>
    </div>
  );
}
`;

interface NodeMapEntryLike {
  loc: { line: number; column: number };
  tag: string;
}

async function makeFormService() {
  const relPath = 'src/SignUp.tsx';
  const absPath = `/workspace/${relPath}`;
  const fileIO = new InMemoryFileIO({ [absPath]: FORM_FIXTURE });
  const service = new AstService('/workspace', fileIO);
  await service.ensureInitialized();
  return { service, fileIO, absPath, relPath };
}

async function makePageService() {
  const relPath = 'src/Page.tsx';
  const absPath = `/workspace/${relPath}`;
  const fileIO = new InMemoryFileIO({ [absPath]: PAGE_FIXTURE });
  const service = new AstService('/workspace', fileIO);
  await service.ensureInitialized();
  return { service, fileIO, absPath, relPath };
}

/**
 * Find a JSX element by tag + className in the node map, return its source-location ref.
 * For tag-only matches (e.g. `<br />` has no className), pass className=undefined and
 * an `index` to disambiguate when multiple instances exist.
 */
function refByClass(
  service: AstService,
  absPath: string,
  relPath: string,
  tag: string,
  className: string | undefined,
  source: string,
  index = 0,
): string {
  const entries = (service.nodeMapService.getNodeMap(absPath) ?? []) as NodeMapEntryLike[];
  const candidates = entries.filter((e) => e.tag === tag);
  if (candidates.length === 0) {
    throw new Error(`No <${tag}> entries in node map for ${absPath}`);
  }
  const lines = source.split('\n');
  if (className) {
    for (const cand of candidates) {
      const sourceLine = lines[cand.loc.line - 1] ?? '';
      if (sourceLine.includes(`className="${className}"`)) {
        return `${relPath}:${cand.loc.line}:${cand.loc.column}`;
      }
    }
    throw new Error(`No <${tag} className="${className}"> in ${absPath}`);
  }
  const cand = candidates[index];
  return `${relPath}:${cand.loc.line}:${cand.loc.column}`;
}

describe('AstService.moveElement — drop on a non-container leaf (Task 6)', () => {
  describe('same-parent reorder around a self-closing leaf', () => {
    it('drop <button> AFTER <img /> leaf: source lands as next sibling, leaf stays self-closing', async () => {
      const { service, fileIO, absPath, relPath } = await makeFormService();
      const sourceRef = refByClass(service, absPath, relPath, 'button', 'submit', FORM_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'img', 'avatar', FORM_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'after');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // Order: <img className="avatar" /> → <button className="submit">
      const imgIdx = content.indexOf('"avatar"');
      const submitIdx = content.indexOf('"submit"');
      const brIdx = content.indexOf('<br');
      expect(imgIdx).toBeGreaterThan(-1);
      expect(submitIdx).toBeGreaterThan(-1);
      expect(imgIdx).toBeLessThan(submitIdx);
      // <button> moved to land directly after <img />, so it must precede <br />.
      expect(submitIdx).toBeLessThan(brIdx);

      // <img> still self-closing: its tag must end with `/>` (no children spliced inside).
      // Match the full `<img className="avatar" src="/avatar.png" alt="" />` opening.
      expect(/<img\s+className="avatar"[^>]*\/>/.test(content)).toBe(true);
      // And no `</img>` close tag was synthesized.
      expect(content.includes('</img>')).toBe(false);
    });

    it('drop <label> BEFORE <input /> leaf: source lands as previous sibling, leaf stays self-closing', async () => {
      const { service, fileIO, absPath, relPath } = await makeFormService();
      // Move <label className="lbl-name"> from its current spot (before <input>)
      // back to before <input> by passing 'before' — this is a no-op-ish move
      // but exercises the leaf-as-target before path. To make it a real move we
      // instead move <button className="submit"> to be BEFORE <input>.
      const sourceRef = refByClass(service, absPath, relPath, 'button', 'submit', FORM_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'input', 'in-name', FORM_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'before');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // <button> must now precede <input>.
      const submitIdx = content.indexOf('"submit"');
      const inputIdx = content.indexOf('"in-name"');
      expect(submitIdx).toBeLessThan(inputIdx);

      // <input> still self-closing.
      expect(/<input\s+className="in-name"[^>]*\/>/.test(content)).toBe(true);
      expect(content.includes('</input>')).toBe(false);
    });

    it('drop <label> AFTER <br /> classless leaf: source lands as next sibling', async () => {
      const { service, fileIO, absPath, relPath } = await makeFormService();
      // <br /> has no className, so we resolve by tag-only.
      const sourceRef = refByClass(service, absPath, relPath, 'label', 'lbl-name', FORM_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'br', undefined, FORM_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'after');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // <label> must now appear AFTER <br /> (so before its <br /> -><label> -><button> ordering).
      const labelIdx = content.indexOf('"lbl-name"');
      const brIdx = content.indexOf('<br');
      const submitIdx = content.indexOf('"submit"');
      expect(brIdx).toBeLessThan(labelIdx);
      expect(labelIdx).toBeLessThan(submitIdx);

      // <br /> still self-closing, no `</br>` synthesized.
      expect(content.includes('</br>')).toBe(false);
      expect(/<br\s*\/>/.test(content)).toBe(true);
    });
  });

  // Different-parent moves use REPARENT semantics (visual-foundation spec
  // Part C, Task 7). When source and target sit in different parents, the
  // SOURCE node is spliced out of its old parent and inserted into the
  // TARGET's parent at `position`. When that target is a self-closing leaf
  // (`<img />`), the source becomes a SIBLING of the leaf inside the leaf's
  // parent — it is NEVER nested as a child of the leaf. The leaf-self-closing
  // invariant must survive the reparent.
  describe('different-parent reparent: leaf stays a sibling, never a nesting target', () => {
    it('reparents <p lede> into <header> AFTER <img hero-art /> as its sibling, leaf preserved', async () => {
      const { service, fileIO, absPath, relPath } = await makePageService();
      const sourceRef = refByClass(service, absPath, relPath, 'p', 'lede', PAGE_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'img', 'hero-art', PAGE_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'after');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // Reparent: <p lede> is cut out of <main> and inserted into <header>
      // (the leaf's parent), AFTER <img hero-art />. Inside <header> the
      // order is <img hero-art /> then <p lede>.
      const headerOpenIdx = content.indexOf('<header');
      const headerCloseIdx = content.indexOf('</header>');
      const insideHeader = content.slice(headerOpenIdx, headerCloseIdx);
      const heroIdx = insideHeader.indexOf('"hero-art"');
      const ledeIdx = insideHeader.indexOf('"lede"');
      expect(heroIdx).toBeGreaterThan(-1);
      expect(ledeIdx).toBeGreaterThan(-1);
      expect(heroIdx).toBeLessThan(ledeIdx);

      // The leaf <img className="hero-art" /> stays self-closing — the source
      // landed as its SIBLING, never as a child of the leaf.
      expect(/<img\s+className="hero-art"[^>]*\/>/.test(content)).toBe(true);
      expect(content.includes('</img>')).toBe(false);

      // <p lede> left its old parent <main> entirely; no duplication.
      const mainOpenIdx = content.indexOf('<main');
      const mainCloseIdx = content.indexOf('</main>');
      expect(content.slice(mainOpenIdx, mainCloseIdx).includes('"lede"')).toBe(false);
      expect(content.match(/"lede"/g)?.length).toBe(1);
    });

    it('reparents <span badge> into <header> BEFORE <img hero-art /> as its sibling, leaf preserved', async () => {
      const { service, fileIO, absPath, relPath } = await makePageService();
      const sourceRef = refByClass(service, absPath, relPath, 'span', 'badge', PAGE_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'img', 'hero-art', PAGE_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'before');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // Reparent: <span badge> is cut out of <aside> (in <main>) and inserted
      // into <header> (the leaf's parent), BEFORE <img hero-art />. Inside
      // <header> the order is <span badge> then <img hero-art />.
      const headerOpenIdx = content.indexOf('<header');
      const headerCloseIdx = content.indexOf('</header>');
      const insideHeader = content.slice(headerOpenIdx, headerCloseIdx);
      const badgeIdx = insideHeader.indexOf('"badge"');
      const heroIdx = insideHeader.indexOf('"hero-art"');
      expect(badgeIdx).toBeGreaterThan(-1);
      expect(heroIdx).toBeGreaterThan(-1);
      expect(badgeIdx).toBeLessThan(heroIdx);

      // Leaf still self-closing — source is a sibling, never nested into it.
      expect(/<img\s+className="hero-art"[^>]*\/>/.test(content)).toBe(true);
      expect(content.includes('</img>')).toBe(false);

      // <span badge> left its old parent <aside>; no duplication.
      const asideOpenIdx = content.indexOf('<aside');
      const asideCloseIdx = content.indexOf('</aside>');
      expect(content.slice(asideOpenIdx, asideCloseIdx).includes('"badge"')).toBe(false);
      expect(content.match(/"badge"/g)?.length).toBe(1);
    });
  });

  describe('leaf-target invariant: never split / wrap the leaf', () => {
    it('moveElement never inserts source AS A CHILD of a self-closing target', async () => {
      const { service, fileIO, absPath, relPath } = await makeFormService();
      const sourceRef = refByClass(service, absPath, relPath, 'button', 'submit', FORM_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'img', 'avatar', FORM_FIXTURE);

      await service.moveElement(relPath, sourceRef, targetRef, 'after');

      const content = fileIO.content(absPath);
      // Concrete invariant: the moved <button> MUST NOT appear between
      // `<img className="avatar"` and the matching `/>` of that opening tag —
      // that would mean the implementation tried to nest INTO the leaf.
      const imgOpen = content.indexOf('<img className="avatar"');
      // Slice to the next `/>` after the img open.
      const tail = content.slice(imgOpen);
      const selfClose = tail.indexOf('/>');
      expect(selfClose).toBeGreaterThan(-1);
      const imgTagSlice = tail.slice(0, selfClose);
      expect(imgTagSlice.includes('<button')).toBe(false);
      expect(imgTagSlice.includes('"submit"')).toBe(false);
    });
  });
});
