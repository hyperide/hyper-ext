import { describe, expect, it } from 'bun:test';
import type { FileIO } from '@lib/ast/file-io';
import { NodeMapService } from '@lib/element-tracing/node-map-service';
import { StyleReadService } from '../services/StyleReadService';

const SIMPLE_JSX = `const App = () => <div className="text-red"><span>hello</span></div>;`;
const DYNAMIC_JSX = `const App = ({ active }) => (
  <button className={\`px-4 py-2 \${active ? 'bg-blue' : 'bg-gray'}\`}>Click</button>
);`;
const WORKSPACE = '/workspace';
const FILE_PATH = '/workspace/src/App.tsx';

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

    const result = await service.readElementClassName('e1', 'src/App.tsx', syntheticRef);

    expect(result.className).toBe('text-red');
    expect(result.tagType).toBe('div');
  });

  it('uses NodeMapService entry when it has the file parsed', async () => {
    const nodeMap = new NodeMapService();
    nodeMap.parseAndBuild(SIMPLE_JSX, FILE_PATH);

    const entries = nodeMap.getNodeMap(FILE_PATH) ?? [];
    const spanEntry = entries[1]; // span element

    const fileIO = makeFileIO({ [FILE_PATH]: SIMPLE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    // Use the UUID-style nodeRef from NodeMapService
    const result = await service.readElementClassName('e1', 'src/App.tsx', spanEntry.nodeRef);

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

    const result = await service.readElementClassName('e1', 'src/App.tsx', syntheticRef);

    expect(result.tagType).toBe('span');
  });

  it('returns empty when nodeRef is undefined', async () => {
    const nodeMap = new NodeMapService();
    const fileIO = makeFileIO({ [FILE_PATH]: SIMPLE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const result = await service.readElementClassName('e1', 'src/App.tsx', undefined);

    expect(result.className).toBe('');
    expect(result.tagType).toBe('unknown');
  });

  it('returns empty when syntheticRef has wrong line/column (no element at position)', async () => {
    const nodeMap = new NodeMapService();
    const fileIO = makeFileIO({ [FILE_PATH]: SIMPLE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const result = await service.readElementClassName('e1', 'src/App.tsx', 'src/App.tsx:999:999');

    expect(result.className).toBe('');
    expect(result.tagType).toBe('unknown');
  });

  it('extracts static parts from dynamic template literal className', async () => {
    const nodeMap = new NodeMapService();

    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(DYNAMIC_JSX, 'src/App.tsx');
    const btnEntry = entries[0]; // button element

    const syntheticRef = getSyntheticRef('src/App.tsx', btnEntry.loc.line, btnEntry.loc.column);

    const fileIO = makeFileIO({ [FILE_PATH]: DYNAMIC_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const result = await service.readElementClassName('e1', 'src/App.tsx', syntheticRef);

    expect(result.className).toContain('px-4');
    expect(result.className).toContain('py-2');
    expect(result.tagType).toBe('button');
  });

  it('returns empty when nodeRef is an opaque UUID and NodeMapService is empty', async () => {
    const nodeMap = new NodeMapService();
    const fileIO = makeFileIO({ [FILE_PATH]: SIMPLE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const result = await service.readElementClassName('e1', 'src/App.tsx', 'some-uuid-that-doesnt-exist');

    expect(result.className).toBe('');
    expect(result.tagType).toBe('unknown');
  });
});
