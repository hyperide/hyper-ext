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

  it('same-file write emits NO resolvedPath/contentBeforeWrite (bare shape, not classified cross-file)', async () => {
    const { service, buttonNodeRef } = await createServiceWithButton();

    // The element lives in the OPEN entry App.tsx — a same-file write. crossFileWriteFields
    // must return {} here so the undo-tracking fields are absent. Guards against path
    // normalization falsely classifying a same-file write as cross-file (which would emit a
    // spurious resolvedPath + a redundant contentBeforeWrite read).
    const result = await service.duplicateElement('src/App.tsx', buttonNodeRef);

    expect(result.success).toBe(true);
    expect('resolvedPath' in result).toBe(false);
    expect('contentBeforeWrite' in result).toBe(false);
  });
});

describe('AstService wrap element', () => {
  it('resolves a source-location nodeRef passed as elementId', async () => {
    const { service, fileIO, componentPath, buttonNodeRef } = await createServiceWithButton();

    const result = await service.wrapElement('src/App.tsx', buttonNodeRef, 'section', { className: 'wrapper' });

    expect(result).toEqual({ success: true });
    expect(fileIO.content(componentPath)).toContain("<section className='wrapper'>");
    expect(fileIO.content(componentPath)).toContain('<button>Save</button>');
  });
});

