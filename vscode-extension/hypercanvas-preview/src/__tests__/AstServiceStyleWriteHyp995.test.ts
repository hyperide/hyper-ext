/**
 * @file HYP-995 integration tests — a dimensional/inline-style edit on a NON-forwarding component gets
 * the M1 verify-and-retry / warn+rollback treatment (never a dead `style` prop + TypeScript error).
 *
 * Own file (like AstServiceStyleWriteHyp901.test.ts): the verify-and-retry path's real AST reparse +
 * @babel/generator print corrupts sibling `it()`s under the shared happy-dom preload — see that file's
 * header. These cases warn WITHOUT wrapping (no reparse/generate), but the sibling-isolation policy is
 * cheap insurance, so they live here rather than beside the other AstService integration tests.
 */
import { describe, expect, it } from 'bun:test';
import { NodeMapService } from '@lib/element-tracing/node-map-service';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import { AstService } from '../services/AstService';

function syntheticRefFor(source: string, relativePath: string): string {
  const helper = new NodeMapService();
  const entry = helper.parseAndBuild(source, relativePath)[0];
  return `${relativePath}:${entry.loc.line}:${entry.loc.column}`;
}

const PAGE_REL = 'src/app/Page.tsx';
const PAGE_ABS = '/workspace/src/app/Page.tsx';
const CARD_ABS = '/workspace/src/app/Card.tsx';

/** Page renders <Card>; Card's props destructure decides what it forwards. */
function fixture(cardSource: string) {
  const pageSource = `import { Card } from './Card';\n\nexport function Page() {\n  return (\n    <Card title="Hello">\n      <p>body</p>\n    </Card>\n  );\n}\n`;
  const fileIO = new InMemoryFileIO({ [PAGE_ABS]: pageSource, [CARD_ABS]: cardSource });
  return { pageSource, fileIO };
}

const CLASSNAME_ONLY = `export function Card({ className, title, children }: { className?: string; title?: string; children?: React.ReactNode }) {\n  return (\n    <div className={className}>\n      <h2>{title}</h2>\n      {children}\n    </div>\n  );\n}\n`;
const FORWARDS_NEITHER = `export function Card({ title, children }: { title?: string; children?: React.ReactNode }) {\n  return (\n    <div>\n      <h2>{title}</h2>\n      {children}\n    </div>\n  );\n}\n`;
const FORWARDS_STYLE = `export function Card({ style, title, children }: { style?: React.CSSProperties; title?: string; children?: React.ReactNode }) {\n  return (\n    <div style={style}>\n      <h2>{title}</h2>\n      {children}\n    </div>\n  );\n}\n`;

