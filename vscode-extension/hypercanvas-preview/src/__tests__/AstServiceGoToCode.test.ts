/**
 * @file Go-to-Code resolution: `getElementRange` resolves a source-location elementId to the
 * element's FULL JSX range in its OWN file, so the editor SELECTS the element (not a caret) and
 * focuses the correct file's tab — including the cross-file (mapped element) case.
 */
import { describe, expect, it } from 'bun:test';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import type { NodeMapEntry } from '@shared/element-tracing/types';
import { AstService } from '../services/AstService';

function sourceRef(entry: NodeMapEntry): string {
  return `${entry.loc.fileName}:${entry.loc.line}:${entry.loc.column}`;
}

async function makeService(files: Record<string, string>): Promise<AstService> {
  const service = new AstService('/workspace', new InMemoryFileIO(files));
  await service.ensureInitialized();
  return service;
}

const APP_SOURCE = `export function App() {
  return (
    <main>
      <section className="wrap">
        <button>Save</button>
      </section>
    </main>
  );
}
`;

describe('AstService go-to-code: getElementRange', () => {
  it('resolves a source-location elementId to the element FULL JSX range', async () => {
    const componentPath = '/workspace/src/App.tsx';
    const service = await makeService({ [componentPath]: APP_SOURCE });

    const button = service.nodeMapService.getNodeMap(componentPath)?.find((e) => e.tag === 'button');
    if (!button) throw new Error('expected button entry');

    const range = await service.getElementRange('src/App.tsx', sourceRef(button));

    expect(range).not.toBeNull();
    // Selects the element (start..end), not just a caret at the start.
    expect(range?.startLine).toBe(button.loc.line);
    expect(range?.startColumn).toBe(button.loc.column);
    expect(range?.endLine).toBe(button.endLoc.line);
    expect(range?.endColumn).toBe(button.endLoc.column);
    expect(range?.endColumn).toBeGreaterThan(range!.startColumn); // a real range, not zero-width
    expect(range?.filePath).toBe(componentPath);
  });

  it('resolves an element that lives in a DIFFERENT file than the rendered component', async () => {
    // Mapped/cross-file case: the selected element's source is in Card.tsx while the
    // rendered component is App.tsx. Go-to-Code must open Card.tsx, not App.tsx.
    const appPath = '/workspace/src/App.tsx';
    const cardPath = '/workspace/src/Card.tsx';
    const service = await makeService({
      [appPath]: `import { Card } from './Card';
export function App() {
  return <main>{[1, 2, 3].map((n) => <Card key={n} n={n} />)}</main>;
}
`,
      [cardPath]: `export function Card({ n }: { n: number }) {
  return (
    <article className="card">
      <span className="label">Item {n}</span>
    </article>
  );
}
`,
    });

    const span = service.nodeMapService.getNodeMap(cardPath)?.find((e) => e.tag === 'span');
    if (!span) throw new Error('expected span entry');

    // Component being previewed is App.tsx, but the selected element resolves to Card.tsx.
    const range = await service.getElementRange('src/App.tsx', sourceRef(span));

    expect(range).not.toBeNull();
    expect(range?.filePath).toBe(cardPath);
    expect(range?.startLine).toBe(span.loc.line);
    expect(range?.startColumn).toBe(span.loc.column);
    expect(range?.endLine).toBe(span.endLoc.line);
    expect(range?.endColumn).toBe(span.endLoc.column);
  });

  it('returns null for a synthetic counter ref that is not in the node map', async () => {
    // Synthetic `filePath:counter` refs (the OLD format) are NOT accepted by getElementRange —
    // it expects source-location refs. A stale or fabricated counter ref must return null cleanly.
    const componentPath = '/workspace/src/App.tsx';
    const service = await makeService({ [componentPath]: APP_SOURCE });

    const range = await service.getElementRange('src/App.tsx', 'src/App.tsx:999' as string);
    expect(range).toBeNull();
  });

  it('returns null for a completely unknown element id', async () => {
    const componentPath = '/workspace/src/App.tsx';
    const service = await makeService({ [componentPath]: APP_SOURCE });

    const range = await service.getElementRange('src/App.tsx', 'src/Missing.tsx:1:0');
    expect(range).toBeNull();
  });
});
