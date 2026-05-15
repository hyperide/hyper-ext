/**
 * @file AstService.moveElement cross-file unit tests — Task 3 of the
 * move-any-to-any plan.
 *
 * Accessed via: iframe drag-drop → hypercanvas:moveElement → AstService.moveElement
 *               (cross-file branch when source and target sit in different files).
 *
 * Assumptions:
 *   - both nodeRefs are source-location strings (`relPath:line:col`) and
 *     resolve through NodeMapService;
 *   - InMemoryFileIO is pre-populated with both files;
 *   - cross-file moves replicate every import the moved subtree references
 *     and prune source-file imports orphaned by the cut.
 */
import { describe, expect, it } from 'bun:test';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import { AstService } from '../services/AstService';

interface NodeMapEntryLike {
  loc: { line: number; column: number };
  tag: string;
}

/**
 * Locate a JSX element by tag + (optional) className in the node map and
 * return its source-location nodeRef. Mirrors the helper in
 * AstServiceMove.test.ts but takes the file source explicitly so we can
 * disambiguate by className when there are multiple same-tag entries.
 */
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

describe('AstService.moveElement — cross-file moves (Task 3)', () => {
  it('utility component dragged across files: replicates import in target, prunes orphaned source import', async () => {
    // SourceFile imports Button only because of the JSX node we're about to move.
    // After the move, SourceFile should have NO Button import; TargetFile should have one.
    const sourceFile = `import { Button } from './ui/Button';

export default function Source() {
  return (
    <div className="src-root">
      <Button className="moved-btn">Click me</Button>
    </div>
  );
}
`;
    const targetFile = `export default function Target() {
  return (
    <section className="tgt-root">
      <p className="tgt-p">hello</p>
    </section>
  );
}
`;
    // ui/Button.tsx must exist so its node map populates (also exercises the
    // relative-path math).
    const buttonFile = `export function Button({ children }: { children: React.ReactNode }) {
  return <button>{children}</button>;
}
`;
    const fileIO = new InMemoryFileIO({
      '/workspace/src/Source.tsx': sourceFile,
      '/workspace/src/Target.tsx': targetFile,
      '/workspace/src/ui/Button.tsx': buttonFile,
    });
    const service = new AstService('/workspace', fileIO);
    await service.ensureInitialized();

    const sourceRef = refByClass(
      service,
      '/workspace/src/Source.tsx',
      'src/Source.tsx',
      'Button',
      'moved-btn',
      sourceFile,
    );
    const targetRef = refByClass(service, '/workspace/src/Target.tsx', 'src/Target.tsx', 'p', 'tgt-p', targetFile);

    const result = await service.moveElement('src/Source.tsx', sourceRef, targetRef, 'after');
    expect(result.success).toBe(true);

    // adjustments must mention both the new import (target) and the orphan removal (source).
    expect(result.adjustments).toBeDefined();
    expect(result.adjustments?.some((a) => a.includes('added import: Button'))).toBe(true);
    expect(result.adjustments?.some((a) => a.includes('removed orphaned import: Button'))).toBe(true);

    // BOTH files appear in allCrossFileSnapshots so undo can restore each independently.
    const paths = result.allCrossFileSnapshots?.map((s) => s.resolvedPath).sort();
    expect(paths).toEqual(['/workspace/src/Source.tsx', '/workspace/src/Target.tsx']);

    const newSource = fileIO.content('/workspace/src/Source.tsx');
    const newTarget = fileIO.content('/workspace/src/Target.tsx');

    // Source: Button gone from JSX AND from imports.
    expect(newSource.includes('moved-btn')).toBe(false);
    expect(newSource.includes('import { Button }')).toBe(false);
    // Target: Button now both in JSX and imported, with the path adjusted to be relative
    // to TargetFile's dir (./ui/Button — same dir level, so unchanged here).
    expect(newTarget.includes('moved-btn')).toBe(true);
    expect(/from ['"]\.\/ui\/Button['"]/.test(newTarget)).toBe(true);
    // The moved <Button> sits AFTER <p className="tgt-p"> per position='after'.
    expect(newTarget.indexOf('tgt-p')).toBeLessThan(newTarget.indexOf('moved-btn'));
  });

  it('custom hook usage moved with its consumer: replicates the hook import alongside the JSX', async () => {
    // The moved JSX consumes a value derived from a hook call. Both `useTimer`
    // (the hook) and `formatMs` (a helper) come from the source file's imports.
    // Both must be replicated in target; source must lose them when the move
    // empties the only references.
    const sourceFile = `import { useTimer } from './hooks/useTimer';
import { formatMs } from './utils/format';

export default function Source() {
  return (
    <div className="src-root">
      <span className="moved-clock">{formatMs(useTimer())}</span>
    </div>
  );
}
`;
    const targetFile = `export default function Target() {
  return (
    <main className="tgt-root">
      <h1 className="tgt-title">Hello</h1>
    </main>
  );
}
`;
    const fileIO = new InMemoryFileIO({
      '/workspace/src/Source.tsx': sourceFile,
      '/workspace/src/Target.tsx': targetFile,
      '/workspace/src/hooks/useTimer.tsx': `export function useTimer(): number { return 0; }\n`,
      '/workspace/src/utils/format.tsx': `export function formatMs(n: number): string { return String(n); }\n`,
    });
    const service = new AstService('/workspace', fileIO);
    await service.ensureInitialized();

    const sourceRef = refByClass(
      service,
      '/workspace/src/Source.tsx',
      'src/Source.tsx',
      'span',
      'moved-clock',
      sourceFile,
    );
    const targetRef = refByClass(service, '/workspace/src/Target.tsx', 'src/Target.tsx', 'h1', 'tgt-title', targetFile);

    const result = await service.moveElement('src/Source.tsx', sourceRef, targetRef, 'after');
    expect(result.success).toBe(true);
    expect(result.adjustments?.some((a) => a.includes('added import: useTimer'))).toBe(true);
    expect(result.adjustments?.some((a) => a.includes('added import: formatMs'))).toBe(true);
    expect(result.adjustments?.some((a) => a.includes('removed orphaned import: useTimer'))).toBe(true);
    expect(result.adjustments?.some((a) => a.includes('removed orphaned import: formatMs'))).toBe(true);

    const newSource = fileIO.content('/workspace/src/Source.tsx');
    const newTarget = fileIO.content('/workspace/src/Target.tsx');

    // Source loses both imports along with the JSX node.
    expect(newSource.includes('useTimer')).toBe(false);
    expect(newSource.includes('formatMs')).toBe(false);
    expect(newSource.includes('moved-clock')).toBe(false);

    // Target gains both imports and the JSX node.
    expect(/from ['"]\.\/hooks\/useTimer['"]/.test(newTarget)).toBe(true);
    expect(/from ['"]\.\/utils\/format['"]/.test(newTarget)).toBe(true);
    expect(newTarget.includes('moved-clock')).toBe(true);
  });

  it('styled component reference: replicates only the imports the subtree uses, leaves unrelated source imports intact', async () => {
    // SourceFile imports BOTH `Card` (used by the moved subtree) and `Banner`
    // (used by the leftover JSX in source). After move:
    //   - Target gets `Card` import, NOT `Banner`.
    //   - Source keeps `Banner`, drops `Card`.
    const sourceFile = `import { Card } from './styled/Card';
import { Banner } from './styled/Banner';

export default function Source() {
  return (
    <div className="src-root">
      <Card className="moved-card">
        <span>card body</span>
      </Card>
      <Banner className="kept-banner">stays put</Banner>
    </div>
  );
}
`;
    const targetFile = `import { Layout } from './layout/Layout';

export default function Target() {
  return (
    <Layout>
      <div className="tgt-anchor">anchor</div>
    </Layout>
  );
}
`;
    const fileIO = new InMemoryFileIO({
      '/workspace/src/Source.tsx': sourceFile,
      '/workspace/src/Target.tsx': targetFile,
      '/workspace/src/styled/Card.tsx': `export function Card(p: any) { return <div {...p} />; }\n`,
      '/workspace/src/styled/Banner.tsx': `export function Banner(p: any) { return <div {...p} />; }\n`,
      '/workspace/src/layout/Layout.tsx': `export function Layout(p: any) { return <div {...p} />; }\n`,
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
      '/workspace/src/Target.tsx',
      'src/Target.tsx',
      'div',
      'tgt-anchor',
      targetFile,
    );

    const result = await service.moveElement('src/Source.tsx', sourceRef, targetRef, 'before');
    expect(result.success).toBe(true);

    // Adjustments: Card replicated to target AND removed from source.
    // Banner must NOT appear anywhere in adjustments.
    expect(result.adjustments?.some((a) => a.includes('added import: Card'))).toBe(true);
    expect(result.adjustments?.some((a) => a.includes('removed orphaned import: Card'))).toBe(true);
    expect(result.adjustments?.some((a) => a.includes('Banner'))).toBe(false);
    expect(result.adjustments?.some((a) => a.includes('Layout'))).toBe(false);

    const newSource = fileIO.content('/workspace/src/Source.tsx');
    const newTarget = fileIO.content('/workspace/src/Target.tsx');

    // Source keeps Banner import + JSX, drops Card import + JSX.
    expect(newSource.includes('import { Banner }')).toBe(true);
    expect(newSource.includes('kept-banner')).toBe(true);
    expect(newSource.includes('import { Card }')).toBe(false);
    expect(newSource.includes('moved-card')).toBe(false);

    // Target gains Card import (path resolved relative to its dir) and JSX.
    // Same dir level as source, so the relative path is identical: ./styled/Card
    expect(/from ['"]\.\/styled\/Card['"]/.test(newTarget)).toBe(true);
    expect(newTarget.includes('moved-card')).toBe(true);
    // Layout import still there, unchanged.
    expect(/from ['"]\.\/layout\/Layout['"]/.test(newTarget)).toBe(true);
    // Move position='before': moved-card appears BEFORE tgt-anchor.
    expect(newTarget.indexOf('moved-card')).toBeLessThan(newTarget.indexOf('tgt-anchor'));
  });

  it('merges replicated import into existing same-source declaration in target (no duplicate import line)', async () => {
    // Target already imports `Spinner` from './ui/widgets'. Source's moved
    // subtree references `Badge`, also from './ui/widgets'. The replication
    // must extend the existing target declaration, not add a second one.
    const sourceFile = `import { Badge, Spinner } from './ui/widgets';

export default function Source() {
  return (
    <section className="src-root">
      <Spinner className="src-spin" />
      <Badge className="moved-badge">new</Badge>
    </section>
  );
}
`;
    const targetFile = `import { Spinner } from './ui/widgets';

export default function Target() {
  return (
    <article className="tgt-root">
      <Spinner className="tgt-spin" />
      <p className="tgt-p">anchor</p>
    </article>
  );
}
`;
    const fileIO = new InMemoryFileIO({
      '/workspace/src/Source.tsx': sourceFile,
      '/workspace/src/Target.tsx': targetFile,
      '/workspace/src/ui/widgets.tsx': `export function Badge(p:any){return <span {...p}/>;}\nexport function Spinner(p:any){return <i {...p}/>;}\n`,
    });
    const service = new AstService('/workspace', fileIO);
    await service.ensureInitialized();

    const sourceRef = refByClass(
      service,
      '/workspace/src/Source.tsx',
      'src/Source.tsx',
      'Badge',
      'moved-badge',
      sourceFile,
    );
    const targetRef = refByClass(service, '/workspace/src/Target.tsx', 'src/Target.tsx', 'p', 'tgt-p', targetFile);

    const result = await service.moveElement('src/Source.tsx', sourceRef, targetRef, 'before');
    expect(result.success).toBe(true);

    const newTarget = fileIO.content('/workspace/src/Target.tsx');
    // Exactly one import line from './ui/widgets' must remain in target.
    const widgetsLines = newTarget.split('\n').filter((l) => /from ['"]\.\/ui\/widgets['"]/.test(l));
    expect(widgetsLines.length).toBe(1);
    // And it brings in BOTH names (merge succeeded).
    expect(widgetsLines[0].includes('Spinner')).toBe(true);
    expect(widgetsLines[0].includes('Badge')).toBe(true);

    // Source still uses Spinner, so its import keeps Spinner — but loses Badge.
    const newSource = fileIO.content('/workspace/src/Source.tsx');
    const sourceWidgets = newSource.split('\n').find((l) => /from ['"]\.\/ui\/widgets['"]/.test(l));
    expect(sourceWidgets).toBeDefined();
    expect(sourceWidgets?.includes('Spinner')).toBe(true);
    expect(sourceWidgets?.includes('Badge')).toBe(false);
  });
});
