/**
 * @file Go-to-Visual resolution: `findElementAtPosition` must return a SOURCE-LOCATION
 * nodeRef (`fileName:line:column`) the iframe can parse, not the node map's synthetic
 * `filePath:counter` ref (which `parseSourceRef` rejects → nothing highlighted/scrolled).
 */
import { describe, expect, it } from 'bun:test';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import type { NodeMapEntry } from '@shared/element-tracing/types';
import { AstService } from '../services/AstService';

const SOURCE_REF_FORMAT = /^.+:\d+:\d+$/; // fileName:line:column — what the iframe's parseSourceRef accepts

function sourceRef(entry: NodeMapEntry): string {
  return `${entry.loc.fileName}:${entry.loc.line}:${entry.loc.column}`;
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

describe('AstService go-to-visual: findElementAtPosition nodeRef', () => {
  it('returns a parseable fileName:line:column ref (not the synthetic filePath:counter)', async () => {
    const componentPath = '/workspace/src/App.tsx';
    const service = new AstService('/workspace', new InMemoryFileIO({ [componentPath]: APP_SOURCE }));
    await service.ensureInitialized();

    const button = service.nodeMapService.getNodeMap(componentPath)?.find((e) => e.tag === 'button');
    if (!button) throw new Error('expected button entry');

    // Cursor on the <button> opening tag (loc is 1-based line / 0-based column).
    const result = await service.findElementAtPosition('src/App.tsx', button.loc.line, button.loc.column + 1);

    expect(result?.tagName).toBe('button');
    expect(result?.nodeRef).toBeDefined();
    // Regression: the old code returned `entry.nodeRef` = "src/App.tsx:<counter>" (2 parts),
    // which parseSourceRef rejects. It must now be the 3-part source location.
    expect(result?.nodeRef).toMatch(SOURCE_REF_FORMAT);
    expect(result?.nodeRef).toBe(sourceRef(button));
    expect(result?.nodeRef).not.toBe(button.nodeRef); // not the synthetic counter ref
  });
});
