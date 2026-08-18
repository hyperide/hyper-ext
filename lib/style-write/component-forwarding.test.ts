/**
 * @file HYP-995 — unit tests for the shared, channel-aware component-forwarding detector.
 *
 * Covers the divergence the bug came from: a component that forwards `className` but NOT `style` must
 * be reported as forwardsClassName:true, forwardsStyle:false — so a `style`-channel write onto it is
 * caught as dead, while a `className`-channel write is admitted.
 */
import { describe, expect, it } from 'bun:test';
import { parseCode } from '@lib/ast/parser';
import { findElementByPosition } from '@lib/ast/position-finder';
import { forwardsProp, resolveComponentForwarding } from './component-forwarding';
import { InMemoryFileIO } from './testing/in-memory-file-io';

const PAGE = '/project/src/Page.tsx';
const CARD = '/project/src/Card.tsx';

async function factsFor(pageSource: string, componentSource: string | null) {
  const files: Record<string, string> = { [PAGE]: pageSource };
  if (componentSource !== null) files[CARD] = componentSource;
  const fileIO = new InMemoryFileIO(files);
  const ast = parseCode(pageSource);
  // The <Card>/<div>/… element is on the JSX return line — find the first custom/native tag.
  const found = findElementByPosition(ast, jsxLine(pageSource), jsxCol(pageSource));
  if (!found) throw new Error('element not found');
  return resolveComponentForwarding({ ast, filePath: PAGE, element: found.element, fileIO });
}

// The fixtures put the target element as the sole JSX element on one `return (<Tag …>` line.
function jsxLine(src: string): number {
  return src.split('\n').findIndex((l) => l.includes('return (<')) + 1;
}
function jsxCol(src: string): number {
  const line = src.split('\n').find((l) => l.includes('return (<')) ?? '';
  return line.indexOf('<');
}

const page = (tag: string, imp = `import { Card } from './Card';\n`) =>
  `${imp}export function Page() {\n  return (<${tag} />);\n}\n`;

