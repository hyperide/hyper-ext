/**
 * @file AstService duplicate-element tests
 *
 * Accessed via: VS Code canvas duplicate command and MCP hyper_duplicate_element tool
 * Assumptions: selected element IDs from the preview iframe are source-location nodeRefs.
 * Past bugs: HYP-363 — duplicate ignored nodeRefs passed as elementId and always returned "Element not found".
 * Architecture: https://hyperide.github.io/reports/element-tracing
 */
import { describe, expect, it } from 'bun:test';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import { AstService } from '../services/AstService';

describe('AstService duplicate element', () => {
  it('resolves a source-location nodeRef passed as elementId', async () => {
    const { service, fileIO, componentPath, buttonNodeRef } = await createServiceWithButton();

    const result = await service.duplicateElement('src/App.tsx', buttonNodeRef);

    expect(result).toEqual({ success: true });
    expect(countOccurrences(fileIO.content(componentPath), '<button>Save</button>')).toBe(2);
  });
});

describe('AstService wrap element', () => {
  it('resolves a source-location nodeRef passed as elementId', async () => {
    const { service, fileIO, componentPath, buttonNodeRef } = await createServiceWithButton();

    const result = await service.wrapElement('src/App.tsx', buttonNodeRef, 'section', { className: 'wrapper' });

    expect(result).toEqual({ success: true });
    expect(fileIO.content(componentPath)).toContain('<section className="wrapper">');
    expect(fileIO.content(componentPath)).toContain('<button>Save</button>');
  });
});

async function createServiceWithButton() {
  const componentPath = '/workspace/src/App.tsx';
  const fileIO = new InMemoryFileIO({
    [componentPath]: `export function App() {
  return (
    <main>
      <button>Save</button>
    </main>
  );
}
`,
  });
  const service = new AstService('/workspace', fileIO);
  await service.ensureInitialized();

  const entries = service.nodeMapService.getNodeMap(componentPath);
  const button = entries?.find((entry) => entry.tag === 'button');
  if (!button) throw new Error('Expected button entry in node map');

  return {
    service,
    fileIO,
    componentPath,
    buttonNodeRef: `src/App.tsx:${button.loc.line}:${button.loc.column}`,
  };
}

function countOccurrences(text: string, substring: string): number {
  return text.split(substring).length - 1;
}
