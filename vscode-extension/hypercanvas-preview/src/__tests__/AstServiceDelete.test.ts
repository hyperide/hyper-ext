/**
 * @file AstService delete-element regression tests
 *
 * Accessed via: VS Code canvas Delete/Backspace key and context-menu Delete command
 * Assumptions: preview iframe sends source-location nodeRefs as elementIds (format: relPath:line:col);
 *   deleteElements must treat elementIds as nodeRefs, same as duplicateElement/wrapElement/updateStyles.
 * Past bugs: deleteElements called _resolveElement(ast, undefined, id) — _elementId param unused,
 *   nodeRef=undefined → always returned null → { success: false } for every deletion attempt.
 */
import { describe, expect, it } from 'bun:test';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import { AstService } from '../services/AstService';

const BULKA_FIXTURE = `export default function Index() {
  const { t } = useLanguage();
  return (
    <div>
      <p className="text-foreground/80">{t("habits.walks")}</p>
      <p className="text-foreground/80">{t("habits.walks")}</p>
    </div>
  );
}
`;

describe('AstService deleteElements — i18n call-expression paragraphs', () => {
  it('deletes one of two adjacent identical paragraphs using an exact source-location elementId', async () => {
    const { service, fileIO, componentPath, firstPNodeRef } = await createBulkaService();

    const result = await service.deleteElements('client/pages/Index.tsx', [firstPNodeRef]);

    expect(result.success).toBe(true);
    expect(countOccurrences(fileIO.content(componentPath), 't("habits.walks")')).toBe(1);
  });

  it('deletes one paragraph when the column is mismatched (React fiber _debugSource offset)', async () => {
    const { service, fileIO, componentPath, firstP } = await createBulkaService();

    const mismatchedRef = `client/pages/Index.tsx:${firstP.loc.line}:${firstP.loc.column + 100}`;
    const result = await service.deleteElements('client/pages/Index.tsx', [mismatchedRef]);

    expect(result.success).toBe(true);
    expect(countOccurrences(fileIO.content(componentPath), 't("habits.walks")')).toBe(1);
  });

  it('returns success: false when all provided IDs are not found', async () => {
    const { service } = await createBulkaService();

    const result = await service.deleteElements('client/pages/Index.tsx', ['nonexistent:99:99']);

    expect(result.success).toBe(false);
  });

  it('deletes both adjacent identical paragraphs in a single batch call (multi-id same-file)', async () => {
    const { service, fileIO, componentPath } = await createBulkaService();

    const entries = service.nodeMapService.getNodeMap('/workspace/client/pages/Index.tsx');
    const pElements = entries?.filter((e) => e.tag === 'p') ?? [];
    const refs = pElements.map((p) => `client/pages/Index.tsx:${p.loc.line}:${p.loc.column}`);

    const result = await service.deleteElements('client/pages/Index.tsx', refs);

    expect(result.success).toBe(true);
    expect(countOccurrences(fileIO.content(componentPath), 't("habits.walks")')).toBe(0);
  });
});

async function createBulkaService() {
  const componentPath = '/workspace/client/pages/Index.tsx';
  const fileIO = new InMemoryFileIO({ [componentPath]: BULKA_FIXTURE });
  const service = new AstService('/workspace', fileIO);
  await service.ensureInitialized();

  const entries = service.nodeMapService.getNodeMap(componentPath);
  const pElements = entries?.filter((e) => e.tag === 'p') ?? [];
  if (pElements.length < 2) throw new Error(`Expected 2 <p> entries in node map, got ${pElements.length}`);

  const firstP = pElements[0];
  return {
    service,
    fileIO,
    componentPath,
    firstP,
    firstPNodeRef: `client/pages/Index.tsx:${firstP.loc.line}:${firstP.loc.column}`,
  };
}

function countOccurrences(text: string, substring: string): number {
  return text.split(substring).length - 1;
}
