/**
 * @file AstService "Go to main component" resolution tests (HYP-563).
 *
 * Accessed via: inspector "Go to main component" button → `master:goToComponent`
 * RPC → AstService.getMasterComponentLocation. Verifies the end-to-end resolution
 * from a selected `<Button>` instance to the Button.tsx definition location.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';
import { NodeFileIO } from '@lib/ast/node-file-io';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import { AstService } from '../services/AstService';

describe('AstService.getMasterComponentLocation', () => {
  it('resolves a selected component instance to its master definition file + line', async () => {
    const appPath = '/workspace/src/App.tsx';
    const buttonPath = '/workspace/src/components/Button.tsx';
    const fileIO = new InMemoryFileIO({
      [appPath]: `import { Button } from './components/Button';

export function App() {
  return (
    <main>
      <Button>Save</Button>
    </main>
  );
}
`,
      [buttonPath]: `export function Button() {
  return <button />;
}
`,
    });
    const service = new AstService('/workspace', fileIO);
    await service.ensureInitialized();

    const entries = service.nodeMapService.getNodeMap(appPath);
    const button = entries?.find((entry) => entry.componentName === 'Button' || entry.tag === 'Button');
    if (!button) throw new Error('Expected a Button entry in the node map');

    const result = await service.getMasterComponentLocation('src/App.tsx', button.nodeRef, button.nodeRef);

    expect(result.kind).toBe('local');
    if (result.kind !== 'local') throw new Error('expected local');
    expect(result.filePath).toBe(buttonPath);
    expect(result.line).toBe(1);
  });

  it('reports host for a plain DOM element with no master component', async () => {
    const appPath = '/workspace/src/App.tsx';
    const fileIO = new InMemoryFileIO({
      [appPath]: `export function App() {
  return <div>plain</div>;
}
`,
    });
    const service = new AstService('/workspace', fileIO);
    await service.ensureInitialized();

    const entries = service.nodeMapService.getNodeMap(appPath);
    const div = entries?.find((entry) => entry.tag === 'div');
    if (!div) throw new Error('Expected a div entry');

    const result = await service.getMasterComponentLocation('src/App.tsx', div.nodeRef, div.nodeRef);
    expect(result.kind).toBe('host');
  });

  it('classifies a component imported from an external package as external', async () => {
    const appPath = '/workspace/src/App.tsx';
    const fileIO = new InMemoryFileIO({
      [appPath]: `import { Dialog } from '@radix-ui/react-dialog';

export function App() {
  return <Dialog>hi</Dialog>;
}
`,
    });
    const service = new AstService('/workspace', fileIO);
    await service.ensureInitialized();

    const entries = service.nodeMapService.getNodeMap(appPath);
    const dialog = entries?.find((entry) => entry.componentName === 'Dialog' || entry.tag === 'Dialog');
    if (!dialog) throw new Error('Expected a Dialog entry');

    const result = await service.getMasterComponentLocation('src/App.tsx', dialog.nodeRef, dialog.nodeRef);
    expect(result.kind).toBe('external');
    if (result.kind !== 'external') throw new Error('expected external');
    expect(result.packageName).toBe('@radix-ui/react-dialog');
  });

  // Regression: tsconfig path aliases (`@/...`) must resolve from the NEAREST
  // tsconfig, including a monorepo subproject — not only the workspace root.
  describe('tsconfig path-alias resolution (filesystem)', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hyp563-'));
    afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

    it('resolves an @/ alias declared in a subproject tsconfig', async () => {
      // Layout: <root>/targets/app/{tsconfig.json, src/App.tsx, src/components/Hero.tsx}
      const sub = path.join(tmpRoot, 'targets', 'app');
      const srcDir = path.join(sub, 'src');
      const compDir = path.join(srcDir, 'components');
      fs.mkdirSync(compDir, { recursive: true });
      fs.writeFileSync(
        path.join(sub, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }),
      );
      fs.writeFileSync(
        path.join(srcDir, 'App.tsx'),
        "import { Hero } from '@/components/Hero';\n\nexport function App() {\n  return <Hero />;\n}\n",
      );
      fs.writeFileSync(path.join(compDir, 'Hero.tsx'), 'export function Hero() {\n  return <section />;\n}\n');

      const service = new AstService(tmpRoot, new NodeFileIO());
      await service.ensureInitialized();

      const appPath = path.join(srcDir, 'App.tsx');
      // App.tsx lives under a non-default scan path; register it directly so the
      // node map can resolve the selected <Hero> element. (This test targets alias
      // resolution, not node-map auto-discovery.)
      service.nodeMapService.parseAndBuild(fs.readFileSync(appPath, 'utf8'), appPath);
      const entries = service.nodeMapService.getNodeMap(appPath);
      const hero = entries?.find((e) => e.componentName === 'Hero' || e.tag === 'Hero');
      if (!hero) throw new Error('Expected a Hero entry');

      const result = await service.getMasterComponentLocation(appPath, hero.nodeRef, hero.nodeRef);
      expect(result.kind).toBe('local');
      if (result.kind !== 'local') throw new Error('expected local');
      expect(result.filePath).toBe(path.join(compDir, 'Hero.tsx'));
    });
  });
});
