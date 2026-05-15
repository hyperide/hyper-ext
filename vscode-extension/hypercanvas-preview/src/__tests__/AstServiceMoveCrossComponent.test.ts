/**
 * @file AstService.moveElement cross-component-same-file unit tests —
 * Task 4 of the move-any-to-any plan.
 *
 * Accessed via: iframe drag-drop → hypercanvas:moveElement → AstService.moveElement
 *               (same-file branch when source and target sit in different
 *               component declarations within ONE module).
 *
 * Assumptions:
 *   - Both nodeRefs are source-location strings (`relPath:line:col`) and
 *     resolve through NodeMapService.
 *   - "Symbol resolution same as Task 3 but limited to module scope" — i.e.
 *     module-level imports are already in scope for every component in the
 *     file, so no replication/pruning is required. The same-file branch in
 *     moveElement is enclosing-function-agnostic; this suite is the
 *     verification gate that proves it.
 */
import { describe, expect, it } from 'bun:test';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import { AstService } from '../services/AstService';

interface NodeMapEntryLike {
  loc: { line: number; column: number };
  tag: string;
}

function refByClass(
  service: AstService,
  absPath: string,
  relPath: string,
  tag: string,
  className: string | undefined,
  source: string,
): string {
  const entries = (service.nodeMapService.getNodeMap(absPath) ?? []) as NodeMapEntryLike[];
  const candidates = entries.filter((e) => e.tag === tag);
  if (candidates.length === 0) {
    throw new Error(`No <${tag}> entries in node map for ${absPath}`);
  }
  if (className) {
    const lines = source.split('\n');
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

describe('AstService.moveElement — cross-component same-file moves (Task 4)', () => {
  it('moves a JSX subtree from component A return into component B return', async () => {
    // Two sibling component declarations in one module. Drag <Box className="moved" />
    // from <Sidebar>'s return into <Hero>'s return, before <span className="anchor" />.
    const fixture = `import { Box } from './ui/Box';

export function Sidebar() {
  return (
    <aside className="sidebar-root">
      <Box className="moved">payload</Box>
      <p className="kept">stays put</p>
    </aside>
  );
}

export function Hero() {
  return (
    <section className="hero-root">
      <span className="anchor">drop here</span>
    </section>
  );
}
`;
    const fileIO = new InMemoryFileIO({
      '/workspace/src/Page.tsx': fixture,
      '/workspace/src/ui/Box.tsx': `export function Box(p:any){return <div {...p}/>;}\n`,
    });
    const service = new AstService('/workspace', fileIO);
    await service.ensureInitialized();

    const sourceRef = refByClass(service, '/workspace/src/Page.tsx', 'src/Page.tsx', 'Box', 'moved', fixture);
    const targetRef = refByClass(service, '/workspace/src/Page.tsx', 'src/Page.tsx', 'span', 'anchor', fixture);

    const result = await service.moveElement('src/Page.tsx', sourceRef, targetRef, 'before');
    expect(result.success).toBe(true);

    const newContent = fileIO.content('/workspace/src/Page.tsx');

    // <Box className="moved"> now lives inside <section className="hero-root">,
    // immediately before <span className="anchor">.
    const heroOpen = newContent.indexOf('"hero-root"');
    const heroClose = newContent.indexOf('</section>');
    expect(heroOpen).toBeGreaterThan(-1);
    expect(heroClose).toBeGreaterThan(heroOpen);
    const insideHero = newContent.slice(heroOpen, heroClose);
    expect(insideHero.includes('"moved"')).toBe(true);
    expect(insideHero.indexOf('"moved"')).toBeLessThan(insideHero.indexOf('"anchor"'));

    // <Box className="moved"> no longer in <Sidebar>'s subtree.
    const asideOpen = newContent.indexOf('"sidebar-root"');
    const asideClose = newContent.indexOf('</aside>');
    expect(newContent.slice(asideOpen, asideClose).includes('"moved"')).toBe(false);

    // <p className="kept"> stays in <Sidebar>.
    expect(newContent.slice(asideOpen, asideClose).includes('"kept"')).toBe(true);
  });

  it('leaves module-level imports untouched (no spurious replication, no spurious pruning)', async () => {
    // The whole point of "symbol resolution limited to module scope" is that
    // module-level imports are shared across every component in the file —
    // moving a JSX node that references an import from one component's return
    // to another's must NOT emit `added import` or `removed orphaned import`
    // adjustments. The import line in the output must be byte-identical to
    // the input.
    const fixture = `import { Card } from './ui/Card';
import { Banner } from './ui/Banner';

export function Top() {
  return (
    <header className="top-root">
      <Card className="moved-card">title</Card>
    </header>
  );
}

export function Bottom() {
  return (
    <footer className="bottom-root">
      <Banner className="bottom-banner">tagline</Banner>
    </footer>
  );
}
`;
    const fileIO = new InMemoryFileIO({
      '/workspace/src/Layout.tsx': fixture,
      '/workspace/src/ui/Card.tsx': `export function Card(p:any){return <div {...p}/>;}\n`,
      '/workspace/src/ui/Banner.tsx': `export function Banner(p:any){return <div {...p}/>;}\n`,
    });
    const service = new AstService('/workspace', fileIO);
    await service.ensureInitialized();

    const sourceRef = refByClass(service, '/workspace/src/Layout.tsx', 'src/Layout.tsx', 'Card', 'moved-card', fixture);
    const targetRef = refByClass(
      service,
      '/workspace/src/Layout.tsx',
      'src/Layout.tsx',
      'Banner',
      'bottom-banner',
      fixture,
    );

    const result = await service.moveElement('src/Layout.tsx', sourceRef, targetRef, 'before');
    expect(result.success).toBe(true);

    // Same-file moves don't run the cross-file import-bookkeeping path, so
    // adjustments must be undefined (clean move).
    expect(result.adjustments).toBeUndefined();
    // And no cross-file snapshots either — only the one file changed.
    expect(result.allCrossFileSnapshots).toBeUndefined();

    const newContent = fileIO.content('/workspace/src/Layout.tsx');

    // Both import lines preserved verbatim.
    expect(newContent.includes(`import { Card } from './ui/Card';`)).toBe(true);
    expect(newContent.includes(`import { Banner } from './ui/Banner';`)).toBe(true);

    // The Card subtree is now inside <Bottom>, before <Banner className="bottom-banner">.
    const footerOpen = newContent.indexOf('"bottom-root"');
    const footerClose = newContent.indexOf('</footer>');
    const insideFooter = newContent.slice(footerOpen, footerClose);
    expect(insideFooter.indexOf('"moved-card"')).toBeLessThan(insideFooter.indexOf('"bottom-banner"'));

    // <Top> no longer carries the Card.
    const headerOpen = newContent.indexOf('"top-root"');
    const headerClose = newContent.indexOf('</header>');
    expect(newContent.slice(headerOpen, headerClose).includes('"moved-card"')).toBe(false);
  });

  it('moves into a third sibling component cleanly when source-component empties out', async () => {
    // Three components A/B/C in one file. Move A's only JSX into C; assert A
    // still renders (its return stays parseable, just emptied), C gains the
    // node, B is untouched. This exercises the "source parent loses its only
    // child" path in the same-file branch — historically a fertile bug area.
    const fixture = `export function A() {
  return (
    <div className="a-root">
      <span className="moved-from-a">solo</span>
    </div>
  );
}

export function B() {
  return (
    <div className="b-root">
      <span className="b-keep">stay</span>
    </div>
  );
}

export function C() {
  return (
    <div className="c-root">
      <span className="c-anchor">anchor</span>
    </div>
  );
}
`;
    const fileIO = new InMemoryFileIO({
      '/workspace/src/Triple.tsx': fixture,
    });
    const service = new AstService('/workspace', fileIO);
    await service.ensureInitialized();

    const sourceRef = refByClass(
      service,
      '/workspace/src/Triple.tsx',
      'src/Triple.tsx',
      'span',
      'moved-from-a',
      fixture,
    );
    const targetRef = refByClass(service, '/workspace/src/Triple.tsx', 'src/Triple.tsx', 'span', 'c-anchor', fixture);

    const result = await service.moveElement('src/Triple.tsx', sourceRef, targetRef, 'after');
    expect(result.success).toBe(true);

    const newContent = fileIO.content('/workspace/src/Triple.tsx');

    // A's <div className="a-root"> still in the file (component still parses)
    // but no longer carries the moved span.
    const aRootIdx = newContent.indexOf('"a-root"');
    expect(aRootIdx).toBeGreaterThan(-1);

    // The moved span is now inside C, after the c-anchor.
    const cRootIdx = newContent.indexOf('"c-root"');
    expect(cRootIdx).toBeGreaterThan(-1);
    const cClose = newContent.indexOf('</div>', cRootIdx);
    const insideC = newContent.slice(cRootIdx, cClose);
    expect(insideC.includes('"moved-from-a"')).toBe(true);
    expect(insideC.indexOf('"c-anchor"')).toBeLessThan(insideC.indexOf('"moved-from-a"'));

    // B totally untouched.
    expect(newContent.includes('"b-keep"')).toBe(true);
    const bRootIdx = newContent.indexOf('"b-root"');
    const bClose = newContent.indexOf('</div>', bRootIdx);
    const insideB = newContent.slice(bRootIdx, bClose);
    expect(insideB.includes('"moved-from-a"')).toBe(false);
  });
});