// All cross-file element ops live here. They share the same invariant: the open entry
// (App.tsx) is passed as componentPath, but the selected element's nodeRef points into a
// CHILD component file. The op must resolve into and write to the child, leaving the entry
// untouched. Regression guard for PI-5-MS-11: pre-fix these routed through plain
// _resolveElement and silently failed with "Element not found" for any child-file element.
describe('AstService cross-file element ops', () => {
  describe('duplicate element', () => {
    it('duplicates an element living in a child component file (componentPath is the entry App.tsx)', async () => {
      const { service, fileIO, appPath, childPath, childButtonNodeRef } = await createServiceWithChildButton();

      // componentPath is the open entry (App.tsx) but the selected element lives in the child —
      // mirrors PreviewPanel passing _currentComponent (App.tsx) as componentPath while
      // selectedIds[0] is the child element's nodeRef.
      const result = await service.duplicateElement('src/App.tsx', childButtonNodeRef);

      expect(result).toEqual(expect.objectContaining({ success: true }));
      expect(result.resolvedPath).toBe('/workspace/src/components/TrendingSidebar.tsx');
      expect(countOccurrences(fileIO.content(childPath), '<button>Trend</button>')).toBe(2);
      // The entry file must be untouched — the mutation belongs to the child.
      expect(countOccurrences(fileIO.content(appPath), '<button')).toBe(0);
    });

    it('snapshots the child file ORIGINAL content into contentBeforeWrite for undo', async () => {
      const { service, fileIO, childPath, childButtonNodeRef } = await createServiceWithChildButton();

      const original = fileIO.content(childPath);
      const result = await service.duplicateElement('src/App.tsx', childButtonNodeRef);

      expect(result).toEqual(expect.objectContaining({ success: true }));
      // The undo snapshot must carry the real pre-write content (so undo restores the child),
      // not undefined/empty. It is the child's content BEFORE the duplicate, not after.
      expect(result.contentBeforeWrite).toBe(original);
      expect(result.contentBeforeWrite).toContain('<button>Trend</button>');
      expect(countOccurrences(result.contentBeforeWrite ?? '', '<button>Trend</button>')).toBe(1);
    });
  });

  describe('wrap element', () => {
    it('wraps an element living in a child component file', async () => {
      const { service, fileIO, appPath, childPath, childButtonNodeRef } = await createServiceWithChildButton();

      const result = await service.wrapElement('src/App.tsx', childButtonNodeRef, 'section', { className: 'wrapper' });

      expect(result).toEqual(expect.objectContaining({ success: true }));
      expect(result.resolvedPath).toBe('/workspace/src/components/TrendingSidebar.tsx');
      expect(fileIO.content(childPath)).toContain("<section className='wrapper'>");
      expect(fileIO.content(childPath)).toContain('<button>Trend</button>');
      expect(countOccurrences(fileIO.content(appPath), '<section')).toBe(0);
    });
  });

  describe('insert element', () => {
    it('inserts a PascalCase component into a child file, injects its import there, and leaves the entry untouched', async () => {
      const { service, fileIO, appPath, childPath, asideNodeRef } = await createServiceWithChildButton();

      // parentNodeRef points at the child's <aside>; the insert + import injection must land
      // in the child AST, not the open entry. PascalCase componentType exercises ensureImport
      // against the child file.
      const result = await service.insertElement(
        'src/App.tsx',
        'aside',
        'Badge',
        {},
        undefined,
        undefined,
        undefined,
        asideNodeRef,
      );

      expect(result).toEqual(expect.objectContaining({ success: true }));
      expect(result.resolvedPath).toBe('/workspace/src/components/TrendingSidebar.tsx');

      const childAfter = fileIO.content(childPath);
      expect(childAfter).toContain('<Badge');
      // ensureImport ran against the CHILD file — it now has an import for Badge.
      expect(childAfter).toContain('import');
      expect(childAfter).toContain('Badge');
      // The entry must be untouched: no <Badge/> and no new import there.
      expect(fileIO.content(appPath)).not.toContain('<Badge');
      expect(fileIO.content(appPath)).not.toContain('Badge');
    });

    it('fires cross-file via the PRODUCTION shape: child nodeRef passed as parentId (no parentNodeRef arg)', async () => {
      const { service, fileIO, appPath, childPath, asideNodeRef } = await createServiceWithChildButton();

      // PRODUCTION wiring: RightPanelApp sends the parent's source-location nodeRef as
      // `parentId` (2nd arg); the AstBridge handler never populates the 8th `parentNodeRef`.
      // This is the call shape that actually reaches production — the test above uses the
      // never-populated 8th arg, so it does NOT prove production works. This one does.
      const result = await service.insertElement('src/App.tsx', asideNodeRef, 'Badge', {});

      expect(result).toEqual(expect.objectContaining({ success: true }));
      expect(result.resolvedPath).toBe('/workspace/src/components/TrendingSidebar.tsx');

      const childAfter = fileIO.content(childPath);
      expect(childAfter).toContain('<Badge');
      expect(childAfter).toContain('import');
      expect(childAfter).toContain('Badge');
      // The entry must be untouched — the insert + import belong to the child.
      expect(fileIO.content(appPath)).not.toContain('<Badge');
      expect(fileIO.content(appPath)).not.toContain('Badge');
    });

    it('falls back to a root insert into the open entry when the parent ref is unresolvable', async () => {
      const { service, fileIO, appPath, childPath } = await createServiceWithChildButton();

      // An unresolvable parent ref (here both a non-nodeRef `parentId` AND a bogus
      // `parentNodeRef`) must NOT hard-fail — cross-file resolution is additive, so it falls
      // through to a root insert into the OPEN entry file. This preserves the documented
      // contract (shared/ast-service-insert.test.ts: "insert goes to root level regardless of
      // parentId"); a hard-fail would regress it.
      const result = await service.insertElement(
        'src/App.tsx',
        'whatever',
        'Badge',
        {},
        undefined,
        undefined,
        undefined,
        'src/components/Nope.tsx:999:0',
      );

      expect(result).toEqual(expect.objectContaining({ success: true }));
      // Root insert lands in the open entry — and, being same-file, carries no cross-file fields.
      expect('resolvedPath' in result).toBe(false);
      expect(fileIO.content(appPath)).toContain('<Badge');
      // The child file is untouched — the unresolvable ref did not leak the insert there.
      expect(fileIO.content(childPath)).not.toContain('<Badge');
    });
  });

  describe('paste element', () => {
    it('pastes next to a nested child element (happy path) — lands in the child, entry untouched', async () => {
      const { service, fileIO, appPath, childPath, childButtonNodeRef } = await createServiceWithChildButton();

      const result = await service.pasteElement('src/App.tsx', null, '<span>Pasted</span>', childButtonNodeRef);

      expect(result).toEqual(expect.objectContaining({ success: true }));
      expect(result.resolvedPath).toBe('/workspace/src/components/TrendingSidebar.tsx');
      const childAfter = fileIO.content(childPath);
      expect(childAfter).toContain('<span>Pasted</span>');
      expect(childAfter).toContain('<button>Trend</button>');
      // Pasted directly after the <button>, still inside the child file.
      expect(childAfter.indexOf('<button>Trend</button>')).toBeLessThan(childAfter.indexOf('<span>Pasted</span>'));
      // The entry is untouched.
      expect(fileIO.content(appPath)).not.toContain('<span>Pasted</span>');
    });

    it('fires cross-file via the PRODUCTION shape: child nodeRef passed as _targetId (no targetNodeRef arg)', async () => {
      const { service, fileIO, appPath, childPath, childButtonNodeRef } = await createServiceWithChildButton();

      // PRODUCTION wiring: preview-panel-context-menu sends the target's source-location
      // nodeRef as `_targetId` (2nd arg) and never populates the 4th `targetNodeRef`. This is
      // the call shape that reaches production — the happy-path test above uses the
      // never-populated 4th arg, so it does NOT prove production works. This one does.
      const result = await service.pasteElement('src/App.tsx', childButtonNodeRef, '<span>Pasted</span>');

      expect(result).toEqual(expect.objectContaining({ success: true }));
      expect(result.resolvedPath).toBe('/workspace/src/components/TrendingSidebar.tsx');
      const childAfter = fileIO.content(childPath);
      expect(childAfter).toContain('<span>Pasted</span>');
      expect(childAfter).toContain('<button>Trend</button>');
      // Pasted directly after the <button>, still inside the child file.
      expect(childAfter.indexOf('<button>Trend</button>')).toBeLessThan(childAfter.indexOf('<span>Pasted</span>'));
      // The entry is untouched.
      expect(fileIO.content(appPath)).not.toContain('<span>Pasted</span>');
    });

    it('root-fallback lands in the resolved CHILD file when the target is the child root (no JSXElement parent)', async () => {
      const { service, fileIO, appPath, childPath, asideNodeRef } = await createServiceWithChildButton();

      // The target is the child's ROOT <aside>, whose path.parent is a ReturnStatement (not a
      // JSXElement) — so insertAfterTarget returns false and the root fallback fires. The
      // documented behavior: the fallback intentionally lands the paste at the root of the
      // SAME resolved child file (where the selection lives), NOT the open entry App.tsx.
      const result = await service.pasteElement('src/App.tsx', null, '<span>Root</span>', asideNodeRef);

      expect(result).toEqual(expect.objectContaining({ success: true }));
      expect(result.resolvedPath).toBe('/workspace/src/components/TrendingSidebar.tsx');
      expect(fileIO.content(childPath)).toContain('<span>Root</span>');
      // Crucially NOT the entry — the fallback must not leak the paste into App.tsx.
      expect(fileIO.content(appPath)).not.toContain('<span>Root</span>');
    });
  });
});

