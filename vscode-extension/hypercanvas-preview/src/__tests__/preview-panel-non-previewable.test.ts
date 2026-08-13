import { describe, expect, it } from 'bun:test';
import type { ComponentTree } from '../services/ComponentService';
import { buildNonPreviewablePayload, flattenComponentTree } from '../preview-panel-non-previewable';

const MAIN_TSX = `import { createRoot } from 'react-dom/client'
import App from './App.tsx'
createRoot(document.getElementById('root')!).render(<App />)`;

const APP_TSX = `export default function App() { return <div/>; }`;

function tree(partial: Partial<ComponentTree>): ComponentTree {
  return { atoms: [], composites: [], pages: [], ...partial };
}

const SAMPLE_COMPONENTS = [
  { path: 'src/App.tsx', name: 'App' },
  { path: 'src/components/Feed.tsx', name: 'Feed' },
];

describe('buildNonPreviewablePayload', () => {
  it('returns an entry-file payload with recommendations for main.tsx', async () => {
    const payload = await buildNonPreviewablePayload({
      filePath: 'src/main.tsx',
      readSource: async () => MAIN_TSX,
      listRenderableComponents: async () => SAMPLE_COMPONENTS,
    });
    expect(payload).not.toBeNull();
    expect(payload?.reason).toBe('entry-file');
    expect(payload?.filePath).toBe('src/main.tsx');
    expect(payload?.recommendations.map((r) => r.path)).toEqual(['src/App.tsx', 'src/components/Feed.tsx']);
  });

  it('returns null (previewable) for a real component', async () => {
    const payload = await buildNonPreviewablePayload({
      filePath: 'src/App.tsx',
      readSource: async () => APP_TSX,
      listRenderableComponents: async () => SAMPLE_COMPONENTS,
    });
    expect(payload).toBeNull();
  });

  it('returns null when the file is unreadable (lets the normal pipeline run)', async () => {
    const payload = await buildNonPreviewablePayload({
      filePath: 'src/gone.tsx',
      readSource: async () => null,
      listRenderableComponents: async () => SAMPLE_COMPONENTS,
    });
    expect(payload).toBeNull();
  });

  it('excludes the opened file from its own recommendations', async () => {
    const payload = await buildNonPreviewablePayload({
      filePath: 'src/App.tsx',
      // A non-component file at the App path: ensure self-exclusion still applies.
      readSource: async () => 'export const API = 1;',
      listRenderableComponents: async () => SAMPLE_COMPONENTS,
    });
    expect(payload?.reason).toBe('no-renderable-export');
    expect(payload?.recommendations.map((r) => r.path)).toEqual(['src/components/Feed.tsx']);
  });

  it('degrades to an empty recommendation list when the scan fails', async () => {
    const payload = await buildNonPreviewablePayload({
      filePath: 'src/main.tsx',
      readSource: async () => MAIN_TSX,
      listRenderableComponents: async () => {
        throw new Error('scan failed');
      },
    });
    expect(payload?.reason).toBe('entry-file');
    expect(payload?.recommendations).toEqual([]);
  });
});

describe('flattenComponentTree', () => {
  it('flattens pages → composites → atoms into {path,name}', () => {
    const flat = flattenComponentTree(
      tree({
        atoms: [
          {
            name: 'Badge',
            path: 'src/ui/Badge.tsx',
            type: 'atom',
            hasDefaultExport: true,
            hasSampleRender: false,
            props: [],
          },
        ],
        pages: [
          {
            name: 'Home',
            path: 'src/pages/Home.tsx',
            type: 'page',
            hasDefaultExport: true,
            hasSampleRender: false,
            props: [],
          },
        ],
      }),
    );
    expect(flat).toEqual([
      { path: 'src/pages/Home.tsx', name: 'Home' },
      { path: 'src/ui/Badge.tsx', name: 'Badge' },
    ]);
  });

  it('drops HyperIDE-generated __canvas_preview scaffolds', () => {
    const flat = flattenComponentTree(
      tree({
        atoms: [
          {
            name: 'CanvasPreview',
            path: 'src/__canvas_preview_standalone__.tsx',
            type: 'atom',
            hasDefaultExport: true,
            hasSampleRender: false,
            props: [],
          },
          {
            name: 'Badge',
            path: 'src/ui/Badge.tsx',
            type: 'atom',
            hasDefaultExport: true,
            hasSampleRender: false,
            props: [],
          },
        ],
      }),
    );
    expect(flat).toEqual([{ path: 'src/ui/Badge.tsx', name: 'Badge' }]);
  });
});
