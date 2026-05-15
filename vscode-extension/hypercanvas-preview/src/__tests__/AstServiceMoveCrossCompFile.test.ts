/**
 * @file AstService.moveElement cross-component cross-file unit tests —
 * Task 5 of the move-any-to-any plan (the most general case).
 *
 * Accessed via: iframe drag-drop → hypercanvas:moveElement → AstService.moveElement
 *               (cross-file branch when source and target sit in DIFFERENT
 *               components in DIFFERENT files).
 *
 * Assumptions:
 *   - Both nodeRefs are source-location strings (`relPath:line:col`) and
 *     resolve through NodeMapService.
 *   - Composition of Task 3 + Task 4: the cross-file branch already operates
 *     on JSX parents regardless of which component's return they sit in.
 *     Imports referenced by the moved subtree replicate into target;
 *     imports orphaned in source after the cut get pruned. Adding/removing
 *     happens regardless of which enclosing component the subtree came from.
 *   - The bulka-the-dog "Curly tail card moved from Appearance into Header"
 *     case is the canonical fixture this test guards.
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

describe('AstService.moveElement — cross-component cross-file moves (Task 5)', () => {
  it('bulka-the-dog: "Curly tail" card moves from Appearance into Header', async () => {
    // Cleaner version of the previous fixture — second card is now a
    // <p className="floppy-ears">, so Card has no remaining usages in
    // Appearance after the move.
    const appearanceFile = `import { Card } from './ui/Card';
import { Section } from './ui/Section';

export function Appearance() {
  return (
    <Section className="appearance-root">
      <Card className="curly-tail">Curly tail</Card>
      <p className="floppy-ears">Floppy ears</p>
    </Section>
  );
}
`;
    const headerFile = `import { Logo } from './ui/Logo';

export function Header() {
  return (
    <header className="header-root">
      <Logo className="header-logo" />
      <h1 className="header-title">Bulka the dog</h1>
    </header>
  );
}
`;
    const fileIO = new InMemoryFileIO({
      '/workspace/src/Appearance.tsx': appearanceFile,
      '/workspace/src/Header.tsx': headerFile,
      '/workspace/src/ui/Card.tsx': `export function Card(p:any){return <div {...p}/>;}\n`,
      '/workspace/src/ui/Section.tsx': `export function Section(p:any){return <section {...p}/>;}\n`,
      '/workspace/src/ui/Logo.tsx': `export function Logo(p:any){return <img alt="" {...p}/>;}\n`,
    });
    const service = new AstService('/workspace', fileIO);
    await service.ensureInitialized();

    const sourceRef = refByClass(
      service,
      '/workspace/src/Appearance.tsx',
      'src/Appearance.tsx',
      'Card',
      'curly-tail',
      appearanceFile,
    );
    const targetRef = refByClass(
      service,
      '/workspace/src/Header.tsx',
      'src/Header.tsx',
      'h1',
      'header-title',
      headerFile,
    );

    const result = await service.moveElement('src/Appearance.tsx', sourceRef, targetRef, 'before');
    expect(result.success).toBe(true);

    // adjustments: Card replicated to Header, pruned from Appearance.
    expect(result.adjustments?.some((a) => a.includes('added import: Card'))).toBe(true);
    expect(result.adjustments?.some((a) => a.includes('removed orphaned import: Card'))).toBe(true);
    expect(result.adjustments?.some((a) => a.includes('Section'))).toBe(false);
    expect(result.adjustments?.some((a) => a.includes('Logo'))).toBe(false);

    const newAppearance = fileIO.content('/workspace/src/Appearance.tsx');
    const newHeader = fileIO.content('/workspace/src/Header.tsx');

    // Appearance: curly-tail JSX gone, Card import gone, Section import kept.
    expect(newAppearance.includes('curly-tail')).toBe(false);
    expect(newAppearance.includes('import { Card }')).toBe(false);
    expect(newAppearance.includes(`import { Section } from './ui/Section';`)).toBe(true);
    // floppy-ears (the surviving non-Card JSX) is still inside <Section>.
    expect(newAppearance.includes('floppy-ears')).toBe(true);

    // Header: gained Card import (path resolves identically — same dir level)
    // AND the moved JSX, sitting BEFORE <h1 className="header-title"> per
    // position='before'.
    expect(/from ['"]\.\/ui\/Card['"]/.test(newHeader)).toBe(true);
    expect(newHeader.includes('curly-tail')).toBe(true);
    expect(newHeader.indexOf('curly-tail')).toBeLessThan(newHeader.indexOf('header-title'));
    // Logo import untouched.
    expect(newHeader.includes(`import { Logo } from './ui/Logo';`)).toBe(true);

    // The moved Card sits inside <header className="header-root">, not
    // outside of it (the cross-component leap landed inside the right
    // enclosing component).
    const headerOpen = newHeader.indexOf('"header-root"');
    const headerClose = newHeader.indexOf('</header>');
    expect(headerOpen).toBeGreaterThan(-1);
    expect(headerClose).toBeGreaterThan(headerOpen);
    const insideHeader = newHeader.slice(headerOpen, headerClose);
    expect(insideHeader.includes('curly-tail')).toBe(true);
  });

  it('source file declares multiple components — only the source component loses the JSX, others untouched', async () => {
    // Source file has TWO components (Appearance + Sidebar). We move from
    // Appearance into Header (in a separate file). Sidebar must stay
    // byte-untouched: cross-component cross-file move shouldn't ripple
    // through unrelated components in the source file.
    const sourceFile = `import { Card } from './ui/Card';

export function Appearance() {
  return (
    <section className="appearance-root">
      <Card className="moved-card">Curly tail</Card>
    </section>
  );
}

export function Sidebar() {
  return (
    <aside className="sidebar-root">
      <Card className="sidebar-card">untouched</Card>
    </aside>
  );
}
`;
    const targetFile = `export function Header() {
  return (
    <header className="header-root">
      <h1 className="header-title">Bulka</h1>
    </header>
  );
}
`;
    const fileIO = new InMemoryFileIO({
      '/workspace/src/Source.tsx': sourceFile,
      '/workspace/src/Header.tsx': targetFile,
      '/workspace/src/ui/Card.tsx': `export function Card(p:any){return <div {...p}/>;}\n`,
    });
    const service = new AstService('/workspace', fileIO);
    await service.ensureInitialized();

    const sourceRef = refByClass(
      service,
      '/workspace/src/Source.tsx',
      'src/Source.tsx',
      'Card',
      'moved-card',
      sourceFile,
    );
    const targetRef = refByClass(
      service,
      '/workspace/src/Header.tsx',
      'src/Header.tsx',
      'h1',
      'header-title',
      targetFile,
    );

    const result = await service.moveElement('src/Source.tsx', sourceRef, targetRef, 'after');
    expect(result.success).toBe(true);

    // Card is STILL used by Sidebar in source → no orphan prune adjustment.
    expect(result.adjustments?.some((a) => a.includes('added import: Card'))).toBe(true);
    expect(result.adjustments?.some((a) => a.includes('removed orphaned import: Card'))).toBe(false);

    const newSource = fileIO.content('/workspace/src/Source.tsx');
    const newTarget = fileIO.content('/workspace/src/Header.tsx');

    // Source: moved-card gone from Appearance, sidebar-card stays in Sidebar,
    // Card import KEPT (Sidebar still uses it).
    expect(newSource.includes('moved-card')).toBe(false);
    expect(newSource.includes('sidebar-card')).toBe(true);
    expect(newSource.includes(`import { Card } from './ui/Card';`)).toBe(true);

    // Sidebar's body wholly intact.
    const sidebarOpen = newSource.indexOf('"sidebar-root"');
    const sidebarClose = newSource.indexOf('</aside>');
    const insideSidebar = newSource.slice(sidebarOpen, sidebarClose);
    expect(insideSidebar.includes('"sidebar-card"')).toBe(true);

    // Target: gained Card import + the moved JSX (after header-title per position='after').
    expect(/from ['"]\.\/ui\/Card['"]/.test(newTarget)).toBe(true);
    expect(newTarget.includes('moved-card')).toBe(true);
    expect(newTarget.indexOf('header-title')).toBeLessThan(newTarget.indexOf('moved-card'));
  });
});
