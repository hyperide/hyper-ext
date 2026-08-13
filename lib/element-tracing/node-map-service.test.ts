import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { SourceLocation } from '../../shared/element-tracing/types';
import { NodeMapService } from './node-map-service';

describe('NodeMapService', () => {
  let service: NodeMapService;

  beforeEach(() => {
    service = new NodeMapService();
  });

  const simpleJSX = `const App = () => <div><span>hello</span></div>;`;

  it('should parse file and build node map', () => {
    const entries = service.parseAndBuild(simpleJSX, 'src/App.tsx');
    expect(entries.length).toBe(2);
    expect(entries[0].tag).toBe('div');
    expect(entries[1].tag).toBe('span');
  });

  it('should store parsed map and return it by filePath', () => {
    service.parseAndBuild(simpleJSX, 'src/App.tsx');
    const map = service.getNodeMap('src/App.tsx');
    expect(map).toBeDefined();
    expect(map?.length).toBe(2);
  });

  it('should resolve source location to nodeRef', () => {
    const entries = service.parseAndBuild(simpleJSX, 'src/App.tsx');
    const divEntry = entries[0];
    const resolved = service.resolveSourceLocation(divEntry.loc);
    expect(resolved).not.toBeNull();
    expect(resolved?.nodeRef).toBe(divEntry.nodeRef);
  });

  it('should return refMapping on re-parse', () => {
    service.parseAndBuild(simpleJSX, 'src/App.tsx');
    const oldEntries = service.getNodeMap('src/App.tsx');
    const oldDivRef = oldEntries?.[0].nodeRef ?? '';
    const modifiedJSX = `const App = () => <div><p>new</p><span>hello</span></div>;`;
    const result = service.reparseAndUpdate(modifiedJSX, 'src/App.tsx');
    expect(result.refMapping).toBeDefined();
    expect(result.refMapping?.[oldDivRef]).toBeDefined();
    expect(result.version).toBe(2);
  });

  it('should increment version on each re-parse', () => {
    service.parseAndBuild(simpleJSX, 'src/App.tsx');
    const r1 = service.reparseAndUpdate(simpleJSX, 'src/App.tsx');
    const r2 = service.reparseAndUpdate(simpleJSX, 'src/App.tsx');
    expect(r1.version).toBe(2);
    expect(r2.version).toBe(3);
  });

  it('should resolve sandbox container paths automatically', () => {
    const entries = service.parseAndBuild(simpleJSX, 'src/App.tsx');
    const containerLoc: SourceLocation = {
      fileName: '/app/src/App.tsx',
      line: entries[0].loc.line,
      column: entries[0].loc.column,
    };
    const resolved = service.resolveSourceLocation(containerLoc);
    expect(resolved).not.toBeNull();
  });

  it('should invalidate file on remove', () => {
    service.parseAndBuild(simpleJSX, 'src/App.tsx');
    service.removeFile('src/App.tsx');
    expect(service.getNodeMap('src/App.tsx')).toBeNull();
  });

  it('should resolve nodeRef to entry', () => {
    const entries = service.parseAndBuild(simpleJSX, 'src/App.tsx');
    const resolved = service.resolveNodeRef(entries[0].nodeRef);
    expect(resolved).not.toBeNull();
    expect(resolved?.tag).toBe('div');
  });

  it('should compute file hash', () => {
    service.parseAndBuild(simpleJSX, 'src/App.tsx');
    const hash = service.getFileHash('src/App.tsx');
    expect(hash).toBeDefined();
    expect(typeof hash).toBe('string');
    expect(hash?.length).toBeGreaterThan(0);
  });

  it('should return list of tracked files', () => {
    service.parseAndBuild(simpleJSX, 'src/App.tsx');
    service.parseAndBuild(`const B = () => <p />;`, 'src/B.tsx');
    const files = service.getTrackedFiles();
    expect(files).toContain('src/App.tsx');
    expect(files).toContain('src/B.tsx');
    expect(files.length).toBe(2);
  });

  it('should return empty array when parseAndBuild receives invalid syntax', () => {
    const warn = mock(() => {});
    const orig = console.warn;
    console.warn = warn;
    try {
      const brokenJSX = `const App = () => <div><span>`;
      const entries = service.parseAndBuild(brokenJSX, 'src/Broken.tsx');
      expect(entries).toEqual([]);
      expect(service.getNodeMap('src/Broken.tsx')).toBeNull();
      expect(warn).toHaveBeenCalled();
    } finally {
      console.warn = orig;
    }
  });

  it('should return existing entries when reparseAndUpdate receives invalid syntax', () => {
    service.parseAndBuild(simpleJSX, 'src/App.tsx');
    const warn = mock(() => {});
    const orig = console.warn;
    console.warn = warn;
    try {
      const brokenJSX = `const App = () => <div><span>`;
      const result = service.reparseAndUpdate(brokenJSX, 'src/App.tsx');
      expect(result.nodes.length).toBe(2);
      expect(result.nodes[0].tag).toBe('div');
      expect(result.version).toBe(1);
      expect(warn).toHaveBeenCalled();
    } finally {
      console.warn = orig;
    }
  });

  it('should resolve React 19 relative path via suffix match (absolute filePath, relative source)', () => {
    // React 19: parseDebugStack returns 'src/App.tsx' but NodeMapService stores '/workspace/src/App.tsx'
    const entries = service.parseAndBuild(simpleJSX, '/workspace/src/App.tsx');
    const relativeLoc: SourceLocation = {
      fileName: 'src/App.tsx',
      line: entries[0].loc.line,
      column: entries[0].loc.column,
    };
    const resolved = service.resolveSourceLocation(relativeLoc);
    expect(resolved).not.toBeNull();
    expect(resolved?.tag).toBe('div');
  });

  it('should resolve React 19 relative path with leading slash segment', () => {
    // e.g. filePath = '/home/user/project/src/App.tsx', source.fileName = 'src/App.tsx'
    const entries = service.parseAndBuild(simpleJSX, '/home/user/project/src/App.tsx');
    const relativeLoc: SourceLocation = {
      fileName: 'src/App.tsx',
      line: entries[0].loc.line,
      column: entries[0].loc.column,
    };
    const resolved = service.resolveSourceLocation(relativeLoc);
    expect(resolved).not.toBeNull();
    expect(resolved?.tag).toBe('div');
  });

  it('should not false-positive on suffix match for different line numbers', () => {
    // Suffix matches path but line is different — should return null
    const entries = service.parseAndBuild(simpleJSX, '/workspace/src/App.tsx');
    const wrongLineLoc: SourceLocation = {
      fileName: 'src/App.tsx',
      line: entries[0].loc.line + 999,
      column: entries[0].loc.column,
    };
    const resolved = service.resolveSourceLocation(wrongLineLoc);
    expect(resolved).toBeNull();
  });

  it('should prefer column-exact match over line-only in suffix fallback', () => {
    // Two elements on the same line: div and span in `<div><span>hello</span></div>`
    // Both share line 1. The column-exact match should return the correct one.
    const entries = service.parseAndBuild(simpleJSX, '/workspace/src/App.tsx');
    // div and span are both on line 1 but at different columns
    const divEntry = entries[0]; // div
    const spanEntry = entries[1]; // span
    expect(divEntry.loc.line).toBe(spanEntry.loc.line); // same line
    expect(divEntry.loc.column).not.toBe(spanEntry.loc.column); // different columns

    const spanLoc: SourceLocation = {
      fileName: 'src/App.tsx',
      line: spanEntry.loc.line,
      column: spanEntry.loc.column,
    };
    const resolved = service.resolveSourceLocation(spanLoc);
    expect(resolved).not.toBeNull();
    expect(resolved?.tag).toBe('span');
  });

  describe('setProjectRoot', () => {
    it('stores entries under the project-relative key when projectRoot is set', () => {
      service.setProjectRoot('/workspace/project');
      service.parseAndBuild(simpleJSX, '/workspace/project/src/App.tsx');
      expect(service.getTrackedFiles()).toEqual(['src/App.tsx']);
    });

    it('getNodeMap accepts host-absolute input and returns the relative-keyed entry', () => {
      service.setProjectRoot('/workspace/project');
      service.parseAndBuild(simpleJSX, '/workspace/project/src/App.tsx');
      // Both forms resolve to the same entries — the API is input-tolerant.
      const byRelative = service.getNodeMap('src/App.tsx');
      const byHost = service.getNodeMap('/workspace/project/src/App.tsx');
      expect(byRelative).not.toBeNull();
      expect(byHost).toBe(byRelative);
    });

    it('stores entry.loc.fileName as the relative form', () => {
      service.setProjectRoot('/workspace/project');
      const entries = service.parseAndBuild(simpleJSX, '/workspace/project/src/App.tsx');
      expect(entries[0].loc.fileName).toBe('src/App.tsx');
    });

    it('resolves host-absolute fiber sources when projectRoot is set', () => {
      service.setProjectRoot('/workspace/project');
      const entries = service.parseAndBuild(simpleJSX, '/workspace/project/src/App.tsx');
      const resolved = service.resolveSourceLocation({
        fileName: '/workspace/project/src/App.tsx',
        line: entries[0].loc.line,
        column: entries[0].loc.column,
      });
      expect(resolved?.nodeRef).toBe(entries[0].nodeRef);
    });

    it('resolves sandbox container fiber sources regardless of projectRoot', () => {
      service.setProjectRoot('/workspace/project');
      const entries = service.parseAndBuild(simpleJSX, '/workspace/project/src/App.tsx');
      const resolved = service.resolveSourceLocation({
        fileName: '/app/src/App.tsx',
        line: entries[0].loc.line,
        column: entries[0].loc.column,
      });
      expect(resolved?.nodeRef).toBe(entries[0].nodeRef);
    });

    it('rekeys pre-seeded entries when setProjectRoot is called after parseAndBuild', () => {
      // Race scenario: onFileChanged() seeds an entry under its absolute key
      // before populateNodeMaps() gets a chance to call setProjectRoot.
      service.parseAndBuild(simpleJSX, '/workspace/project/src/App.tsx');
      expect(service.getTrackedFiles()).toEqual(['/workspace/project/src/App.tsx']);

      service.setProjectRoot('/workspace/project');
      expect(service.getTrackedFiles()).toEqual(['src/App.tsx']);

      // Entry loc.fileName, nodeRef prefix, and map key must stay aligned —
      // consumers that derive the map key from a nodeRef (e.g. SaaS
      // CanvasElementContextMenu.handleSelectChild) rely on that invariant.
      const rekeyed = service.getNodeMap('src/App.tsx');
      expect(rekeyed).not.toBeNull();
      const entry = rekeyed?.[0];
      expect(entry?.loc.fileName).toBe('src/App.tsx');
      expect(entry?.nodeRef.startsWith('src/App.tsx:')).toBe(true);
      expect(entry?.endLoc.fileName).toBe('src/App.tsx');

      // parentRef/children that pointed to the rekeyed file must also shift.
      const child = rekeyed?.[1];
      expect(child?.parentRef).toBe(entry?.nodeRef);
    });

    it('reparseAndUpdate with host-absolute filePath updates the existing relative entry', () => {
      // Regression: before this refactor, mutation routes passed host-absolute
      // filePaths while populate used a different format, so reparseAndUpdate
      // created duplicate entries keyed by the mutation path. With projectRoot
      // the two paths collapse to the same relative key.
      service.setProjectRoot('/workspace/project');
      service.parseAndBuild(simpleJSX, '/workspace/project/src/App.tsx');
      expect(service.getTrackedFiles()).toEqual(['src/App.tsx']);

      const modified = `const App = () => <div><p>new</p></div>;`;
      const update = service.reparseAndUpdate(modified, '/workspace/project/src/App.tsx');

      expect(service.getTrackedFiles()).toEqual(['src/App.tsx']);
      expect(update.filePath).toBe('src/App.tsx');
      expect(update.version).toBe(2);
    });
  });
});
