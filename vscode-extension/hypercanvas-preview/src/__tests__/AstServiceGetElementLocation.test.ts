/**
 * @file "Go to Code" start-point resolution: `getElementLocation(componentPath, elementId)` must
 * resolve when called with ONLY two positional args. The non-LSP callers — MCP
 * `hyper_navigate_to_element` (onNavigate) and SyncPositionService's legacy cursor-sync fallback —
 * pass the ref in the `elementId` slot and never a third `nodeRef` arg, and the ref they send is a
 * SOURCE-LOCATION ref (`fileName:line:column`). The old code read only the ignored 3rd param (and
 * even with the param fallback, a bare resolveNodeRef matches only synthetic `filePath:counter`
 * refs), so those callers got null and Go to Code silently no-op'd; only the LSP path (PanelRouter,
 * which passes a synthetic ref as the 3rd arg) worked.
 *
 * (Keyboard "Go to Code" and the context-menu were migrated to getElementRange in an earlier wave
 * and no longer route through getElementLocation.)
 */
import { describe, expect, it } from 'bun:test';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import type { NodeMapEntry } from '@shared/element-tracing/types';
import { AstService } from '../services/AstService';

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

// Real callers send a PROJECT-RELATIVE source ref (`src/App.tsx:4:6`) — the form `selectedIds`
// carry (PreviewPanel/SyncPositionService). The node map keys entries on the ABSOLUTE path, so
// resolution must go through _normalizeNodeRef (relative → `/workspace/src/...`) then
// resolveSourceLocation. Build the relative ref by stripping the workspace root.
function relativeSourceRef(entry: NodeMapEntry): string {
  const relPath = entry.loc.fileName.replace(/^\/workspace\//, '');
  return `${relPath}:${entry.loc.line}:${entry.loc.column}`;
}

async function makeService(): Promise<{ service: AstService; button: NodeMapEntry }> {
  const componentPath = '/workspace/src/App.tsx';
  const service = new AstService('/workspace', new InMemoryFileIO({ [componentPath]: APP_SOURCE }));
  await service.ensureInitialized();
  const button = service.nodeMapService.getNodeMap(componentPath)?.find((e) => e.tag === 'button');
  if (!button) throw new Error('expected button entry');
  return { service, button };
}

describe('AstService go-to-code: getElementLocation two-arg form', () => {
  it('resolves a project-relative SOURCE-LOCATION ref in the elementId slot (the form real callers send)', async () => {
    const { service, button } = await makeService();

    // MCP onNavigate / SyncPositionService send `selectedIds[0]` = a relative `src/App.tsx:line:col`
    // ref, NOT the synthetic `filePath:counter` ref. A bare resolveNodeRef misses this; the tolerant
    // resolver (normalize → resolveSourceLocation) must hit it. This is the production path the fix
    // exists for, and it exercises the relative → absolute normalization.
    const loc = await service.getElementLocation('src/App.tsx', relativeSourceRef(button));

    expect(loc).not.toBeNull();
    expect(loc).toEqual({ line: button.loc.line, column: button.loc.column });
  });

  it('resolves a synthetic filePath:counter ref passed in the elementId slot (no 3rd arg)', async () => {
    const { service, button } = await makeService();

    const loc = await service.getElementLocation('src/App.tsx', button.nodeRef);

    expect(loc).not.toBeNull();
    expect(loc).toEqual({ line: button.loc.line, column: button.loc.column });
  });

  it('still resolves via the explicit 3rd nodeRef arg (LSP path unchanged)', async () => {
    const { service, button } = await makeService();

    // LSP path (PanelRouter) passes the resolved nodeRef as the 3rd arg with an arbitrary elementId.
    const loc = await service.getElementLocation('src/App.tsx', 'ignored-element-id', button.nodeRef);

    expect(loc).toEqual({ line: button.loc.line, column: button.loc.column });
  });

  it('returns null for an unresolvable source ref (out-of-range line)', async () => {
    const { service } = await makeService();

    const loc = await service.getElementLocation('src/App.tsx', 'src/App.tsx:9999:0');

    expect(loc).toBeNull();
  });

  it('returns null for an arbitrary non-ref elementId (MCP accepts any string)', async () => {
    const { service } = await makeService();

    // The MCP tool schema is `z.string()`; a garbage id must resolve to null, not throw.
    const loc = await service.getElementLocation('src/App.tsx', 'not-a-ref');

    expect(loc).toBeNull();
  });
});