describe('AstService HYP-995 — dimensional edit on a non-forwarding component', () => {
  it('a paddingLeft edit on a className-ONLY-forwarding <Card> warns + leaves the file untouched (no dead style prop)', async () => {
    const { pageSource, fileIO } = fixture(CLASSNAME_ONLY);
    const service = new AstService('/workspace', fileIO);
    const nodeRef = syntheticRefFor(pageSource, PAGE_REL);

    const result = await service.updateStyles(PAGE_REL, nodeRef, { paddingLeft: '32px' }, undefined, nodeRef);

    expect(result).toEqual(expect.objectContaining({ success: true }));
    if (!result.success) throw new Error('expected success');
    // The file is UNCHANGED — no `style={{ paddingLeft: '32px' }}` dead prop on <Card>.
    expect(fileIO.content(PAGE_ABS)).toBe(pageSource);
    expect(fileIO.content(PAGE_ABS)).not.toContain('paddingLeft');
    // Surfaced as the M1 non-forwarding warning (last-resort, rolled back), with a structured diagnosis.
    expect(result.warning?.componentName).toBe('Card');
    expect(result.warning?.kept).toBeUndefined();
    expect(result.warning?.diagnosis?.reason).toBe('property-not-verifiable');
    expect(result.warning?.diagnosis?.editedProperties).toEqual(['paddingLeft']);
    expect(result.warning?.diagnosis?.componentDefinition?.filePath).toBe(CARD_ABS);
  });

  it('a marginTop edit on a forwards-NEITHER <Card> warns + leaves the file untouched (locks the acceptance case)', async () => {
    const { pageSource, fileIO } = fixture(FORWARDS_NEITHER);
    const service = new AstService('/workspace', fileIO);
    const nodeRef = syntheticRefFor(pageSource, PAGE_REL);

    const result = await service.updateStyles(PAGE_REL, nodeRef, { marginTop: '24px' }, undefined, nodeRef);

    expect(result).toEqual(expect.objectContaining({ success: true }));
    if (!result.success) throw new Error('expected success');
    expect(fileIO.content(PAGE_ABS)).toBe(pageSource);
    expect(result.warning?.componentName).toBe('Card');
    expect(result.warning?.diagnosis?.reason).toBe('property-not-verifiable');
  });

  it('a width edit on a WORKSPACE-PACKAGE non-forwarding <Card> (conloca-mini case) warns + leaves file untouched', async () => {
    // The exact conloca-mini shape: <Card> imported from a bare monorepo workspace package whose
    // package.json entry is a `.ts` SOURCE barrel. Without workspace resolution this resolved to
    // `external` → dead `style` prop + TS error (the live repro). It must now get the M1 warn+rollback.
    const pageSource = `import { Card } from '@conloca-mini/ui';\n\nexport function Page() {\n  return (\n    <Card title="Hello">\n      <p>body</p>\n    </Card>\n  );\n}\n`;
    const fileIO = new InMemoryFileIO({
      [PAGE_ABS]: pageSource,
      '/workspace/node_modules/@conloca-mini/ui/package.json': JSON.stringify({
        exports: { '.': './src/index.ts' },
        module: 'src/index.ts',
      }),
      '/workspace/node_modules/@conloca-mini/ui/src/index.ts': `export { Card } from './Card';\n`,
      '/workspace/node_modules/@conloca-mini/ui/src/Card.tsx': `export function Card({ title, children }: { title?: string; children?: React.ReactNode }) {\n  return (\n    <section>\n      <h3>{title}</h3>\n      {children}\n    </section>\n  );\n}\n`,
    });
    const service = new AstService('/workspace', fileIO);
    const nodeRef = syntheticRefFor(pageSource, PAGE_REL);

    const result = await service.updateStyles(PAGE_REL, nodeRef, { width: '320px' }, undefined, nodeRef);

    expect(result).toEqual(expect.objectContaining({ success: true }));
    if (!result.success) throw new Error('expected success');
    // No dead `style={{ width: '320px' }}` prop on <Card>; file untouched; M1 warning surfaced.
    expect(fileIO.content(PAGE_ABS)).toBe(pageSource);
    expect(fileIO.content(PAGE_ABS)).not.toContain('width');
    expect(result.warning?.componentName).toBe('Card');
    expect(result.warning?.diagnosis?.reason).toBe('property-not-verifiable');
  });

  it('a paddingLeft edit on a <Card> that DOES forward style applies normally (no false refusal / warning)', async () => {
    const { fileIO } = fixture(FORWARDS_STYLE);
    const service = new AstService('/workspace', fileIO);
    const nodeRef = syntheticRefFor(fileIO.content(PAGE_ABS), PAGE_REL);

    const result = await service.updateStyles(PAGE_REL, nodeRef, { paddingLeft: '32px' }, undefined, nodeRef);

    expect(result).toEqual(expect.objectContaining({ success: true }));
    if (!result.success) throw new Error('expected success');
    // The write IS applied (Card forwards style to its root div) — a real `style` prop, no warning.
    const written = fileIO.content(PAGE_ABS);
    expect(written).toContain('paddingLeft');
    expect(result.warning).toBeUndefined();
  });
});