describe('AstService updateI18nKey', () => {
  it('replaces only the selected i18n key literal and preserves the helper expression', async () => {
    const componentPath = '/workspace/src/App.tsx';
    const source = `export function App() {
  return (
    <main>
      <h1>{richText(t("hero.title"))}</h1>
    </main>
  );
}
`;
    const fileIO = new InMemoryFileIO({ [componentPath]: source });
    const service = new AstService('/workspace', fileIO);
    await service.ensureInitialized();

    const entries = service.nodeMapService.getNodeMap(componentPath);
    const heading = entries?.find((entry) => entry.tag === 'h1');
    if (!heading) throw new Error('Expected h1 entry in node map');

    const result = await service.updateI18nKey(
      'src/App.tsx',
      `src/App.tsx:${heading.loc.line}:${heading.loc.column}`,
      'hero.title',
      'hero.new_title',
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(fileIO.content(componentPath)).toContain("richText(t('hero.new_title'))");
    expect(fileIO.content(componentPath)).not.toContain('t("hero.new_title")');
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

async function createServiceWithChildButton() {
  const appPath = '/workspace/src/App.tsx';
  const childPath = '/workspace/src/components/TrendingSidebar.tsx';
  const fileIO = new InMemoryFileIO({
    [appPath]: `import { TrendingSidebar } from './components/TrendingSidebar';

export function App() {
  return (
    <main>
      <TrendingSidebar />
    </main>
  );
}
`,
    [childPath]: `export function TrendingSidebar() {
  return (
    <aside>
      <button>Trend</button>
    </aside>
  );
}
`,
  });
  const service = new AstService('/workspace', fileIO);
  await service.ensureInitialized();

  const entries = service.nodeMapService.getNodeMap(childPath);
  const button = entries?.find((entry) => entry.tag === 'button');
  if (!button) throw new Error('Expected button entry in child node map');
  const aside = entries?.find((entry) => entry.tag === 'aside');
  if (!aside) throw new Error('Expected aside entry in child node map');

  return {
    service,
    fileIO,
    appPath,
    childPath,
    childButtonNodeRef: `src/components/TrendingSidebar.tsx:${button.loc.line}:${button.loc.column}`,
    asideNodeRef: `src/components/TrendingSidebar.tsx:${aside.loc.line}:${aside.loc.column}`,
  };
}

function countOccurrences(text: string, substring: string): number {
  return text.split(substring).length - 1;
}
