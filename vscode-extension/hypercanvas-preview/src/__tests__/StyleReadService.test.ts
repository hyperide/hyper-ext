/**
 * @file StyleReadService tests for VS Code inspector source metadata
 *
 * Accessed via: bun test vscode-extension/hypercanvas-preview/src/__tests__/StyleReadService.test.ts
 * Assumptions: NodeMapService source locations match Babel JSX element positions.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

import { describe, expect, it } from 'bun:test';
import type { FileIO } from '@lib/ast/file-io';
import { NodeMapService } from '@lib/element-tracing/node-map-service';
import { StyleReadService } from '../services/StyleReadService';

const SIMPLE_JSX = `const App = () => <div className="text-red"><span>hello</span></div>;`;
const DYNAMIC_JSX = `const App = ({ active }) => (
  <button className={\`px-4 py-2 \${active ? 'bg-blue' : 'bg-gray'}\`}>Click</button>
);`;
const INLINE_STYLE_JSX = `const App = () => <div style={{ color: 'red', paddingLeft: 4 }}>hello</div>;`;
const CSS_MODULE_JSX = `import styles from './Card.module.css';

const App = () => <article className={styles.card}>hello</article>;`;
const WORKSPACE = '/workspace';
const FILE_PATH = '/workspace/src/App.tsx';
const CARD_FILE_PATH = '/workspace/src/Card.tsx';

function makeFileIO(files: Record<string, string>): FileIO {
  return {
    readFile: async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    },
    writeFile: async () => {},
    access: async (path: string) => {
      if (!(path in files)) throw new Error(`File not found: ${path}`);
    },
  };
}

function getSyntheticRef(relativePath: string, line: number, column: number): string {
  return `${relativePath}:${line}:${column}`;
}

async function captureWarnings<T>(run: () => Promise<T>): Promise<{ result: T; warnings: string[] }> {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };

  try {
    return { result: await run(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

describe('StyleReadService', () => {
  it('resolves element via syntheticRef when NodeMapService is empty (inspector cold start)', async () => {
    // NodeMapService starts empty — simulates cold start before any file edit
    const nodeMap = new NodeMapService();

    // Use a separate NodeMapService just to find the correct line/column for the test
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(SIMPLE_JSX, 'src/App.tsx');
    const divEntry = entries[0]; // div element

    const syntheticRef = getSyntheticRef('src/App.tsx', divEntry.loc.line, divEntry.loc.column);

    const fileIO = makeFileIO({ [FILE_PATH]: SIMPLE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.className).toBe('text-red');
    expect(result.tagType).toBe('div');
    expect(result.styleReadResult?.sourceTabs.map((tab) => tab.id)).toEqual(['computed', 'tailwind-v4:elementClass']);
  });

  it('uses NodeMapService entry when it has the file parsed', async () => {
    const nodeMap = new NodeMapService();
    nodeMap.parseAndBuild(SIMPLE_JSX, FILE_PATH);

    const entries = nodeMap.getNodeMap(FILE_PATH) ?? [];
    const spanEntry = entries[1]; // span element

    const fileIO = makeFileIO({ [FILE_PATH]: SIMPLE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    // Use the UUID-style nodeRef from NodeMapService
    const result = await service.readElementClassName('src/App.tsx', spanEntry.nodeRef);

    expect(result.tagType).toBe('span');
  });

  it('syntheticRef resolves span at correct column when two elements on same line', async () => {
    const nodeMap = new NodeMapService();

    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(SIMPLE_JSX, 'src/App.tsx');
    const spanEntry = entries[1]; // span element

    const syntheticRef = getSyntheticRef('src/App.tsx', spanEntry.loc.line, spanEntry.loc.column);

    const fileIO = makeFileIO({ [FILE_PATH]: SIMPLE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.tagType).toBe('span');
  });

  it('returns empty when nodeRef is undefined', async () => {
    const nodeMap = new NodeMapService();
    const fileIO = makeFileIO({ [FILE_PATH]: SIMPLE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const result = await service.readElementClassName('src/App.tsx', undefined);

    expect(result.className).toBe('');
    expect(result.tagType).toBe('unknown');
  });

  it('returns empty when syntheticRef has wrong line/column (no element at position)', async () => {
    const nodeMap = new NodeMapService();
    const fileIO = makeFileIO({ [FILE_PATH]: SIMPLE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const { result, warnings } = await captureWarnings(() =>
      service.readElementClassName('src/App.tsx', 'src/App.tsx:999:999'),
    );

    expect(result.className).toBe('');
    expect(result.tagType).toBe('unknown');
    expect(warnings).toEqual([
      '[HyperCanvas] Selection lost after HMR — AST element not found at 999:999 for nodeRef: src/App.tsx:999:999',
    ]);
  });

  it('extracts static parts from dynamic template literal className', async () => {
    const nodeMap = new NodeMapService();

    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(DYNAMIC_JSX, 'src/App.tsx');
    const btnEntry = entries[0]; // button element

    const syntheticRef = getSyntheticRef('src/App.tsx', btnEntry.loc.line, btnEntry.loc.column);

    const fileIO = makeFileIO({ [FILE_PATH]: DYNAMIC_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.className).toContain('px-4');
    expect(result.className).toContain('py-2');
    expect(result.tagType).toBe('button');
    expect(result.styleReadResult?.sourceTabs[1]).toMatchObject({
      id: 'tailwind-v4:elementClass',
      confidence: 'probable',
    });
  });

  it('returns shared inline style source tab when the element has a style prop', async () => {
    const nodeMap = new NodeMapService();

    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(INLINE_STYLE_JSX, 'src/App.tsx');
    const divEntry = entries[0];

    const syntheticRef = getSyntheticRef('src/App.tsx', divEntry.loc.line, divEntry.loc.column);

    const fileIO = makeFileIO({ [FILE_PATH]: INLINE_STYLE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.styleReadResult?.sourceTabs.map((tab) => tab.id)).toEqual(['computed', 'inline-style:style']);
    expect(result.styleReadResult?.sourceTabs[1]).toMatchObject({
      label: 'Inline',
      cssSystem: 'inline-style',
      sourceForm: 'scriptReactStyleRule',
      confidence: 'exact',
    });
  });

  it('returns CSS Modules source tab for className member expressions', async () => {
    const nodeMap = new NodeMapService();

    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(CSS_MODULE_JSX, 'src/Card.tsx');
    const articleEntry = entries[0];

    const syntheticRef = getSyntheticRef('src/Card.tsx', articleEntry.loc.line, articleEntry.loc.column);

    const fileIO = makeFileIO({ [CARD_FILE_PATH]: CSS_MODULE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const result = await service.readElementClassName('src/Card.tsx', syntheticRef);

    expect(result.styleReadResult?.sourceTabs.map((tab) => tab.id)).toEqual(['computed', 'css-modules:card']);
    expect(result.styleReadResult?.sourceTabs[1]).toMatchObject({
      label: '.card',
      cssSystem: 'css-modules',
      sourceForm: 'cssStyleRule',
      filePath: '/workspace/src/Card.module.css',
      selector: '.card',
      classKey: 'card',
      confidence: 'exact',
    });
  });

  it('returns empty when nodeRef is an opaque UUID and NodeMapService is empty', async () => {
    const nodeMap = new NodeMapService();
    const fileIO = makeFileIO({ [FILE_PATH]: SIMPLE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const { result, warnings } = await captureWarnings(() =>
      service.readElementClassName('src/App.tsx', 'some-uuid-that-doesnt-exist'),
    );

    expect(result.className).toBe('');
    expect(result.tagType).toBe('unknown');
    expect(warnings).toEqual([
      '[HyperCanvas] Selection lost after HMR — element not found for nodeRef: some-uuid-that-doesnt-exist',
    ]);
  });
});
