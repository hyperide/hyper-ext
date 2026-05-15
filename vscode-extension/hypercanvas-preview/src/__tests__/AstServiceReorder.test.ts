/**
 * @file AstService reorderElement unit tests
 *
 * Accessed via: iframe drag-reorder → hypercanvas:reorderElement → ast:reorderElement → AstService.reorderElement
 * Assumptions: both source and target must share the same direct JSX parent;
 *   nodeRefs are source-location strings in relPath:line:col format.
 */
import { describe, expect, it } from 'bun:test';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import { AstService } from '../services/AstService';

const FLEX_FIXTURE = `export default function FlexList() {
  return (
    <div style={{ display: 'flex' }}>
      <div className="a">Item A</div>
      <div className="b">Item B</div>
      <div className="c">Item C</div>
    </div>
  );
}
`;

async function makeFlexService() {
  const relPath = 'src/FlexList.tsx';
  const absPath = `/workspace/${relPath}`;
  const fileIO = new InMemoryFileIO({ [absPath]: FLEX_FIXTURE });
  const service = new AstService('/workspace', fileIO);
  await service.ensureInitialized();

  const entries = service.nodeMapService.getNodeMap(absPath) ?? [];
  const divs = entries.filter((e) => e.tag === 'div').sort((a, b) => a.loc.line - b.loc.line);
  // divs[0] = outer flex container, divs[1..3] = item A, B, C
  const [, divA, divB, divC] = divs;

  function ref(entry: (typeof divs)[0]) {
    return `${relPath}:${entry.loc.line}:${entry.loc.column}`;
  }

  return { service, fileIO, absPath, relPath, divA, divB, divC, ref };
}

describe('AstService reorderElement', () => {
  it('moves first child after second child (A → after B)', async () => {
    const { service, fileIO, absPath, relPath, divA, divB, ref } = await makeFlexService();

    const result = await service.reorderElement(relPath, ref(divA), ref(divB), 'after');

    expect(result.success).toBe(true);
    const content = fileIO.content(absPath);
    // className="b" must appear before className="a" after reorder
    expect(content.indexOf('"b"')).toBeLessThan(content.indexOf('"a"'));
  });

  it('moves third child before second child (C → before B)', async () => {
    const { service, fileIO, absPath, relPath, divB, divC, ref } = await makeFlexService();

    const result = await service.reorderElement(relPath, ref(divC), ref(divB), 'before');

    expect(result.success).toBe(true);
    const content = fileIO.content(absPath);
    // className="c" must appear before className="b"
    expect(content.indexOf('"c"')).toBeLessThan(content.indexOf('"b"'));
  });

  it('fails when source element is not found', async () => {
    const { service, relPath, divB, ref } = await makeFlexService();

    const result = await service.reorderElement(relPath, `${relPath}:99:99`, ref(divB), 'after');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('fails when target element is not found', async () => {
    const { service, relPath, divA, ref } = await makeFlexService();

    const result = await service.reorderElement(relPath, ref(divA), `${relPath}:99:99`, 'before');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('fails when elements do not share a direct JSX parent', async () => {
    const { service, relPath, divA, ref, absPath } = await makeFlexService();
    // outer div and inner divA are parent-child, not siblings
    const entries = service.nodeMapService.getNodeMap(absPath) ?? [];
    const outerDiv = entries.filter((e) => e.tag === 'div').sort((a, b) => a.loc.line - b.loc.line)[0];

    const result = await service.reorderElement(relPath, ref(outerDiv), ref(divA), 'after');

    expect(result.success).toBe(false);
  });
});