describe('HYP-995 resolveComponentForwarding', () => {
  it('reports a native (lowercase) tag as native — forwards everything', async () => {
    const facts = await factsFor(page('div', ''), null);
    expect(facts.kind).toBe('native');
    expect(forwardsProp(facts, 'style')).toBe(true);
    expect(forwardsProp(facts, 'className')).toBe(true);
  });

  it('detects className-only forwarding: forwardsClassName true, forwardsStyle false (the bug case)', async () => {
    const facts = await factsFor(
      page('Card'),
      `export function Card({ className, title }: { className?: string; title?: string }) {\n  return <div className={className}>{title}</div>;\n}\n`,
    );
    expect(facts.kind).toBe('custom');
    if (facts.kind !== 'custom') throw new Error('expected custom');
    expect(facts.forwardsClassName).toBe(true);
    expect(facts.forwardsStyle).toBe(false);
    expect(facts.forwardsRest).toBe(false);
    // The channel-specific verdict: a style write is dead, a className write is fine.
    expect(forwardsProp(facts, 'style')).toBe(false);
    expect(forwardsProp(facts, 'className')).toBe(true);
  });

  it('a component forwarding NEITHER style/className/rest is dead for both channels', async () => {
    const facts = await factsFor(
      page('Card'),
      `export function Card({ title, children }: { title?: string; children?: unknown }) {\n  return <div>{title}{children as any}</div>;\n}\n`,
    );
    if (facts.kind !== 'custom') throw new Error('expected custom');
    expect(forwardsProp(facts, 'style')).toBe(false);
    expect(forwardsProp(facts, 'className')).toBe(false);
    // Definition is pinpointed for the AI-fix diagnosis.
    expect(facts.definition?.filePath).toBe(CARD);
  });

  it('a ...rest spread forwards every prop', async () => {
    const facts = await factsFor(
      page('Card'),
      `export function Card({ title, ...rest }: { title?: string }) {\n  return <div {...rest}>{title}</div>;\n}\n`,
    );
    if (facts.kind !== 'custom') throw new Error('expected custom');
    expect(facts.forwardsRest).toBe(true);
    expect(forwardsProp(facts, 'style')).toBe(true);
    expect(forwardsProp(facts, 'className')).toBe(true);
  });

  it('explicit style forwarding is detected', async () => {
    const facts = await factsFor(
      page('Card'),
      `export function Card({ style, title }: { style?: object; title?: string }) {\n  return <div style={style as any}>{title}</div>;\n}\n`,
    );
    if (facts.kind !== 'custom') throw new Error('expected custom');
    expect(facts.forwardsStyle).toBe(true);
    expect(forwardsProp(facts, 'style')).toBe(true);
  });

  it('an unresolvable (external-package) component is unknown → never refused', async () => {
    const facts = await factsFor(page('Card', `import { Card } from 'some-ui-lib';\n`), null);
    expect(facts.kind).toBe('unknown');
    expect(forwardsProp(facts, 'style')).toBe(true);
    expect(forwardsProp(facts, 'className')).toBe(true);
  });

  it('resolves a LOCAL workspace package (node_modules source symlink) and detects non-forwarding (conloca case)', async () => {
    // `<Card>` imported from a bare workspace package `@acme/ui` whose package.json entry is a `.ts`
    // SOURCE barrel. resolveMasterComponent alone reports this as `external` → the conloca dead-prop bug.
    // The detector must resolve the package entry + barrel and inspect the real (non-forwarding) params.
    const pageSrc = `import { Card } from '@acme/ui';\nexport function Page() {\n  return (<Card />);\n}\n`;
    const fileIO = new InMemoryFileIO({
      [PAGE]: pageSrc,
      '/project/node_modules/@acme/ui/package.json': JSON.stringify({ exports: { '.': './src/index.ts' } }),
      '/project/node_modules/@acme/ui/src/index.ts': `export { Card } from './Card';\n`,
      '/project/node_modules/@acme/ui/src/Card.tsx': `export function Card({ title, children }: { title?: string; children?: unknown }) {\n  return <div>{title}{children as any}</div>;\n}\n`,
    });
    const ast = parseCode(pageSrc);
    const found = findElementByPosition(ast, 3, pageSrc.split('\n')[2].indexOf('<'));
    if (!found) throw new Error('element not found');
    const facts = await resolveComponentForwarding({ ast, filePath: PAGE, element: found.element, fileIO });
    expect(facts.kind).toBe('custom');
    if (facts.kind !== 'custom') throw new Error('expected custom');
    expect(forwardsProp(facts, 'style')).toBe(false);
    expect(forwardsProp(facts, 'className')).toBe(false);
    expect(facts.definition?.filePath).toBe('/project/node_modules/@acme/ui/src/Card.tsx');
  });

  it('rejects a traversal specifier — never reads outside node_modules (security)', async () => {
    const pageSrc = `import { Card } from 'foo/../../../etc';\nexport function Page() {\n  return (<Card />);\n}\n`;
    const fileIO = new InMemoryFileIO({
      [PAGE]: pageSrc,
      // A package.json planted OUTSIDE where a safe resolve would look — must never be read.
      '/etc/package.json': JSON.stringify({ main: './x.tsx' }),
      '/etc/x.tsx': `export function Card({ title }: { title?: string }) { return <div>{title}</div>; }\n`,
    });
    const ast = parseCode(pageSrc);
    const found = findElementByPosition(ast, 3, pageSrc.split('\n')[2].indexOf('<'));
    if (!found) throw new Error('element not found');
    const facts = await resolveComponentForwarding({ ast, filePath: PAGE, element: found.element, fileIO });
    expect(facts.kind).toBe('unknown');
  });

  it('rejects a package whose entry escapes the package dir (security)', async () => {
    const pageSrc = `import { Card } from '@acme/ui';\nexport function Page() {\n  return (<Card />);\n}\n`;
    const fileIO = new InMemoryFileIO({
      [PAGE]: pageSrc,
      '/project/node_modules/@acme/ui/package.json': JSON.stringify({ main: '../../../../etc/evil.tsx' }),
      '/etc/evil.tsx': `export function Card({ title }: { title?: string }) { return <div>{title}</div>; }\n`,
    });
    const ast = parseCode(pageSrc);
    const found = findElementByPosition(ast, 3, pageSrc.split('\n')[2].indexOf('<'));
    if (!found) throw new Error('element not found');
    const facts = await resolveComponentForwarding({ ast, filePath: PAGE, element: found.element, fileIO });
    expect(facts.kind).toBe('unknown');
  });

  it('a real external package with a BUILT (.js) entry stays unknown (never inspected/refused)', async () => {
    const pageSrc = `import { Card } from 'built-ui';\nexport function Page() {\n  return (<Card />);\n}\n`;
    const fileIO = new InMemoryFileIO({
      [PAGE]: pageSrc,
      '/project/node_modules/built-ui/package.json': JSON.stringify({ main: './dist/index.js' }),
      '/project/node_modules/built-ui/dist/index.js': `export function Card(){}`,
    });
    const ast = parseCode(pageSrc);
    const found = findElementByPosition(ast, 3, pageSrc.split('\n')[2].indexOf('<'));
    if (!found) throw new Error('element not found');
    const facts = await resolveComponentForwarding({ ast, filePath: PAGE, element: found.element, fileIO });
    expect(facts.kind).toBe('unknown');
  });

  it('a non-destructured `props` param is treated conservatively (forwards, never refused)', async () => {
    const facts = await factsFor(
      page('Card'),
      `export function Card(props: { title?: string }) {\n  return <div>{props.title}</div>;\n}\n`,
    );
    if (facts.kind !== 'custom') throw new Error('expected custom');
    expect(forwardsProp(facts, 'style')).toBe(true);
    expect(forwardsProp(facts, 'className')).toBe(true);
  });
});
