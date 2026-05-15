/**
 * @file AstService selection navigation tests
 *
 * Accessed via: VS Code canvas keyboard commands for selecting parent, children, and siblings
 * Assumptions: React fiber source refs can differ from Babel node map columns for the same JSX line.
 * Architecture: https://hyperide.github.io/reports/element-tracing
 */
import { describe, expect, it } from 'bun:test';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import type { NodeMapEntry } from '@shared/element-tracing/types';
import { AstService } from '../services/AstService';

function mismatchedRelativeRef(entry: NodeMapEntry): string {
  return `src/App.tsx:${entry.loc.line}:${entry.loc.column + 100}`;
}

describe('AstService selection navigation', () => {
  it('resolves parent and child navigation from fiber refs with mismatched columns', async () => {
    const componentPath = '/workspace/src/App.tsx';
    const fileIO = new InMemoryFileIO({
      [componentPath]: `export function App() {
  return (
    <main>
      <section>
        <button>Save</button>
      </section>
    </main>
  );
}
`,
    });
    const service = new AstService('/workspace', fileIO);
    await service.ensureInitialized();

    const entries = service.nodeMapService.getNodeMap(componentPath);
    expect(entries).not.toBeNull();

    const section = entries?.find((entry) => entry.tag === 'section');
    const button = entries?.find((entry) => entry.tag === 'button');
    if (!section || !button) {
      throw new Error('Expected section and button entries in node map');
    }

    const parentId = await service.getParentElementId(
      'src/App.tsx',
      mismatchedRelativeRef(button),
      mismatchedRelativeRef(button),
    );
    const childIds = await service.getChildElementIds(
      'src/App.tsx',
      mismatchedRelativeRef(section),
      mismatchedRelativeRef(section),
    );

    expect(parentId).toBe(section.nodeRef);
    expect(childIds).toEqual([button.nodeRef]);
  });
});
