import { describe, expect, it } from 'bun:test';
import type { FileIO } from '../../ast/file-io';
import { PREVIEW_GENERATOR_SCHEMA_MARKER } from '../generator';
import {
  isValidTypeScript,
  PreviewFileManager,
  PreviewGenerationError,
  parseExistingPreview,
} from '../preview-file-manager';

/** In-memory FileIO for testing without disk */
class InMemoryFileIO implements FileIO {
  files = new Map<string, string>();
  mkdirCalls: string[] = [];

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async access(path: string): Promise<void> {
    // Check for directory access — for dirs we check if any file starts with path
    const isDir = [...this.files.keys()].some((k) => k.startsWith(`${path}/`));
    if (!isDir && !this.files.has(path)) {
      throw new Error(`ENOENT: ${path}`);
    }
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }

  async listFiles(dirPath: string, extensions?: string[]): Promise<string[]> {
    const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
    return [...this.files.keys()].filter((k) => {
      if (!k.startsWith(prefix)) return false;
      if (!extensions) return true;
      return extensions.some((ext) => k.endsWith(ext));
    });
  }

  async mkdir(dirPath: string): Promise<void> {
    this.mkdirCalls.push(dirPath);
  }
}

function createManager(io: InMemoryFileIO, isNextPagesRouter = false) {
  return new PreviewFileManager({
    projectRoot: '/project',
    io,
    isNextPagesRouter,
  });
}

const BUTTON_SOURCE = `
import React from 'react';

export function Button({ children }: { children: React.ReactNode }) {
  return <button>{children}</button>;
}

export const SampleDefault = () => <Button>Click me</Button>;
export const SamplePrimary = () => <Button>Primary</Button>;
`;

const CARD_SOURCE = `
import React from 'react';

export default function Card({ title }: { title: string }) {
  return <div>{title}</div>;
}

export const SampleDefault = () => <Card title="Test" />;
`;

// Alert-style: optional props, no SampleDefault initially (container that renders empty without children)
const ALERT_NO_SAMPLE_SOURCE = `
import React from 'react';

export function Alert({ className, variant }: { className?: string; variant?: string }) {
  return <div className={className}>{variant}</div>;
}
`;

const ALERT_WITH_SAMPLE_SOURCE = `
import React from 'react';

export function Alert({ className, variant }: { className?: string; variant?: string }) {
  return <div className={className}>{variant}</div>;
}

export const SampleDefault = () => (
  <Alert variant="default">
    <div>This is an alert</div>
  </Alert>
);
`;

describe('PreviewFileManager', () => {
  describe('getPreviewFilePath', () => {
    it('should use apps/next/ for monorepo projects', async () => {
      const io = new InMemoryFileIO();
      io.files.set('/project/apps/next/package.json', '{}');
      const manager = createManager(io);

      const path = await manager.getPreviewFilePath();
      expect(path).toBe('/project/apps/next/__canvas_preview__.tsx');
    });

    it('should use src/ for standard projects', async () => {
      const io = new InMemoryFileIO();
      const manager = createManager(io);

      const path = await manager.getPreviewFilePath();
      expect(path).toBe('/project/src/__canvas_preview__.tsx');
    });

    it('should use client/ when index.html has <script type="module" src="/client/main.tsx">', async () => {
      const io = new InMemoryFileIO();
      io.files.set(
        '/project/index.html',
        `<!DOCTYPE html>
    <html>
      <body>
        <div id="root"></div>
        <script type="module" src="/client/main.tsx"></script>
      </body>
    </html>`,
      );
      const manager = createManager(io);
      const path = await manager.getPreviewFilePath();
      expect(path).toBe('/project/client/__canvas_preview__.tsx');
    });

    it('should prefer client/ from index.html even when src/ directory exists (bulka-the-dog pattern)', async () => {
      // Projects like bulka-the-dog have a src/ dir at root (server code etc.)
      // but the frontend entry is client/main.tsx — index.html must win over src/ presence.
      const io = new InMemoryFileIO();
      io.files.set('/project/src/server.ts', 'export {}'); // src/ exists but is NOT the frontend
      io.files.set(
        '/project/index.html',
        `<!DOCTYPE html><html><body><script type="module" src="/client/main.tsx"></script></body></html>`,
      );
      const manager = createManager(io);
      const path = await manager.getPreviewFilePath();
      expect(path).toBe('/project/client/__canvas_preview__.tsx');
    });

    it('should use src/ when no index.html exists', async () => {
      const io = new InMemoryFileIO();
      io.files.set('/project/src/main.tsx', 'export {}');
      const manager = createManager(io);
      const path = await manager.getPreviewFilePath();
      expect(path).toBe('/project/src/__canvas_preview__.tsx');
    });

    it('should use app/ when index.html has <script type="module" src="/app/main.tsx">', async () => {
      const io = new InMemoryFileIO();
      io.files.set(
        '/project/index.html',
        `<!DOCTYPE html><html><body><script type="module" src="/app/main.tsx"></script></body></html>`,
      );
      const manager = createManager(io);
      const path = await manager.getPreviewFilePath();
      expect(path).toBe('/project/app/__canvas_preview__.tsx');
    });

    it('should use client/ when the entry filename is not "main" (HyperIDE dogfood: /client/App.tsx)', async () => {
      // HyperIDE's own repo bootstraps the SPA from /client/App.tsx, not /client/main.tsx.
      // The registry must land next to that entry so the patched entry's
      // import('./__canvas_preview__') resolves; otherwise it splits to src/ and the
      // preview imports a stale/missing registry (blank preview).
      const io = new InMemoryFileIO();
      io.files.set(
        '/project/index.html',
        `<!doctype html><html><body><div id="root"></div><script type="module" src="/client/App.tsx"></script></body></html>`,
      );
      const manager = createManager(io);
      const path = await manager.getPreviewFilePath();
      expect(path).toBe('/project/client/__canvas_preview__.tsx');
    });
  });

  describe('ensureComponent', () => {
    it('should create new preview file with component', async () => {
      const io = new InMemoryFileIO();
      io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
      const manager = createManager(io);

      const content = await manager.ensureComponent(['src/components/Button.tsx']);

      expect(content).toContain('Button');
      expect(content).toContain('SampleDefault as ButtonSampleDefault');
      expect(content).toContain('SamplePrimary as ButtonSamplePrimary');
      expect(content).toContain('componentRegistry');
      expect(content).toContain('sampleRenderMap');
      expect(content).toContain('sampleRenderersMap');

      // Should have written the file
      const written = io.files.get('/project/src/__canvas_preview__.tsx');
      expect(written).toBe(content);
    });

    it('should skip write if component is already registered', async () => {
      const io = new InMemoryFileIO();
      io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
      const manager = createManager(io);

      const content1 = await manager.ensureComponent(['src/components/Button.tsx']);
      const content2 = await manager.ensureComponent(['src/components/Button.tsx']);

      // Should return same content (early return path)
      expect(content2).toBe(content1);
    });

    it('should add new component to existing preview', async () => {
      const io = new InMemoryFileIO();
      io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
      io.files.set('/project/src/components/Card.tsx', CARD_SOURCE);
      const manager = createManager(io);

      await manager.ensureComponent(['src/components/Button.tsx']);
      const content = await manager.ensureComponent(['src/components/Button.tsx', 'src/components/Card.tsx']);

      expect(content).toContain('Button');
      expect(content).toContain('Card');
    });

    it('should skip unreadable component files silently', async () => {
      const io = new InMemoryFileIO();
      // Button exists, Card does NOT exist on disk
      io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
      const manager = createManager(io);

      const content = await manager.ensureComponent(['src/components/Button.tsx', 'src/components/Missing.tsx']);

      expect(content).toContain('Button');
      // Path must not appear in the component registry
      expect(content).not.toContain("'src/components/Missing.tsx'");
    });

    it('should skip PascalCase files without a matching runtime export', async () => {
      const io = new InMemoryFileIO();
      io.files.set('/project/src/App.tsx', 'export default function App() { return <div />; }');
      io.files.set('/project/src/Layout.tsx', 'export const layoutTokens = { gap: 8 };');
      const manager = createManager(io);

      const content = await manager.ensureComponent(['src/App.tsx']);

      expect(content).toContain("import App from './App';");
      expect(content).not.toContain("import { Layout } from './Layout';");
      expect(content).not.toContain("'src/Layout.tsx'");
    });

    it('should throw PreviewGenerationError when no valid components', async () => {
      const io = new InMemoryFileIO();
      const manager = createManager(io);

      await expect(manager.ensureComponent(['src/components/NoExist.tsx'])).rejects.toThrow(PreviewGenerationError);
    });

    // HYP-680: a page-only project (just a page like src/App.tsx, no src/components/)
    // must produce a valid, renderable preview entry for the page.
    it('renders a page-only project (App.tsx with no components dir)', async () => {
      const io = new InMemoryFileIO();
      io.files.set(
        '/project/src/App.tsx',
        `import React from 'react';
export default function App() {
  return <h1>Hello from the page</h1>;
}
`,
      );
      const manager = createManager(io);

      const content = await manager.ensureComponent(['src/App.tsx']);

      // The page is registered and renderable
      expect(content).toContain("import App from './App';");
      expect(content).toContain("'src/App.tsx': toPreviewComponent(App)");
      // And the generated preview is valid TypeScript (would have thrown otherwise)
      expect(await isValidTypeScript(content)).toBe(true);
    });

    it('should use scoped package name from package.json for monorepo imports', async () => {
      const io = new InMemoryFileIO();
      io.files.set('/project/packages/ui/package.json', '{"name": "@acme/ui"}');
      io.files.set(
        '/project/packages/ui/src/Button.tsx',
        `export function Button() { return <button/> }\nexport const SampleDefault = () => <Button />;\n`,
      );
      const manager = createManager(io);

      const content = await manager.ensureComponent(['packages/ui/src/Button.tsx']);

      expect(content).toContain("from '@acme/ui/Button'");
    });

    it('should fall back to directory name when package.json is unreadable', async () => {
      const io = new InMemoryFileIO();
      // No package.json — directory name fallback
      io.files.set(
        '/project/packages/ui/src/Button.tsx',
        `export function Button() { return <button/> }\nexport const SampleDefault = () => <Button />;\n`,
      );
      const manager = createManager(io);

      const content = await manager.ensureComponent(['packages/ui/src/Button.tsx']);

      expect(content).toContain("from 'ui/Button'");
    });
  });

  describe('rebuild', () => {
    it('should regenerate from scratch ignoring existing file', async () => {
      const io = new InMemoryFileIO();
      io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
      io.files.set('/project/src/__canvas_preview__.tsx', '// old content that should be replaced');
      const manager = createManager(io);

      const content = await manager.rebuild(['src/components/Button.tsx']);

      expect(content).toContain('Button');
      expect(content).not.toContain('old content');
    });
  });

  describe('forceRefreshComponent', () => {
    it('updates sampleRenderMap when SampleDefault is added to an already-registered component', async () => {
      const io = new InMemoryFileIO();
      io.files.set('/project/src/components/Alert.tsx', ALERT_NO_SAMPLE_SOURCE);
      const manager = createManager(io);

      // Register Alert without SampleDefault
      const beforeContent = await manager.ensureComponent(['src/components/Alert.tsx']);
      expect(beforeContent).not.toContain('AlertSampleDefault');

      // ensureComponent detects sample export mismatch via hasSampleExportMismatch — picks up new SampleDefault
      io.files.set('/project/src/components/Alert.tsx', ALERT_WITH_SAMPLE_SOURCE);
      const updatedContent = await manager.ensureComponent(['src/components/Alert.tsx']);
      expect(updatedContent).toContain('AlertSampleDefault');

      // forceRefreshComponent also forces full regen — confirms same result via the explicit path
      const refreshedContent = await manager.forceRefreshComponent('src/components/Alert.tsx');
      expect(refreshedContent).toContain('AlertSampleDefault');
      expect(refreshedContent).toContain("'src/components/Alert.tsx': AlertSampleDefault");
    });

    it('preserves other registered components when force-refreshing one', async () => {
      const io = new InMemoryFileIO();
      io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
      io.files.set('/project/src/components/Alert.tsx', ALERT_NO_SAMPLE_SOURCE);
      const manager = createManager(io);

      await manager.ensureComponent(['src/components/Button.tsx', 'src/components/Alert.tsx']);

      // Add SampleDefault to Alert and force-refresh
      io.files.set('/project/src/components/Alert.tsx', ALERT_WITH_SAMPLE_SOURCE);
      const refreshedContent = await manager.forceRefreshComponent('src/components/Alert.tsx');

      // Both components still present
      expect(refreshedContent).toContain('Button');
      expect(refreshedContent).toContain('Alert');
      // Alert now has SampleDefault in sampleRenderMap
      expect(refreshedContent).toContain('AlertSampleDefault');
      // Button's samples still intact
      expect(refreshedContent).toContain('ButtonSampleDefault');
    });

    it('creates preview file from scratch when none exists', async () => {
      const io = new InMemoryFileIO();
      io.files.set('/project/src/components/Alert.tsx', ALERT_WITH_SAMPLE_SOURCE);
      const manager = createManager(io);

      const content = await manager.forceRefreshComponent('src/components/Alert.tsx');

      expect(content).toContain('Alert');
      expect(content).toContain('AlertSampleDefault');
    });
  });

  // Regression: a stale `SampleDefault` import for a component OTHER than the one
  // currently requested must still force a regen on the fast path. e2e #82 —
  // tamagui-food-delivery: the harness reverts a screen's source via `git checkout`
  // (dropping a transiently-added `SampleDefault`), but the gitignored
  // `__canvas_preview__.tsx` is NOT reverted and keeps `import { …, SampleDefault as
  // …SampleDefault }`. A later test selects a DIFFERENT component (App.web.tsx); the
  // fast path only checked the requested component's samples, so the dangling import
  // survived and Vite threw `does not provide an export named 'SampleDefault'` in the
  // iframe — a blank, cross-origin (empty) pageerror / 320s rootChildren:0 wedge.
  describe('fast-path stale-sample detection across registered components (#82)', () => {
    const BUTTON_WITH_SAMPLE = BUTTON_SOURCE;
    const BUTTON_NO_SAMPLE = `
import React from 'react';

export function Button({ children }: { children: React.ReactNode }) {
  return <button>{children}</button>;
}
`;

    it('regenerates when another registered component lost its SampleDefault (source reverted)', async () => {
      const io = new InMemoryFileIO();
      io.files.set('/project/src/components/Button.tsx', BUTTON_WITH_SAMPLE);
      io.files.set('/project/src/components/Alert.tsx', ALERT_NO_SAMPLE_SOURCE);
      const manager = createManager(io);

      // Register both — Button captures `SampleDefault`/`SamplePrimary`.
      const initial = await manager.ensureComponent(['src/components/Button.tsx', 'src/components/Alert.tsx']);
      expect(initial).toContain('SampleDefault as ButtonSampleDefault');

      // Button's source is reverted (the `SampleDefault` export is gone) — but the
      // generated preview file still imports it. Now a DIFFERENT component is
      // selected; the fast path must notice the stale Button sample and regenerate.
      io.files.set('/project/src/components/Button.tsx', BUTTON_NO_SAMPLE);
      const afterRevert = await manager.ensureComponent(['src/components/Alert.tsx']);

      // The dangling `SampleDefault as ButtonSampleDefault` import must be gone —
      // otherwise Vite throws "does not provide an export named 'SampleDefault'".
      expect(afterRevert).not.toContain('ButtonSampleDefault');
      // Both components remain registered as real entries (assert the registry rows,
      // not a loose substring) and the preview stays valid TypeScript.
      expect(afterRevert).toContain("'src/components/Button.tsx': toPreviewComponent(Button)");
      expect(afterRevert).toContain("'src/components/Alert.tsx': toPreviewComponent(Alert)");
      expect(await isValidTypeScript(afterRevert)).toBe(true);
    });

    it('does not reject or regen an unrelated selection when another registered component is mid-edit/broken', async () => {
      const io = new InMemoryFileIO();
      io.files.set('/project/src/components/Button.tsx', BUTTON_WITH_SAMPLE);
      io.files.set('/project/src/components/Alert.tsx', ALERT_NO_SAMPLE_SOURCE);
      const manager = createManager(io);

      const before = await manager.ensureComponent(['src/components/Button.tsx', 'src/components/Alert.tsx']);

      // Button is mid-edit — `scanSampleExports` THROWS on this (babel raises despite
      // errorRecovery for a hard syntax error). Selecting the UNRELATED, valid Alert must
      // neither throw nor regen: the scan catches Button's parse error and skips it, so the
      // fast path returns the EXISTING preview byte-for-byte (proving skip, not regen — a
      // regen here would re-read Button and could drop a still-valid entry mid-keystroke).
      io.files.set('/project/src/components/Button.tsx', 'export function Button( {{{ broken');
      const result = await manager.ensureComponent(['src/components/Alert.tsx']);

      expect(result).toBe(before);
    });

    it('rejects a crafted `..` preview entry without reading outside the project root, then converges', async () => {
      const io = new InMemoryFileIO();
      io.files.set('/project/src/components/Alert.tsx', ALERT_NO_SAMPLE_SOURCE);
      const manager = createManager(io);
      await manager.ensureComponent(['src/components/Alert.tsx']);

      // Splice a malicious SAMPLE-BEARING entry whose path escapes the project root into the
      // persisted (gitignored) preview file. It must carry a sample (wired through
      // sampleRenderMap) so parseExistingPreview reports sampleExports > 0 — only then does the
      // staleness scan even visit it, which is exactly the case the `..` traversal guard
      // defends: the scan must NOT read the escaping source and must force a regen that drops
      // the entry — and the regen must converge.
      const poisoned = io.files
        .get('/project/src/__canvas_preview__.tsx')!
        .replace(
          "import { Alert } from './components/Alert';",
          "import { Alert } from './components/Alert';\nimport { Evil, SampleDefault as EvilSampleDefault } from '../../../etc/passwd';",
        )
        .replace(
          "'src/components/Alert.tsx': toPreviewComponent(Alert),",
          "'src/components/Alert.tsx': toPreviewComponent(Alert),\n  '../../../etc/passwd.tsx': toPreviewComponent(Evil),",
        )
        .replace(
          'const sampleRenderMap: Record<string, React.FC> = {\n',
          "const sampleRenderMap: Record<string, React.FC> = {\n  '../../../etc/passwd.tsx': EvilSampleDefault,\n",
        );
      io.files.set('/project/src/__canvas_preview__.tsx', poisoned);
      // /etc/passwd must NEVER be read — assert by absence from the IO's touched set is not
      // available, so rely on the regen dropping the traversal entry instead.
      const first = await manager.ensureComponent(['src/components/Alert.tsx']);
      expect(first).not.toContain('EvilSampleDefault');
      expect(first).not.toContain('etc/passwd');

      const second = await manager.ensureComponent(['src/components/Alert.tsx']);
      expect(second).toBe(first);
    });

    it('converges (no regen loop) when a registered sample-bearing component is deleted', async () => {
      const io = new InMemoryFileIO();
      io.files.set('/project/src/components/Button.tsx', BUTTON_WITH_SAMPLE);
      io.files.set('/project/src/components/Alert.tsx', ALERT_NO_SAMPLE_SOURCE);
      const manager = createManager(io);

      await manager.ensureComponent(['src/components/Button.tsx', 'src/components/Alert.tsx']);

      // Button's source file is deleted but its sample import lingers in the preview.
      // First selection of the unrelated Alert must regen (dropping the dead Button entry);
      // the second must be a no-op fast path — proving it converges, not loops.
      await io.deleteFile('/project/src/components/Button.tsx');
      const first = await manager.ensureComponent(['src/components/Alert.tsx']);
      expect(first).not.toContain('ButtonSampleDefault');
      expect(first).not.toContain("'src/components/Button.tsx'");

      const second = await manager.ensureComponent(['src/components/Alert.tsx']);
      expect(second).toBe(first);
    });
  });
});

describe('parseExistingPreview', () => {
  it('should extract entries from generated preview content', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    const manager = createManager(io);

    const content = await manager.ensureComponent(['src/components/Button.tsx']);
    const entries = parseExistingPreview(content);

    expect(entries.length).toBe(1);
    expect(entries[0].componentPath).toBe('src/components/Button.tsx');
    expect(entries[0].componentName).toBe('Button');
    expect(entries[0].sampleExports).toContain('SampleDefault');
    expect(entries[0].sampleExports).toContain('SamplePrimary');
  });

  it('should return empty array for non-preview content', () => {
    const entries = parseExistingPreview('const x = 1;');
    expect(entries).toEqual([]);
  });

  it('should round-trip multiple components including default exports', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    io.files.set('/project/src/components/Card.tsx', CARD_SOURCE);
    const manager = createManager(io);

    const content = await manager.ensureComponent(['src/components/Button.tsx', 'src/components/Card.tsx']);
    const entries = parseExistingPreview(content);

    expect(entries.length).toBe(2);
    const button = entries.find((e) => e.componentName === 'Button');
    const card = entries.find((e) => e.componentName === 'Card');

    expect(button).toBeDefined();
    expect(button?.sampleExports).toContain('SampleDefault');
    expect(button?.sampleExports).toContain('SamplePrimary');

    expect(card).toBeDefined();
    expect(card?.sampleExports).toContain('SampleDefault');
    // Card has default export — parser should detect this
    expect(card?.exportStyle).toBe('default-named');
  });

  it('should not confuse Card and CardGrid imports (substring collision)', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/components/Card.tsx',
      `export function Card() { return <div/> }\nexport const SampleDefault = () => <Card />;\n`,
    );
    io.files.set(
      '/project/src/components/CardGrid.tsx',
      `export function CardGrid() { return <div/> }\nexport const SampleDefault = () => <CardGrid />;\n`,
    );
    const manager = createManager(io);

    // Generate with CardGrid first, then Card — this order triggers the old substring bug
    await manager.ensureComponent(['src/components/CardGrid.tsx', 'src/components/Card.tsx']);

    // Re-add Badge to force re-generation from parsed entries
    io.files.set(
      '/project/src/components/Badge.tsx',
      `export function Badge() { return <div/> }\nexport const SampleDefault = () => <Badge />;\n`,
    );
    const content = await manager.ensureComponent([
      'src/components/CardGrid.tsx',
      'src/components/Card.tsx',
      'src/components/Badge.tsx',
    ]);

    // Card must import from Card, not CardGrid
    expect(content).toContain("from './components/Card';");
    expect(content).toContain("from './components/CardGrid';");
    // Verify no Card imported from CardGrid path
    const cardImport = content.split('\n').find((l: string) => l.includes('{ Card,') || l.includes('{ Card }'));
    expect(cardImport).toContain("'./components/Card'");
    expect(cardImport).not.toContain('CardGrid');
  });

  it('should parse entries from manually written preview with package imports', () => {
    const manualPreview = `import React from 'react';
import { Button, SampleDefault as ButtonSampleDefault } from '@acme/ui/Button';

const componentRegistry: Record<string, React.ComponentType<any>> = {
  'packages/ui/src/Button.tsx': Button,
};

const sampleRenderMap: Record<string, React.FC> = {
  'packages/ui/src/Button.tsx': ButtonSampleDefault,
};

const sampleRenderersMap: Record<string, Record<string, React.FC>> = {
  'packages/ui/src/Button.tsx': {
    'default': ButtonSampleDefault,
  },
};
`;
    const entries = parseExistingPreview(manualPreview);
    expect(entries.length).toBe(1);
    expect(entries[0].componentPath).toBe('packages/ui/src/Button.tsx');
    expect(entries[0].componentName).toBe('Button');
    expect(entries[0].importPath).toBe('@acme/ui/Button');
    expect(entries[0].sampleExports).toContain('SampleDefault');
  });

  it('parses componentRegistry entries wrapped in toPreviewComponent()', () => {
    const manualPreview = `import React from 'react';
import Tweet from './components/Tweet';

type PreviewComponent = React.ComponentType<Record<string, unknown>>;

function toPreviewComponent<P>(component: React.ComponentType<P>): PreviewComponent {
  return component as unknown as PreviewComponent;
}

const componentRegistry: Record<string, PreviewComponent> = {
  'src/components/Tweet.tsx': toPreviewComponent(Tweet),
};
`;
    const entries = parseExistingPreview(manualPreview);

    expect(entries.length).toBe(1);
    expect(entries[0].componentPath).toBe('src/components/Tweet.tsx');
    expect(entries[0].componentName).toBe('Tweet');
    expect(entries[0].importPath).toBe('./components/Tweet');
  });

  it('should parse server-generated preview with SampleDefaultMap and no componentRegistry', () => {
    const serverPreview = `import React from 'react';
import { SampleDefault as WeatherDashboardSampleRender } from './examples/WeatherDashboard';
import { SampleDefault as FileExplorerSampleRender } from './examples/FileExplorer';
import { SampleDefault as ButtonSampleRender } from './components/Button';

const SampleDefaultMap: Record<string, React.FC> = {
  'src/examples/WeatherDashboard.tsx': WeatherDashboardSampleRender,
  'src/examples/FileExplorer.tsx': FileExplorerSampleRender,
  'src/components/Button.tsx': ButtonSampleRender,
};

const sampleRenderersMap: Record<string, Record<string, () => React.ReactNode>> = {
  'src/components/Button.tsx': {},
};

export default function CanvasPreview() {
  return <div />;
}
`;
    const entries = parseExistingPreview(serverPreview);

    expect(entries.length).toBe(3);

    const weather = entries.find((e) => e.componentName === 'WeatherDashboard');
    expect(weather).toBeDefined();
    expect(weather?.componentPath).toBe('src/examples/WeatherDashboard.tsx');
    expect(weather?.importPath).toBe('./examples/WeatherDashboard');
    expect(weather?.sampleExports).toContain('SampleDefault');

    const explorer = entries.find((e) => e.componentName === 'FileExplorer');
    expect(explorer).toBeDefined();
    expect(explorer?.importPath).toBe('./examples/FileExplorer');

    const button = entries.find((e) => e.componentName === 'Button');
    expect(button).toBeDefined();
    expect(button?.importPath).toBe('./components/Button');
  });

  it('should parse trailing-comma-less last entry in maps', () => {
    const noTrailingComma = `import React from 'react';
import { Card } from './components/Card';
import { Button } from './components/Button';

const componentRegistry: Record<string, React.ComponentType<any>> = {
  'src/components/Card.tsx': Card,
  'src/components/Button.tsx': Button
};
`;
    const entries = parseExistingPreview(noTrailingComma);

    expect(entries.length).toBe(2);
    expect(entries.find((e) => e.componentName === 'Button')).toBeDefined();
    expect(entries.find((e) => e.componentName === 'Card')).toBeDefined();
  });

  it('should merge componentRegistry with SampleDefaultMap-only entries', () => {
    const mixedPreview = `import React from 'react';
import { Button, SampleDefault as ButtonSampleDefault } from './components/Button';
import { SampleDefault as CardSampleRender } from './components/Card';

const componentRegistry: Record<string, React.ComponentType<any>> = {
  'src/components/Button.tsx': Button,
};

const SampleDefaultMap: Record<string, React.FC> = {
  'src/components/Button.tsx': ButtonSampleDefault,
  'src/components/Card.tsx': CardSampleRender,
};

const sampleRenderersMap: Record<string, Record<string, React.FC>> = {
  'src/components/Button.tsx': {
    'default': ButtonSampleDefault,
  },
};
`;
    const entries = parseExistingPreview(mixedPreview);

    expect(entries.length).toBe(2);

    const button = entries.find((e) => e.componentName === 'Button');
    expect(button).toBeDefined();
    expect(button?.importPath).toBe('./components/Button');
    expect(button?.sampleExports).toContain('SampleDefault');

    // Card comes from SampleDefaultMap only — should still be found
    const card = entries.find((e) => e.componentName === 'Card');
    expect(card).toBeDefined();
    expect(card?.componentPath).toBe('src/components/Card.tsx');
    expect(card?.importPath).toBe('./components/Card');
    expect(card?.sampleExports).toContain('SampleDefault');
  });

  // --- Edge cases for extractSection / parseExistingPreview ---

  it('should not corrupt entries when comment contains unbalanced brace', () => {
    // Unbalanced { in comment breaks brace-counting in extractSection —
    // the section overshoots into the next map, polluting pathToName
    const preview = `import React from 'react';
import { Button, SampleDefault as ButtonSampleDefault } from './components/Button';
import { Card, SampleDefault as CardSampleDefault } from './components/Card';

const componentRegistry: Record<string, React.ComponentType<any>> = {
  'src/components/Button.tsx': Button, // handles { edge
  'src/components/Card.tsx': Card,
};

const sampleRenderMap: Record<string, React.FC> = {
  'src/components/Button.tsx': ButtonSampleDefault,
  'src/components/Card.tsx': CardSampleDefault,
};

const sampleRenderersMap: Record<string, Record<string, React.FC>> = {
  'src/components/Button.tsx': {
    'default': ButtonSampleDefault,
  },
  'src/components/Card.tsx': {
    'default': CardSampleDefault,
  },
};
`;
    const entries = parseExistingPreview(preview);

    expect(entries.length).toBe(2);
    const button = entries.find((e) => e.componentPath === 'src/components/Button.tsx');
    // componentName must be 'Button', not 'ButtonSampleDefault' (from sampleRenderMap leak)
    expect(button?.componentName).toBe('Button');
    const card = entries.find((e) => e.componentPath === 'src/components/Card.tsx');
    expect(card?.componentName).toBe('Card');
  });

  it('should extract sampleRenderersMap when type annotation contains arrow =>', () => {
    // extractSection regex [^=]* stops at = from () => in the type annotation,
    // causing the entire sampleRenderersMap section to be missed
    const preview = `import React from 'react';
import { Button, SampleDefault as ButtonSampleDefault, SamplePrimary as ButtonSamplePrimary } from './components/Button';

const componentRegistry: Record<string, React.ComponentType<any>> = {
  'src/components/Button.tsx': Button,
};

const sampleRenderersMap: Record<string, Record<string, () => React.ReactNode>> = {
  'src/components/Button.tsx': {
    'default': ButtonSampleDefault,
    'primary': ButtonSamplePrimary,
  },
};
`;
    const entries = parseExistingPreview(preview);
    const button = entries.find((e) => e.componentName === 'Button');

    expect(button).toBeDefined();
    expect(button?.sampleExports).toContain('SampleDefault');
    expect(button?.sampleExports).toContain('SamplePrimary');
  });

  it('should derive correct component name for .jsx files from SampleDefaultMap', () => {
    // When .jsx component is only in SampleDefaultMap (no componentRegistry),
    // basename fallback must strip .jsx, not just .tsx
    const preview = `import React from 'react';
import { SampleDefault as ButtonSampleRender } from './components/Button';

const SampleDefaultMap: Record<string, React.FC> = {
  'src/components/Button.jsx': ButtonSampleRender,
};
`;
    const entries = parseExistingPreview(preview);
    expect(entries.length).toBe(1);
    expect(entries[0].componentName).toBe('Button');
  });

  it('should not match entries from comments inside maps', () => {
    const preview = `import React from 'react';
import { Button } from './components/Button';

const componentRegistry: Record<string, React.ComponentType<any>> = {
  // 'src/components/OldButton.tsx': OldButton,
  'src/components/Button.tsx': Button,
};

const sampleRenderersMap: Record<string, Record<string, React.FC>> = {
  'src/components/Button.tsx': {},
};
`;
    const entries = parseExistingPreview(preview);

    expect(entries.length).toBe(1);
    expect(entries[0].componentName).toBe('Button');
    // OldButton from the comment must NOT appear
    expect(entries.find((e) => e.componentName === 'OldButton')).toBeUndefined();
  });

  it('should preserve SampleDefault when sampleRenderersMap entry is empty but sampleRenderMap has renderer', () => {
    const preview = `import React from 'react';
import { Button, SampleDefault as ButtonSampleDefault } from './components/Button';

const componentRegistry: Record<string, React.ComponentType<any>> = {
  'src/components/Button.tsx': Button,
};

const sampleRenderMap: Record<string, React.FC> = {
  'src/components/Button.tsx': ButtonSampleDefault,
};

const sampleRenderersMap: Record<string, Record<string, React.FC>> = {
  'src/components/Button.tsx': {},
};
`;
    const entries = parseExistingPreview(preview);
    expect(entries.length).toBe(1);
    expect(entries[0].sampleExports).toContain('SampleDefault');
  });
});

describe('PreviewFileManager — path traversal guard', () => {
  it('skips traversal paths and uses project scan to find real components', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    // This path tries to escape projectRoot
    io.files.set('/etc/passwd', 'root:x:0:0:root');
    const manager = createManager(io);

    // Traversal path is skipped; _scanAllComponents discovers Button.tsx instead
    const content = await manager.ensureComponent(['../../../etc/passwd']);
    expect(content).toContain('Button');
    expect(content).not.toContain('passwd');
  });

  it('should skip traversal path but include valid components', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    const manager = createManager(io);

    const content = await manager.ensureComponent(['../../etc/passwd', 'src/components/Button.tsx']);
    expect(content).toContain('Button');
    expect(content).not.toContain('passwd');
  });

  it('should reject packages with ".." directory in monorepo path', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/secret/package.json', '{"name": "leaked"}');
    io.files.set('/project/packages/../secret/src/Evil.tsx', 'export function Evil() { return <div/> }');
    const manager = createManager(io);

    await expect(manager.ensureComponent(['packages/../secret/src/Evil.tsx'])).rejects.toThrow(PreviewGenerationError);
  });
});

describe('PreviewFileManager — cross-package library component (in-workspace ".." import, HYP-443)', () => {
  // A monorepo opened at /repo. The preview pipeline is re-rooted to the runnable
  // app target /repo/targets/web (projectRoot), but the selected component lives in
  // the shared library /repo/packages/ui/src/Button.tsx — OUTSIDE the target. Its
  // path relative to the target is `../../packages/ui/src/Button.tsx` (escapes the
  // target with `..`, but stays WITHIN the workspace root /repo). buildEntry must
  // allow it and emit a relative import that Vite can serve once fs.allow permits.
  function createMonorepoManager(io: InMemoryFileIO) {
    return new PreviewFileManager({
      projectRoot: '/repo/targets/web',
      workspaceRoot: '/repo',
      io,
    });
  }

  it('renders a library component reached via in-workspace ".." path', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/repo/packages/ui/src/Button.tsx', BUTTON_SOURCE);
    io.files.set('/repo/packages/ui/package.json', '{"name": "@conloca-mini/ui", "exports": {".": "./src/index.ts"}}');
    io.files.set('/repo/targets/web/package.json', '{"name": "@conloca-mini/web"}');
    io.files.set('/repo/targets/web/src/main.tsx', 'export {};');
    const manager = createMonorepoManager(io);

    const content = await manager.ensureComponent(['../../packages/ui/src/Button.tsx']);

    // The library component is registered, not skipped.
    expect(content).toContain('Button');
    // A relative import is used (sidesteps the package `exports` wall that blocks
    // a deep `@conloca-mini/ui/src/Button` import). Path is relative to the preview
    // file in /repo/targets/web/src/.
    expect(content).toContain('packages/ui/src/Button');
    expect(content).not.toContain('@conloca-mini/ui/src/Button');
    expect(isValidTypeScript(content)).toBe(true);
  });

  it('does not churn the fast path for a SAMPLE-BEARING in-workspace ".." entry (#82)', async () => {
    // Regression guard for the #82 staleness scan: it must reject only the `..` paths
    // buildEntry rejects, NOT a legitimate in-workspace cross-package entry. A
    // sample-bearing library component (BUTTON_SOURCE carries SampleDefault/SamplePrimary)
    // is registered via an in-workspace `..` path; re-selecting it must hit the fast path
    // as a no-op. A too-broad `includes('..')` guard would treat the entry as stale on
    // EVERY call → a forced regen. The regen is idempotent on OUTPUT (buildEntry re-adds
    // the same entry), so byte-for-byte equality alone CANNOT catch it.
    //
    // Detect a wasted regen via a side channel: a NON-sample sibling's source is read by
    // `buildEntry` (regen only) — never by the staleness scan (which reads only
    // sample-bearing entries) nor by `_scanAllComponents` (listFiles, no content read). So
    // the sibling's read count on the second selection is 0 for a true no-op, ≥1 for a
    // forced regen.
    const SIBLING_PATH = '/repo/targets/web/src/Alert.tsx';
    let siblingReads = 0;
    const io = new (class extends InMemoryFileIO {
      async readFile(path: string): Promise<string> {
        if (path === SIBLING_PATH) siblingReads++;
        return super.readFile(path);
      }
    })();
    io.files.set('/repo/packages/ui/src/Button.tsx', BUTTON_SOURCE);
    io.files.set('/repo/packages/ui/package.json', '{"name": "@conloca-mini/ui", "exports": {".": "./src/index.ts"}}');
    io.files.set('/repo/targets/web/package.json', '{"name": "@conloca-mini/web"}');
    io.files.set(SIBLING_PATH, ALERT_NO_SAMPLE_SOURCE);
    const manager = createMonorepoManager(io);

    // Register both — Button (cross-package, sample-bearing) and the in-target Alert.
    const first = await manager.ensureComponent(['../../packages/ui/src/Button.tsx', 'src/Alert.tsx']);
    // The cross-package entry must actually be sample-bearing — otherwise it never enters
    // the staleness scan and this proof would be vacuous.
    expect(first).toContain('SampleDefault as ButtonSampleDefault');

    siblingReads = 0;
    const second = await manager.ensureComponent(['../../packages/ui/src/Button.tsx']);
    expect(second).toBe(first);
    // The sibling was NOT re-read → the fast path was a true no-op, not a forced regen.
    expect(siblingReads).toBe(0);
  });

  it('rejects a path that escapes the workspace root entirely (security)', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/repo/targets/web/package.json', '{"name": "@conloca-mini/web"}');
    io.files.set('/repo/targets/web/src/Button.tsx', BUTTON_SOURCE);
    // /etc/passwd is OUTSIDE the workspace root /repo — must never be readable.
    io.files.set('/etc/passwd', 'root:x:0:0:root');
    const manager = createMonorepoManager(io);

    // The escape path is skipped; the in-target Button is discovered instead.
    const content = await manager.ensureComponent(['../../../../etc/passwd', 'src/Button.tsx']);
    expect(content).not.toContain('passwd');
    expect(content).toContain('Button');
  });

  it('rejects a sibling-escape that leaves the workspace root (does not render it)', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/repo/targets/web/package.json', '{"name": "@conloca-mini/web"}');
    io.files.set('/repo/targets/web/src/Safe.tsx', BUTTON_SOURCE);
    // /other-repo is a sibling of /repo — escaping /repo must be rejected even
    // though it does not reach the filesystem root. The in-target Safe component
    // is rendered; the escaped Evil component must never appear.
    io.files.set('/other-repo/secret/Evil.tsx', 'export function Evil() { return <div/> }');
    const manager = createMonorepoManager(io);

    const content = await manager.ensureComponent(['../../../other-repo/secret/Evil.tsx', 'src/Safe.tsx']);
    expect(content).not.toContain('Evil');
    expect(content).toContain('Button');
  });

  it('rejects an internal ".." trick that normalizes back inside projectRoot, even in a monorepo', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/repo/targets/web/package.json', '{"name": "@conloca-mini/web"}');
    io.files.set('/repo/targets/web/src/Safe.tsx', BUTTON_SOURCE);
    // `src/../secret/Evil.tsx` normalizes to `/repo/targets/web/secret/Evil.tsx` —
    // INSIDE projectRoot. The guard must still reject it: a legitimate in-project
    // file never needs a `..` segment to be addressed, so any `..` that resolves
    // back inside projectRoot is a traversal trick. Keyed at the NORMALIZED path so
    // the rejection is the guard's doing, not a missing-file ENOENT.
    io.files.set('/repo/targets/web/secret/Evil.tsx', 'export function Evil() { return <div/> }');
    const manager = createMonorepoManager(io);

    const content = await manager.ensureComponent(['src/../secret/Evil.tsx', 'src/Safe.tsx']);
    expect(content).not.toContain('Evil');
    expect(content).toContain('Button');
  });

  it('rejects any ".." path in a single-package project (workspaceRoot === projectRoot)', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/package.json', '{"name": "solo"}');
    io.files.set('/project/src/Safe.tsx', BUTTON_SOURCE);
    // `src/../secret/Evil.tsx` normalizes to `/project/secret/Evil.tsx` (inside the
    // project). With no separate workspaceRoot, cross-package is impossible, so every
    // `..` path is rejected. Keyed at the normalized path so the guard, not ENOENT,
    // is what rejects it.
    io.files.set('/project/secret/Evil.tsx', 'export function Evil() { return <div/> }');
    // createManager uses projectRoot '/project' and no workspaceRoot → defaults equal.
    const manager = createManager(io);

    const content = await manager.ensureComponent(['src/../secret/Evil.tsx', 'src/Safe.tsx']);
    expect(content).not.toContain('Evil');
    expect(content).toContain('Button');
  });
});

describe('PreviewFileManager — buildEntry error handling', () => {
  it('should handle unparseable component source gracefully', async () => {
    const io = new InMemoryFileIO();
    // Broken JSX — Babel throws even with errorRecovery
    io.files.set('/project/src/components/Broken.tsx', 'export function Broken(){ return <div>');
    io.files.set(
      '/project/src/components/Button.tsx',
      `export function Button() { return <button/> }\nexport const SampleDefault = () => <Button />;\n`,
    );
    const manager = createManager(io);

    // Should not throw — Broken component is skipped until it parses again.
    const content = await manager.ensureComponent(['src/components/Broken.tsx', 'src/components/Button.tsx']);
    expect(content).toContain('Button');
    expect(content).not.toContain('Broken');
  });
});

describe('PreviewFileManager — buildEntry preview-ineligible suffix guard', () => {
  it('skips React Native platform-specific files (Foo.native.tsx) that would collide with Foo.tsx', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/components/RootProvider.tsx',
      `export function RootProvider({ children }: { children: React.ReactNode }) { return <>{children}</>; }`,
    );
    io.files.set(
      '/project/src/components/RootProvider.native.tsx',
      `export function RootProvider({ children }: { children: React.ReactNode }) { return <>{children}</>; }`,
    );
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    const content = await manager.ensureComponent([
      'src/components/RootProvider.tsx',
      'src/components/RootProvider.native.tsx',
    ]);
    // Web variant kept, .native dropped — no duplicate-import syntax error
    expect(content).toContain("from './components/RootProvider'");
    expect(content).not.toContain('RootProvider.native');
    expect(isValidTypeScript(content)).toBe(true);
  });

  it('skips iOS / Android RN variants in addition to .native', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Toolbar.tsx', `export function Toolbar() { return <div/>; }`);
    io.files.set('/project/src/components/Toolbar.ios.tsx', `export function Toolbar() { return <div/>; }`);
    io.files.set('/project/src/components/Toolbar.android.tsx', `export function Toolbar() { return <div/>; }`);
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    const content = await manager.ensureComponent([
      'src/components/Toolbar.tsx',
      'src/components/Toolbar.ios.tsx',
      'src/components/Toolbar.android.tsx',
    ]);
    expect(content).toContain("from './components/Toolbar'");
    expect(content).not.toContain('Toolbar.ios');
    expect(content).not.toContain('Toolbar.android');
    expect(isValidTypeScript(content)).toBe(true);
  });

  it('skips vanilla-extract Foo.css.ts style sheets that fall back to invalid identifier', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Navbar.tsx', `export function Navbar() { return <nav/>; }`);
    // Style sheet — exports `style()` calls, no PascalCase component
    io.files.set(
      '/project/src/components/Navbar.css.ts',
      `import { style } from '@vanilla-extract/css';\nexport const navbar = style({ display: 'flex' });`,
    );
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    const content = await manager.ensureComponent(['src/components/Navbar.tsx', 'src/components/Navbar.css.ts']);
    // Component import valid, style sheet skipped — no `Navbar.css` identifier leak
    expect(content).toContain("from './components/Navbar'");
    expect(content).not.toContain('Navbar.css');
    expect(isValidTypeScript(content)).toBe(true);
  });

  it('skips Foo.styles.ts and Foo.module.ts naming variants', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Card.tsx', `export function Card() { return <div/>; }`);
    io.files.set('/project/src/components/Card.styles.ts', `export const cardClass = 'card';`);
    io.files.set('/project/src/components/Card.module.ts', `export const cardMod = {};`);
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    const content = await manager.ensureComponent([
      'src/components/Card.tsx',
      'src/components/Card.styles.ts',
      'src/components/Card.module.ts',
    ]);
    expect(content).toContain("from './components/Card'");
    expect(content).not.toContain('Card.styles');
    expect(content).not.toContain('Card.module');
    expect(isValidTypeScript(content)).toBe(true);
  });

  it('strips platform/style suffix entries when migrating a stale preview file', async () => {
    // Stale preview with a stylesheet entry that previously slipped past detection.
    // Single import per identifier — still valid TS, but the stylesheet path leaks
    // into componentRegistry. Next ensure must clean it out.
    const stalePreview = `// ${PREVIEW_GENERATOR_SCHEMA_MARKER}
import React from 'react';
import { Navbar } from './components/Navbar';
import { navbarStyles as NavbarCssStyles } from './components/Navbar.css';
const componentRegistry = {
  'src/components/Navbar.tsx': Navbar,
  'src/components/Navbar.css.ts': NavbarCssStyles,
};
const sampleRenderMap = {};
const sampleRenderersMap = {};
export default function CanvasPreview() { return null; }
`;
    const io = new InMemoryFileIO();
    io.files.set('/project/src/__canvas_preview__.tsx', stalePreview);
    io.files.set('/project/src/components/Navbar.tsx', `export function Navbar() { return <nav/>; }`);
    io.files.set(
      '/project/src/components/Navbar.css.ts',
      `import { style } from '@vanilla-extract/css';\nexport const navbarStyles = style({});`,
    );
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    const content = await manager.ensureComponent(['src/components/Navbar.tsx']);
    expect(content).not.toContain('Navbar.css');
    expect(content).toContain("from './components/Navbar'");
    expect(isValidTypeScript(content)).toBe(true);
  });

  it('skips Storybook story files (Button.stories.tsx) even when they export PascalCase names', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Button.tsx', `export function Button() { return <button/>; }`);
    io.files.set(
      '/project/src/components/Button.stories.tsx',
      `import { Button } from './Button';\nexport const Primary = () => <Button/>;\nexport const Secondary = () => <Button/>;`,
    );
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    const content = await manager.ensureComponent(['src/components/Button.tsx', 'src/components/Button.stories.tsx']);
    expect(content).toContain("from './components/Button'");
    expect(content).not.toContain('Button.stories');
    expect(isValidTypeScript(content)).toBe(true);
  });

  it('skips test files (Button.test.tsx, Button.spec.tsx)', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Button.tsx', `export function Button() { return <button/>; }`);
    io.files.set(
      '/project/src/components/Button.test.tsx',
      `import { render } from '@testing-library/react';\nexport const TestSuite = () => null;`,
    );
    io.files.set('/project/src/components/Button.spec.tsx', `export const SpecCase = () => null;`);
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    const content = await manager.ensureComponent([
      'src/components/Button.tsx',
      'src/components/Button.test.tsx',
      'src/components/Button.spec.tsx',
    ]);
    expect(content).toContain("from './components/Button'");
    expect(content).not.toContain('Button.test');
    expect(content).not.toContain('Button.spec');
    expect(isValidTypeScript(content)).toBe(true);
  });

  it('keeps App.web.tsx (web entry) and assigns AppWeb alias to avoid collision with App.tsx', async () => {
    // .web suffix must NOT be treated as a platform-exclusion suffix (unlike .native/.ios/.android).
    // App.web.tsx is the web entry for Expo/Tamagui projects and must appear in componentRegistry.
    // deriveUniquePrefix should resolve the App/App collision via platform-suffix: App.tsx→App, App.web.tsx→AppWeb.
    const io = new InMemoryFileIO();
    io.files.set('/project/App.tsx', `export function App() { return <div>App</div>; }`);
    io.files.set('/project/App.web.tsx', `export function App() { return <div>AppWeb</div>; }`);
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    const content = await manager.ensureComponent(['App.tsx', 'App.web.tsx']);
    // Both files must be registered in componentRegistry
    expect(content).toContain("'App.tsx'");
    expect(content).toContain("'App.web.tsx'");
    // App.web.tsx gets AppWeb alias, App.tsx gets App alias
    expect(content).toContain('AppWeb');
    // No duplicate identifier
    expect(isValidTypeScript(content)).toBe(true);
  });
});

describe('PreviewFileManager — buildEntry non-PascalCase guard', () => {
  it('skips entry files (main.tsx, index.tsx) that have no PascalCase export', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/main.tsx',
      `import { createRoot } from 'react-dom/client'\ncreateRoot(document.getElementById('root')!).render(<App />)\n`,
    );
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    // ensureComponent with main.tsx should not throw, but should skip it and still register Button
    const content = await manager.ensureComponent(['src/main.tsx', 'src/components/Button.tsx']);
    // main.tsx has no PascalCase export → excluded from registry
    expect(content).not.toContain('"src/main.tsx"');
    // Button is valid → included
    expect(content).toContain('Button');
  });
});

describe('PreviewFileManager — ensureComponent stale entry detection', () => {
  it('regenerates when existing file has non-PascalCase entries (e.g. from main.tsx)', async () => {
    // Simulate a stale __canvas_preview__.tsx that includes src/main.tsx
    const stalePreview = `import React from 'react';
import { main } from './main';
import Button from './components/Button';
const componentRegistry = { 'src/main.tsx': main, 'src/components/Button.tsx': Button };
const sampleRenderMap = {};
const sampleRenderersMap = {};
const callbackStubs = {};
export default function CanvasPreview() { return null; }
`;
    const io = new InMemoryFileIO();
    io.files.set('/project/src/__canvas_preview__.tsx', stalePreview);
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    io.files.set(
      '/project/src/main.tsx',
      `import { createRoot } from 'react-dom/client'\ncreateRoot(document.getElementById('root')!).render(<App />)\n`,
    );
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    // Triggering ensureComponent with Button (already in registry) should detect stale main entry
    const content = await manager.ensureComponent(['src/components/Button.tsx']);
    // After regeneration, main.tsx must be gone
    expect(content).not.toContain('"src/main.tsx"');
    expect(content).not.toContain('{ main }');
    // Button should still be there
    expect(content).toContain('Button');
  });

  it('regenerates when existing file contains app/layout.tsx (Next.js reserved file)', async () => {
    // Simulate a __canvas_preview__.tsx that was generated when user opened layout.tsx.
    // layout.tsx exports RootLayout (PascalCase) so old stale detection missed it.
    const stalePreview = `import React from 'react';
import RootLayout from '../app/layout';
import Button from './components/Button';
const componentRegistry = { 'app/layout.tsx': RootLayout, 'src/components/Button.tsx': Button };
const sampleRenderMap = {};
const sampleRenderersMap = {};
const callbackStubs = {};
export default function CanvasPreview() { return null; }
`;
    const io = new InMemoryFileIO();
    io.files.set('/project/src/__canvas_preview__.tsx', stalePreview);
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    io.files.set(
      '/project/app/layout.tsx',
      `import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'App' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <>{children}</>; }`,
    );
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    // Triggering ensureComponent with Button (already in registry) should detect reserved layout entry
    const content = await manager.ensureComponent(['src/components/Button.tsx']);
    // layout.tsx must be removed — it breaks Next.js Client Component chain
    expect(content).not.toContain('"app/layout.tsx"');
    expect(content).not.toContain('RootLayout');
    // Button should still be there
    expect(content).toContain('Button');
  });

  it('regenerates when existing file has wrong path casing from a case-insensitive filesystem', async () => {
    const stalePreview = `import React from 'react';
import Sidebar from './components/Sidebar';
import SRCApp from '../SRC/App';
const componentRegistry = {
  'src/components/Sidebar.tsx': Sidebar,
  'SRC/App.tsx': SRCApp,
};
const sampleRenderMap = {};
const sampleRenderersMap = {};
const callbackStubs = {};
export default function CanvasPreview() { return null; }
`;
    const io = new InMemoryFileIO();
    io.files.set('/project/src/__canvas_preview__.tsx', stalePreview);
    io.files.set('/project/src/App.tsx', 'export default function App() { return <div />; }');
    io.files.set('/project/src/components/Sidebar.tsx', 'export default function Sidebar() { return <nav />; }');
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    const content = await manager.ensureComponent(['src/components/Sidebar.tsx']);

    expect(content).not.toContain('SRC/App');
    expect(content).not.toContain("'SRC/App.tsx'");
    expect(content).toContain("'src/App.tsx'");
    expect(content).toContain("from './App'");
    expect(content).toContain("'src/components/Sidebar.tsx'");
  });

  it('excludes layout.tsx when explicitly requested via ensureComponent', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/app/layout.tsx',
      `export const metadata = {};
export default function RootLayout({ children }: { children: React.ReactNode }) { return <>{children}</>; }`,
    );
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    // Requesting layout.tsx explicitly should not add it to the registry
    const content = await manager.ensureComponent(['app/layout.tsx', 'src/components/Button.tsx']);
    expect(content).not.toContain('"app/layout.tsx"');
    expect(content).not.toContain('RootLayout');
    expect(content).toContain('Button');
  });
});

describe('PreviewFileManager — ensureComponent all-non-component paths', () => {
  it('returns existing preview content when all requested paths are non-PascalCase (e.g. main.tsx only)', async () => {
    const existingPreview = `import React from 'react';
import Button from './components/Button';
const componentRegistry = { 'src/components/Button.tsx': Button };
const sampleRenderMap = {};
const sampleRenderersMap = {};
const callbackStubs = {};
export default function CanvasPreview() { return null; }
`;
    const io = new InMemoryFileIO();
    io.files.set('/project/src/__canvas_preview__.tsx', existingPreview);
    io.files.set(
      '/project/src/main.tsx',
      `import { createRoot } from 'react-dom/client'\ncreateRoot(document.getElementById('root')!).render(<App />)\n`,
    );
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    // Only main.tsx passed — no valid component entries — should no-op and return existing content
    const content = await manager.ensureComponent(['src/main.tsx']);
    expect(content).toContain('Button');
    expect(content).not.toContain('"src/main.tsx"');
  });

  it('salvages real components via scan when stale preview only has non-component entries', async () => {
    // Stale file with ONLY main.tsx — no valid PascalCase components
    const staleOnlyNonComponent = `import React from 'react';
import { main } from './main';
const componentRegistry = { 'src/main.tsx': main };
const sampleRenderMap = {};
const sampleRenderersMap = {};
const callbackStubs = {};
export default function CanvasPreview() { return null; }
`;
    const io = new InMemoryFileIO();
    io.files.set('/project/src/__canvas_preview__.tsx', staleOnlyNonComponent);
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    io.files.set(
      '/project/src/main.tsx',
      `import { createRoot } from 'react-dom/client'\ncreateRoot(document.getElementById('root')!).render(<App />)\n`,
    );
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    // ensureComponent(['src/main.tsx']): stale fast path calls _initPreviewFile(['src/main.tsx'])
    // _initPreviewFile has no valid requested entries, but scan finds Button.tsx
    const content = await manager.ensureComponent(['src/main.tsx']);
    // Stale main.tsx entry must be gone
    expect(content).not.toContain('"src/main.tsx"');
    expect(content).not.toContain('{ main }');
    // Button found via scan must be present
    expect(content).toContain('Button');
  });

  it('throws PreviewGenerationError when all requested paths are non-component and no existing file', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/main.tsx',
      `import { createRoot } from 'react-dom/client'\ncreateRoot(document.getElementById('root')!).render(<App />)\n`,
    );
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    await expect(manager.ensureComponent(['src/main.tsx'])).rejects.toThrow(
      'No valid components to include in preview',
    );
  });
});

describe('PreviewFileManager — router shell exclusion (Bulka/Vite React SSG regression)', () => {
  const ROUTER_SHELL_APP = `
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { StaticRouter } from 'react-router-dom/server';
import Index from './pages/Index';

const isBrowser = typeof window !== 'undefined';

function Router({ children }: { children: React.ReactNode }) {
  return isBrowser
    ? <BrowserRouter>{children}</BrowserRouter>
    : <StaticRouter location="/">{children}</StaticRouter>;
}

const App = () => (
  <Router>
    <Routes>
      <Route path="/" element={<Index />} />
    </Routes>
  </Router>
);

export default App;
`;

  const INDEX_PAGE = `
export default function Index() {
  return <main><h1>Bulka the Dog</h1></main>;
}
`;

  it('excludes App.tsx (router shell) and includes pages/Index.tsx when Index is requested', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/client/App.tsx', ROUTER_SHELL_APP);
    io.files.set('/project/client/pages/Index.tsx', INDEX_PAGE);
    io.files.set('/project/package.json', '{}');
    const manager = new PreviewFileManager({ projectRoot: '/project', io });

    const content = await manager.ensureComponent(['client/pages/Index.tsx']);

    // Router shell must be absent from the registry
    expect(content).not.toContain("'client/App.tsx'");
    expect(content).not.toContain("from './App'");
    // The requested page component must be present
    expect(content).toContain("'client/pages/Index.tsx'");
    expect(content).toContain('Index');
    expect(isValidTypeScript(content)).toBe(true);
  });

  it('also excludes App.tsx when both App.tsx and Index.tsx are passed explicitly', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/client/App.tsx', ROUTER_SHELL_APP);
    io.files.set('/project/client/pages/Index.tsx', INDEX_PAGE);
    io.files.set('/project/package.json', '{}');
    const manager = new PreviewFileManager({ projectRoot: '/project', io });

    const content = await manager.ensureComponent(['client/App.tsx', 'client/pages/Index.tsx']);

    expect(content).not.toContain("'client/App.tsx'");
    expect(content).toContain("'client/pages/Index.tsx'");
    expect(isValidTypeScript(content)).toBe(true);
  });

  it('excludes React Navigation shells while keeping screens', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/App.web.tsx',
      `import { ChatListScreen } from './src/screens/ChatListScreen';\nexport default function App() { return <ChatListScreen />; }`,
    );
    io.files.set(
      '/project/src/navigation/AppNavigator.tsx',
      `import { NavigationContainer } from '@react-navigation/native';\nexport function AppNavigator() { return <NavigationContainer><div /></NavigationContainer>; }`,
    );
    io.files.set(
      '/project/src/navigation/BottomTabs.tsx',
      `import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';\nconst Tab = createBottomTabNavigator();\nexport function BottomTabs() { return <Tab.Navigator />; }`,
    );
    io.files.set('/project/src/screens/ChatListScreen.tsx', `export function ChatListScreen() { return <main />; }`);
    io.files.set('/project/package.json', '{}');
    const manager = new PreviewFileManager({ projectRoot: '/project', io });

    const content = await manager.ensureComponent([
      'App.web.tsx',
      'src/navigation/AppNavigator.tsx',
      'src/navigation/BottomTabs.tsx',
      'src/screens/ChatListScreen.tsx',
    ]);

    expect(content).toContain("'App.web.tsx'");
    expect(content).toContain("'src/screens/ChatListScreen.tsx'");
    expect(content).not.toContain("'src/navigation/AppNavigator.tsx'");
    expect(content).not.toContain("'src/navigation/BottomTabs.tsx'");
    expect(content).not.toContain("from './navigation/AppNavigator'");
    expect(content).not.toContain("from './navigation/BottomTabs'");
    expect(isValidTypeScript(content)).toBe(true);
  });

  it('keeps explicitly requested App.web.tsx even when it owns React Navigation providers', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/App.web.tsx',
      `import { NavigationContainer } from '@react-navigation/native';
import { HomeScreen } from './src/screens/HomeScreen';

export default function App() {
  return <NavigationContainer><HomeScreen /></NavigationContainer>;
}`,
    );
    io.files.set(
      '/project/src/screens/HomeScreen.tsx',
      `export function HomeScreen() { return <main>Free Delivery</main>; }`,
    );
    io.files.set('/project/package.json', '{}');
    const manager = new PreviewFileManager({ projectRoot: '/project', io });

    const content = await manager.ensureComponent(['App.web.tsx']);

    expect(content).toContain("'App.web.tsx'");
    expect(content).toContain("import App from '../App.web';");
    expect(content).toContain("'src/screens/HomeScreen.tsx'");
    expect(isValidTypeScript(content)).toBe(true);
  });
});

describe('isValidTypeScript', () => {
  it('should return true for valid TSX code', () => {
    expect(isValidTypeScript('const x: number = 1;')).toBe(true);
  });

  it('should return true for JSX code', () => {
    expect(isValidTypeScript('const el = <div>Hello</div>;')).toBe(true);
  });

  it('should return false for invalid code', () => {
    expect(isValidTypeScript('const x: = ;; {{{')).toBe(false);
  });

  it('should return true for empty string', () => {
    // Empty file is valid TypeScript module
    expect(isValidTypeScript('')).toBe(true);
  });

  it('should return false for HTML document', () => {
    expect(isValidTypeScript('<!DOCTYPE html><html><body></body></html>')).toBe(false);
  });
});

describe('PreviewFileManager.ensurePreviewFiles', () => {
  it('generates route file for Next.js App Router', async () => {
    const io = new InMemoryFileIO();
    // Simulate Next.js App Router project
    io.files.set('/project/app/layout.tsx', 'export default function RootLayout...');
    io.files.set('/project/package.json', JSON.stringify({ dependencies: { next: '^14.0.0' } }));
    // Pre-populate source component
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    // Pre-populate __canvas_preview__.tsx (as if ensureComponent ran first)
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      '// @hyperide-managed\nexport default function CanvasPreview() {}',
    );

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    const result = await manager.ensurePreviewFiles();
    // Files freshly written → 'ok-files-written' so caller can arm recompile gate
    expect(result).toBe('ok-files-written');

    const routeFile = io.files.get('/project/app/test-preview/page.tsx');
    expect(routeFile).toBeDefined();
    expect(routeFile).toContain('@hyperide-managed');
    expect(routeFile).toContain('CanvasPreview');
    expect(routeFile).toContain('useSearchParams');

    const layoutFile = io.files.get('/project/app/test-preview/layout.tsx');
    expect(layoutFile).toBeDefined();
    expect(layoutFile).toContain('@hyperide-managed');

    // Idempotent — same content, no new writes → 'ok'
    const result2 = await manager.ensurePreviewFiles();
    expect(result2).toBe('ok');
  });

  it('updates route file if it already exists with @hyperide-managed', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/app/layout.tsx', '...');
    io.files.set('/project/package.json', JSON.stringify({ dependencies: { next: '^14.0.0' } }));
    const existingContent = '// @hyperide-managed\nexport default function TestPreviewPage() {}';
    io.files.set('/project/app/test-preview/page.tsx', existingContent);
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      '// @hyperide-managed\nexport default function CanvasPreview() {}',
    );

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.ensurePreviewFiles();

    const routeFile = io.files.get('/project/app/test-preview/page.tsx');
    expect(routeFile).not.toBe(existingContent);
    expect(routeFile).toContain('id="root"');
  });

  it('does not overwrite user file without @hyperide-managed', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/app/layout.tsx', '...');
    io.files.set('/project/package.json', JSON.stringify({ dependencies: { next: '^14.0.0' } }));
    const userContent = 'export default function UserPage() { return <div>My page</div>; }';
    io.files.set('/project/app/test-preview/page.tsx', userContent);
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      '// @hyperide-managed\nexport default function CanvasPreview() {}',
    );

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.ensurePreviewFiles();

    // User file must not be overwritten
    expect(io.files.get('/project/app/test-preview/page.tsx')).toBe(userContent);
  });

  it('returns unsupported for unknown framework', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/package.json', JSON.stringify({ dependencies: { react: '^18.0.0' } }));
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      '// @hyperide-managed\nexport default function CanvasPreview() {}',
    );

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    const result = await manager.ensurePreviewFiles();
    expect(result).toBe('unsupported');
  });

  it('returns needs-patch for vite-spa-jsx-router', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/package.json', JSON.stringify({ dependencies: { vite: '^5.0.0' } }));

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    const result = await manager.ensurePreviewFiles();
    expect(result).toBe('needs-patch');
  });

  it('returns needs-patch for bun SPA project', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/bun.lock', '');
    io.files.set('/project/package.json', JSON.stringify({ scripts: { start: 'bun run index.tsx' } }));

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    const result = await manager.ensurePreviewFiles();
    expect(result).toBe('needs-patch');
  });

  it('generates Remix route with SSR hyper-canvas scripts and is idempotent', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/package.json', JSON.stringify({ dependencies: { '@remix-run/react': '^2.0.0' } }));
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      '// @hyperide-managed\nexport default function CanvasPreview() {}',
    );

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    const result = await manager.ensurePreviewFiles();
    expect(result).toBe('ok-files-written');

    const routeFile = io.files.get('/project/app/routes/test-preview.tsx');
    expect(routeFile).toBeDefined();
    expect(routeFile).toContain('@hyperide-managed');
    // The interaction script must be an SSR-rendered <script src> tag (present at first
    // paint), NOT appended in the old post-hydration HyperCanvasScripts effect (#77/#45
    // cold-SSR race). Scope the negative guard to the removed mechanism, not "useEffect".
    expect(routeFile).toContain('data-hyper-inject="interaction"');
    expect(routeFile).toContain('src="/__hypercanvas/iframe-interaction.js"');
    expect(routeFile).not.toContain('HyperCanvasScripts');
    expect(routeFile).not.toContain('document.head.appendChild');
    expect(routeFile).toContain('useSearchParams');
    expect(routeFile).toContain('id="root"');

    // Idempotent — same content already committed, no rewrite → 'ok' (no HMR triggered)
    const result2 = await manager.ensurePreviewFiles();
    expect(result2).toBe('ok');
  });
});

describe('PreviewFileManager.ensureComponent — git exclude side-effect', () => {
  it('writes git exclude after generating __canvas_preview__.tsx (monorepo: git root above projectRoot)', async () => {
    // Simulates conloca-private monorepo: git root is /monorepo, project is /monorepo/targets/conloca-app
    const io = new InMemoryFileIO();
    // .git lives at monorepo root, not at projectRoot
    io.files.set('/monorepo/.git/HEAD', 'ref: refs/heads/main\n');
    io.files.set('/monorepo/targets/conloca-app/package.json', JSON.stringify({ dependencies: { vite: '^5.0.0' } }));
    io.files.set('/monorepo/targets/conloca-app/src/Button.tsx', BUTTON_SOURCE);

    const manager = new PreviewFileManager({
      projectRoot: '/monorepo/targets/conloca-app',
      io,
    });
    await manager.ensureComponent(['src/Button.tsx']);

    // Exclude file must be at the monorepo git root, not at projectRoot
    const content = io.files.get('/monorepo/.git/info/exclude');
    expect(content).toBeDefined();
    expect(content).toContain('__canvas_preview__.tsx');
    expect(content).toContain('__canvas_preview_standalone__.tsx');
  });
});

describe('PreviewFileManager.ensureGitExclude', () => {
  it('creates .git/info/exclude with all entries when file is missing', async () => {
    const io = new InMemoryFileIO();
    // Provide a .git dir so findGitRoot can locate the repo root
    io.files.set('/project/.git/HEAD', 'ref: refs/heads/main\n');
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.ensureGitExclude();

    const content = io.files.get('/project/.git/info/exclude');
    expect(content).toContain('# HyperIDE — generated preview files');
    expect(content).toContain('__canvas_preview__.tsx');
    expect(content).toContain('__canvas_preview_standalone__.tsx');
    expect(content).toContain('**/test-preview/');
    expect(content).toContain('**/test-preview.tsx');
    expect(content).toContain('**/test-preview.astro');
  });

  it('appends missing entries to existing exclude file', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/.git/info/exclude', '# existing\n*.log\n');
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.ensureGitExclude();

    const content = io.files.get('/project/.git/info/exclude');
    expect(content).toContain('# existing');
    expect(content).toContain('*.log');
    expect(content).toContain('__canvas_preview__.tsx');
  });

  it('is idempotent — does not duplicate entries', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/.git/info/exclude',
      '# HyperIDE — generated preview files\n__canvas_preview__.tsx\n__canvas_preview_standalone__.tsx\n__canvas_samples__.tsx\n*.samples.tsx\n.hyperide/\n**/test-preview/\n**/test-preview.tsx\n**/test-preview.astro\n',
    );
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    const before = io.files.get('/project/.git/info/exclude');
    await manager.ensureGitExclude();
    const after = io.files.get('/project/.git/info/exclude');
    expect(after).toBe(before); // unchanged
  });

  it('adds newline separator when existing file does not end with newline', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/.git/info/exclude', '# existing');
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.ensureGitExclude();

    const content = io.files.get('/project/.git/info/exclude') ?? '';
    expect(content.startsWith('# existing\n')).toBe(true);
  });

  it('does not throw when .git/info/exclude is not writable (worktree or non-git dir)', async () => {
    const io = new InMemoryFileIO();
    // writeFile always throws (simulates .git being a file or no write access)
    io.writeFile = async () => {
      throw new Error('ENOTDIR');
    };
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await expect(manager.ensureGitExclude()).resolves.toBeUndefined();
  });
});

describe('PreviewFileManager.cleanupPreviewFiles', () => {
  it('removes @hyperide-managed route files', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/app/layout.tsx', '...');
    io.files.set('/project/package.json', JSON.stringify({ dependencies: { next: '^14.0.0' } }));
    io.files.set(
      '/project/app/test-preview/page.tsx',
      '// @hyperide-managed\nexport default function TestPreviewPage() {}',
    );
    io.files.set(
      '/project/app/test-preview/layout.tsx',
      '// @hyperide-managed\nexport default function PreviewLayout...',
    );
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      '// @hyperide-managed\nexport default function CanvasPreview() {}',
    );

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.cleanupPreviewFiles();

    expect(io.files.has('/project/app/test-preview/page.tsx')).toBe(false);
    expect(io.files.has('/project/app/test-preview/layout.tsx')).toBe(false);
    // __canvas_preview__.tsx should NOT be removed — only route files
    expect(io.files.has('/project/src/__canvas_preview__.tsx')).toBe(true);
  });

  it('does not remove user files without @hyperide-managed', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/app/layout.tsx', '...');
    io.files.set('/project/package.json', JSON.stringify({ dependencies: { next: '^14.0.0' } }));
    io.files.set('/project/app/test-preview/page.tsx', 'export default function MyPage() {}');

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.cleanupPreviewFiles();

    expect(io.files.has('/project/app/test-preview/page.tsx')).toBe(true);
  });
});

describe('PreviewFileManager._hasImport', () => {
  it('returns true for exact relative import', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      "import Button from './components/Button';\nexport default function CanvasPreview() {}",
    );
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    expect(await manager._hasImport('/project/src/__canvas_preview__.tsx', './components/Button')).toBe(true);
  });

  it('returns true when import has extension but search does not', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      "import Button from './components/Button.tsx';\nexport default function CanvasPreview() {}",
    );
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    expect(await manager._hasImport('/project/src/__canvas_preview__.tsx', './components/Button')).toBe(true);
  });

  it('returns false for missing import', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      "import Button from './components/Button';\nexport default function CanvasPreview() {}",
    );
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    expect(await manager._hasImport('/project/src/__canvas_preview__.tsx', './components/Card')).toBe(false);
  });

  it('handles absolute vs relative normalization (same resolved path)', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      "import Button from '../src/components/Button';\nexport default function CanvasPreview() {}",
    );
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    // Different relative path, same resolved file
    expect(await manager._hasImport('/project/src/__canvas_preview__.tsx', './components/Button')).toBe(true);
  });
});

describe('ensureComponent — fast path', () => {
  it('does not write file when import already present', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      `// ${PREVIEW_GENERATOR_SCHEMA_MARKER}\n// @hyperide-managed\nimport Button from './components/Button';\nconst previewFallbackProps = {};\nexport default function CanvasPreview() {}`,
    );
    let writeCount = 0;
    const origWrite = io.writeFile.bind(io);
    io.writeFile = async (p, c) => {
      writeCount++;
      return origWrite(p, c);
    };

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.ensureComponent(['src/components/Button.tsx']);

    expect(writeCount).toBe(0); // fast path — no write
  });

  it('regenerates when generated schema marker is stale', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      "// @hyperide-managed\nimport Button from './components/Button';\nconst previewFallbackProps = { data: [] };\nexport default function CanvasPreview() {}",
    );

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    const content = await manager.ensureComponent(['src/components/Button.tsx']);

    expect(content).toContain(PREVIEW_GENERATOR_SCHEMA_MARKER);
    expect(content).toContain('data: previewData');
  });

  // HYP-446 P1 (codex, generator.ts:1078): bumping the schema marker must invalidate
  // already-generated previews carrying the PREVIOUS marker. The "old marker" fixture
  // uses the literal v10 string ON PURPOSE — referencing the (now-v11) constant would make
  // the file hit the fast path and the test would assert nothing after the next bump.
  it('regenerates when an existing preview carries the PREVIOUS schema marker (v10)', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      "// @hyperide-preview-schema:fallback-props-v10\n// @hyperide-managed\nimport Button from './components/Button';\nconst previewFallbackProps = { data: [] };\nexport default function CanvasPreview() {}",
    );

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    const content = await manager.ensureComponent(['src/components/Button.tsx']);

    // The stale v10 marker is gone, replaced with the current marker, and the file went
    // through the real generator (componentRegistry shape, not the hand-written stub).
    expect(content).not.toContain('fallback-props-v10');
    expect(content).toContain(PREVIEW_GENERATOR_SCHEMA_MARKER);
    expect(content).toContain('componentRegistry');
  });

  // The wrapper fix only takes effect for real projects if regeneration re-runs the CURRENT
  // generator with the project's providerWrap. End-to-end proof: an RN project whose existing
  // preview still has the v10 marker is regenerated WITH the definite-height wrapper.
  it('regenerates an RN preview with the v10 marker and emits the definite-height wrapper', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      "// @hyperide-preview-schema:fallback-props-v10\n// @hyperide-managed\nimport { SafeAreaProvider } from 'react-native-safe-area-context';\nimport Button from './components/Button';\nconst previewFallbackProps = { data: [] };\nexport default function CanvasPreview() {}",
    );

    const manager = new PreviewFileManager({
      projectRoot: '/project',
      io,
      providerWrap: {
        imports: ["import { SafeAreaProvider } from 'react-native-safe-area-context';"],
        wrapOpen: '<SafeAreaProvider>',
        wrapClose: '</SafeAreaProvider>',
      },
    });
    const content = await manager.ensureComponent(['src/components/Button.tsx']);

    expect(content).toContain(PREVIEW_GENERATOR_SCHEMA_MARKER);
    expect(content).not.toContain('fallback-props-v10');
    // The HYP-446 RN wrapper is now present in the regenerated file.
    expect(content).toContain("minHeight: '100vh'");
    expect(content).toContain("flexDirection: 'column'");
  });

  it('regenerates when an already registered component gains SampleDefault', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/components/Alert.tsx',
      `
export function Alert({ children }: { children?: React.ReactNode }) {
  return <div>{children}</div>;
}

export const SampleDefault = () => <Alert>Visible alert</Alert>;
`,
    );
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      `// ${PREVIEW_GENERATOR_SCHEMA_MARKER}
// @hyperide-managed
import { Alert } from './components/Alert';
const componentRegistry: Record<string, React.ComponentType<Record<string, unknown>>> = {
  'src/components/Alert.tsx': Alert,
};
const sampleRenderMap: Record<string, React.FC> = {};
const sampleRenderersMap: Record<string, Record<string, React.FC>> = {};
export default function CanvasPreview() { return null; }
`,
    );

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    const content = await manager.ensureComponent(['src/components/Alert.tsx']);

    expect(content).toContain('SampleDefault as AlertSampleDefault');
    expect(content).toContain("'src/components/Alert.tsx': AlertSampleDefault");
  });

  it('AST-inserts missing import without full regeneration', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    io.files.set('/project/src/components/Card.tsx', CARD_SOURCE);
    // File has Button but not Card
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      "// @hyperide-managed\nimport Button from './components/Button';\nexport default function CanvasPreview() {}",
    );

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.ensureComponent(['src/components/Card.tsx']);

    const content = io.files.get('/project/src/__canvas_preview__.tsx');
    expect(content).toBeDefined();
    expect(content).toContain('Button'); // existing import preserved
    expect(content).toContain('Card'); // new import added
  });

  it('init: generates with ALL project components when file is missing', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    io.files.set('/project/src/components/Card.tsx', CARD_SOURCE);
    io.files.set('/project/package.json', JSON.stringify({ name: 'test' }));

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.ensureComponent(['src/components/Button.tsx']); // only Button requested

    const content = io.files.get('/project/src/__canvas_preview__.tsx');
    expect(content).toBeDefined();
    expect(content).toContain('Button');
    expect(content).toContain('Card'); // all components included on init
  });
});

const ROUTER_SOURCE = `
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}
`;

const ROUTER_SOURCE_WITH_CATCH_ALL = `
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home';
import { NotFound } from './pages/NotFound';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
`;

const ROUTER_SOURCE_WITH_MANAGED_ROUTE_AFTER_CATCH_ALL = `
import CanvasPreview from './__canvas_preview__'; // @hyperide-managed
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home';
import { NotFound } from './pages/NotFound';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="*" element={<NotFound />} />
        <Route path="/test-preview" element={<CanvasPreview />} />
      </Routes>
    </BrowserRouter>
  );
}
`;

describe('PreviewFileManager.patchRouterConfig', () => {
  it('injects /test-preview route into <Routes>', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/App.tsx', ROUTER_SOURCE);
    io.files.set('/project/package.json', JSON.stringify({ name: 'test' }));

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchRouterConfig('/project/src/App.tsx');

    const patched = io.files.get('/project/src/App.tsx');
    expect(patched).toBeDefined();
    expect(patched).toContain('test-preview');
    expect(patched).toContain('@hyperide-managed');
    expect(patched).toContain('CanvasPreview');
  });

  it('injects /test-preview route before a catch-all route', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/App.tsx', ROUTER_SOURCE_WITH_CATCH_ALL);
    io.files.set('/project/package.json', JSON.stringify({ name: 'test' }));

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchRouterConfig('/project/src/App.tsx');

    const patched = io.files.get('/project/src/App.tsx');
    expect(patched).toBeDefined();
    expect(patched?.indexOf('path="/test-preview"')).toBeLessThan(patched?.indexOf('path="*"') ?? -1);
  });

  it('moves an existing managed /test-preview route before a catch-all route', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/App.tsx', ROUTER_SOURCE_WITH_MANAGED_ROUTE_AFTER_CATCH_ALL);
    io.files.set('/project/package.json', JSON.stringify({ name: 'test' }));

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchRouterConfig('/project/src/App.tsx');

    const patched = io.files.get('/project/src/App.tsx');
    expect(patched).toBeDefined();
    expect(patched?.indexOf('path="/test-preview"')).toBeLessThan(patched?.indexOf('path="*"') ?? -1);
    expect(patched?.match(/import CanvasPreview/g)?.length).toBe(1);
    expect(patched?.match(/path="\/test-preview"/g)?.length).toBe(1);
  });

  it('revertRouterPatch removes @hyperide-managed lines and preserves original routes', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/App.tsx', ROUTER_SOURCE);
    io.files.set('/project/package.json', JSON.stringify({ name: 'test' }));

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchRouterConfig('/project/src/App.tsx');
    await manager.revertRouterPatch('/project/src/App.tsx');

    const reverted = io.files.get('/project/src/App.tsx');
    expect(reverted).toBeDefined();
    expect(reverted).not.toContain('@hyperide-managed');
    expect(reverted).not.toContain('test-preview');
    // Original home route must survive the revert
    expect(reverted).toContain('path="/"');
    expect(reverted).toContain('Home');
  });

  it('is idempotent — does not double-inject', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/App.tsx', ROUTER_SOURCE);
    io.files.set('/project/package.json', JSON.stringify({ name: 'test' }));

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchRouterConfig('/project/src/App.tsx');
    await manager.patchRouterConfig('/project/src/App.tsx');

    const patched = io.files.get('/project/src/App.tsx');
    expect(patched).toBeDefined();
    // Should only have one test-preview route
    const count = (patched?.match(/test-preview/g) ?? []).length;
    expect(count).toBe(1);
  });
});

const ENTRY_SOURCE = `
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;

describe('PreviewFileManager.patchEntryFile', () => {
  it('wraps createRoot call in if/else block', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/index.tsx', ENTRY_SOURCE);
    io.files.set('/project/package.json', JSON.stringify({ name: 'test' }));
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchEntryFile('/project/src/index.tsx');
    const patched = io.files.get('/project/src/index.tsx');
    expect(patched).toBeDefined();
    expect(patched).toContain('@hyperide-managed');
    expect(patched).toContain('__canvas_preview__');
    // Checks both ?component= and /test-preview path to avoid hijacking app URLs
    expect(patched).toMatch(/get\(["']component["']\)/);
    expect(patched).toContain('includes');
    expect(patched).toContain('test-preview');
    // App shell: must render CanvasPreview via .then() — not a plain side-effect import
    expect(patched).toContain('.then(');
    expect(patched).toContain('CanvasPreviewComp');
    // Uses JSX (<CanvasPreviewComp />) — no React.createElement needed, works with auto JSX runtime
    expect(patched).toContain('<CanvasPreviewComp');
    // Defensive: .catch() fallback renders original app if __canvas_preview__ fails to load
    expect(patched).toContain('.catch(');
  });

  it('revertEntryFile restores original bootstrap code', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/index.tsx', ENTRY_SOURCE);
    io.files.set('/project/package.json', JSON.stringify({ name: 'test' }));
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchEntryFile('/project/src/index.tsx');
    await manager.revertEntryFile('/project/src/index.tsx');
    const reverted = io.files.get('/project/src/index.tsx');
    expect(reverted).toBeDefined();
    expect(reverted).not.toContain('@hyperide-managed');
    expect(reverted).not.toMatch(/get\(["']component["']\)/);
    expect(reverted).toContain('ReactDOM.createRoot');
    expect(reverted).toContain("document.getElementById('root')");
  });

  it('is idempotent', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/index.tsx', ENTRY_SOURCE);
    io.files.set('/project/package.json', JSON.stringify({ name: 'test' }));
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchEntryFile('/project/src/index.tsx');
    await manager.patchEntryFile('/project/src/index.tsx');
    const patched = io.files.get('/project/src/index.tsx');
    expect(patched).toBeDefined();
    const count = (patched?.match(/get\(["']component["']\)/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('uses React.createElement for .ts entry files (no JSX allowed in plain TypeScript)', async () => {
    const tsEntry = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
ReactDOM.createRoot(document.getElementById('root')!).render(React.createElement(App, null));
`;
    const io = new InMemoryFileIO();
    io.files.set('/project/src/index.ts', tsEntry);
    io.files.set('/project/package.json', JSON.stringify({ name: 'test' }));
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchEntryFile('/project/src/index.ts');
    const patched = io.files.get('/project/src/index.ts');
    expect(patched).toBeDefined();
    expect(patched).toContain('@hyperide-managed');
    expect(patched).toContain('CanvasPreviewComp');
    // Must NOT contain JSX syntax — TypeScript rejects JSX in .ts files
    expect(patched).not.toContain('<CanvasPreviewComp');
    // Must use React.createElement instead
    expect(patched).toContain('React.createElement');
  });
  it('falls back to appended conditional import for non-standard entries (ViteReactSSG)', async () => {
    const viteReactSsgEntry = `import { ViteReactSSG } from "vite-react-ssg/single-page";
import App from "./App";
export const createRoot = ViteReactSSG(<App />);
`;
    const io = new InMemoryFileIO();
    io.files.set('/project/src/main.tsx', viteReactSsgEntry);
    io.files.set('/project/package.json', JSON.stringify({ name: 'test' }));
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchEntryFile('/project/src/main.tsx');
    const patched = io.files.get('/project/src/main.tsx');
    expect(patched).toBeDefined();
    expect(patched).toContain('@hyperide-managed');
    expect(patched).toContain('__canvas_preview__');
    expect(patched).toContain('test-preview');
    expect(patched).toContain('import("');
    // Original code preserved
    expect(patched).toContain('ViteReactSSG');
    // App Shell fallback must render the component — plain import is not enough because
    // __canvas_preview__ only exports a React component, it doesn't self-render.
    expect(patched).toContain('react-dom/client');
    expect(patched).toContain('createElement');
  });

  it('falls back to plain import for non-standard entries in Isolated/standalone mode (ViteReactSSG)', async () => {
    const viteReactSsgEntry = `import { ViteReactSSG } from "vite-react-ssg/single-page";
import App from "./App";
export const createRoot = ViteReactSSG(<App />);
`;
    const io = new InMemoryFileIO();
    io.files.set('/project/src/main.tsx', viteReactSsgEntry);
    io.files.set('/project/package.json', JSON.stringify({ name: 'test' }));
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchEntryFile('/project/src/main.tsx', './__canvas_preview_standalone__');
    const patched = io.files.get('/project/src/main.tsx');
    expect(patched).toBeDefined();
    expect(patched).toContain('@hyperide-managed');
    expect(patched).toContain('__canvas_preview_standalone__');
    expect(patched).toContain('test-preview');
    expect(patched).toContain('import("');
    // Original code preserved
    expect(patched).toContain('ViteReactSSG');
    // Standalone has its own createRoot — should NOT add extra rendering boilerplate
    expect(patched).not.toContain('react-dom/client');
    expect(patched).not.toContain('createElement');
  });

  it('revertEntryFile restores appended fallback form', async () => {
    const viteReactSsgEntry = `import { ViteReactSSG } from "vite-react-ssg/single-page";
import App from "./App";
export const createRoot = ViteReactSSG(<App />);
`;
    const io = new InMemoryFileIO();
    io.files.set('/project/src/main.tsx', viteReactSsgEntry);
    io.files.set('/project/package.json', JSON.stringify({ name: 'test' }));
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchEntryFile('/project/src/main.tsx');
    await manager.revertEntryFile('/project/src/main.tsx');
    const reverted = io.files.get('/project/src/main.tsx');
    expect(reverted).toBeDefined();
    expect(reverted).not.toContain('@hyperide-managed');
    expect(reverted).not.toContain('test-preview');
    expect(reverted).toContain('ViteReactSSG');
  });
});

describe('PreviewFileManager.ensureStandaloneEntry', () => {
  it('generates __canvas_preview_standalone__.tsx from existing canvas_preview', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    const manager = createManager(io);
    await manager.ensureComponent(['src/components/Button.tsx']);
    await manager.ensureStandaloneEntry();

    const standalone = io.files.get('/project/src/__canvas_preview_standalone__.tsx');
    expect(standalone).toBeDefined();
    expect(standalone).toContain('createRoot');
    expect(standalone).toContain('PreviewWrapper');
    expect(standalone).toContain('CanvasPreview');
    expect(standalone).toContain('@hyperide-managed');
    // Base preview content is preserved
    expect(standalone).toContain('componentRegistry');
    expect(standalone).toContain('sampleRenderMap');
  });

  it('wrapper import path is relative from src/ to .hyperide/', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    const manager = createManager(io);
    await manager.ensureComponent(['src/components/Button.tsx']);
    await manager.ensureStandaloneEntry();

    const standalone = io.files.get('/project/src/__canvas_preview_standalone__.tsx');
    expect(standalone).toContain('../.hyperide/preview');
  });

  it('is a no-op when __canvas_preview__.tsx does not exist', async () => {
    const io = new InMemoryFileIO();
    const manager = createManager(io);
    await expect(manager.ensureStandaloneEntry()).resolves.toBeUndefined();
    expect(io.files.has('/project/src/__canvas_preview_standalone__.tsx')).toBe(false);
  });

  it('updates standalone entry when called again after new component added', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    io.files.set('/project/src/components/Card.tsx', CARD_SOURCE);
    const manager = createManager(io);
    await manager.ensureComponent(['src/components/Button.tsx']);
    await manager.ensureStandaloneEntry();

    // Add Card — regenerate preview + standalone
    await manager.ensureComponent(['src/components/Button.tsx', 'src/components/Card.tsx']);
    await manager.ensureStandaloneEntry();

    const standalone = io.files.get('/project/src/__canvas_preview_standalone__.tsx');
    expect(standalone).toContain('Button');
    expect(standalone).toContain('Card');
  });
});

describe('PreviewFileManager._writeIfSafe mkdir', () => {
  it('calls mkdir before writing nested route file', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/package.json', JSON.stringify({ dependencies: { next: '^14' } }));
    io.files.set('/project/app/layout.tsx', '// root layout');
    io.files.set('/project/src/__canvas_preview__.tsx', '// preview');
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.ensurePreviewFiles();

    // mkdir should have been called for the nested route directory
    expect(io.mkdirCalls).toContain('/project/app/test-preview');
  });
});

describe('PreviewFileManager.patchEntryFile — importTarget', () => {
  it('uses default __canvas_preview__ import target (App Shell)', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/index.tsx', ENTRY_SOURCE);
    io.files.set('/project/package.json', JSON.stringify({ name: 'test' }));
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchEntryFile('/project/src/index.tsx');
    const patched = io.files.get('/project/src/index.tsx');
    expect(patched).toContain('./__canvas_preview__');
    expect(patched).not.toContain('__canvas_preview_standalone__');
  });

  it('uses __canvas_preview_standalone__ import target when specified (Isolated/Tier 2)', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/index.tsx', ENTRY_SOURCE);
    io.files.set('/project/package.json', JSON.stringify({ name: 'test' }));
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchEntryFile('/project/src/index.tsx', './__canvas_preview_standalone__');
    const patched = io.files.get('/project/src/index.tsx');
    expect(patched).toContain('./__canvas_preview_standalone__');
    expect(patched).toContain('@hyperide-managed');
    expect(patched).toMatch(/get\(["']component["']\)/);
  });

  it('revertEntryFile removes Tier 2 patch correctly', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/index.tsx', ENTRY_SOURCE);
    io.files.set('/project/package.json', JSON.stringify({ name: 'test' }));
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchEntryFile('/project/src/index.tsx', './__canvas_preview_standalone__');
    await manager.revertEntryFile('/project/src/index.tsx');
    const reverted = io.files.get('/project/src/index.tsx');
    expect(reverted).not.toContain('@hyperide-managed');
    expect(reverted).toContain('ReactDOM.createRoot');
  });
});

describe('PreviewFileManager.ensureIsolatedNextJsLayout (Tier 3)', () => {
  it('generates layout.tsx with PreviewWrapper import for Next.js App Router', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/package.json', JSON.stringify({ dependencies: { next: '^14' } }));
    io.files.set('/project/app/layout.tsx', '// root layout');
    io.files.set('/project/src/__canvas_preview__.tsx', '// preview');
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.ensureIsolatedNextJsLayout();

    const layout = io.files.get('/project/app/test-preview/layout.tsx');
    expect(layout).toBeDefined();
    expect(layout).toContain('@hyperide-managed');
    expect(layout).toContain('PreviewWrapper');
    expect(layout).toContain('.hyperide/preview');
    // Must NOT be a blank layout
    expect(layout).not.toContain('<>{children}</>');
  });

  it('generates route file alongside the isolated layout', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/package.json', JSON.stringify({ dependencies: { next: '^14' } }));
    io.files.set('/project/app/layout.tsx', '// root layout');
    io.files.set('/project/src/__canvas_preview__.tsx', '// preview');
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.ensureIsolatedNextJsLayout();

    const page = io.files.get('/project/app/test-preview/page.tsx');
    expect(page).toBeDefined();
    expect(page).toContain('@hyperide-managed');
    expect(page).toContain('TestPreviewPage');
  });

  it('wrapper import path goes from layout dir to projectRoot/.hyperide/preview', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/package.json', JSON.stringify({ dependencies: { next: '^14' } }));
    io.files.set('/project/app/layout.tsx', '// root layout');
    io.files.set('/project/src/__canvas_preview__.tsx', '// preview');
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.ensureIsolatedNextJsLayout();

    const layout = io.files.get('/project/app/test-preview/layout.tsx');
    // Layout is at app/test-preview/layout.tsx, .hyperide is at project root
    // Relative path: ../../.hyperide/preview
    expect(layout).toContain('../../.hyperide/preview');
  });
});

const SHEET_SOURCE = `
import * as React from 'react';

export const Sheet = ({ children }: { children: React.ReactNode }) => (
  <div role="dialog">{children}</div>
);
export const SheetTrigger = ({ children }: { children: React.ReactNode }) => <>{children}</>;
`;

const UTILS_SOURCE = `
export function cn(...classes: string[]) {
  return classes.filter(Boolean).join(' ');
}
`;

describe('PreviewFileManager._scanAllComponents — multi-root + shadcn pattern', () => {
  it('synthesizes SampleDefault for components/ui/* compound shadcn modules so they preview without fallback-prop crashes', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/index.html',
      `<!DOCTYPE html><html><body><script type="module" src="/client/main.tsx"></script></body></html>`,
    );
    io.files.set('/project/client/components/ui/sheet.tsx', SHEET_SOURCE);
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    // Sheet has no authored SampleDefault but it does export the compound
    // SheetTrigger sibling — Task 4 broadens the suffix allow-list so this
    // file gets a synthetic SampleDefault and stays in the registry. The
    // crash-prevention invariant still holds: rendering goes through the
    // synthesized sample arrow, never the bare fallback-prop spread.
    const content = await manager.ensureComponent(['client/components/ui/sheet.tsx']);
    expect(content).toContain("'client/components/ui/sheet.tsx'");
    expect(content).toContain('SheetModule.Sheet');
    expect(content).toContain('SheetModule.SheetTrigger');
  });

  it('excludes components/ui/* with non-default samples but no SampleDefault', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/index.html',
      `<!DOCTYPE html><html><body><script type="module" src="/client/main.tsx"></script></body></html>`,
    );
    const navMenuSource = `
import React from 'react';
export function NavigationMenu() { return <nav />; }
export const SamplePrimary = () => <NavigationMenu />;
`;
    io.files.set('/project/client/components/ui/navigation-menu.tsx', navMenuSource);
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    // Has SamplePrimary but no SampleDefault — render path would fall through to fallback-prop
    // spread and crash, so must still be excluded from componentRegistry/sampleRenderMap.
    // It IS allowed (and now expected) to appear in componentExportsMap so the iframe's
    // fallback UI can show "Detected exports: NavigationMenu" instead of "Generating sample…".
    const content = await manager.ensureComponent(['client/components/ui/navigation-menu.tsx']);
    // Build the registry/sampleRenderMap region to assert the path is NOT registered there.
    const registrySection = content.slice(
      content.indexOf('const componentRegistry'),
      content.indexOf('const componentExportsMap'),
    );
    const sampleRenderMapSection = content.slice(
      content.indexOf('const sampleRenderMap'),
      content.indexOf('const componentExportsMap'),
    );
    expect(registrySection).not.toContain("'client/components/ui/navigation-menu.tsx'");
    expect(sampleRenderMapSection).not.toContain("'client/components/ui/navigation-menu.tsx'");
    // componentExportsMap MAY include the path so the fallback UI can list detected exports.
    const exportsSection = content.slice(
      content.indexOf('const componentExportsMap'),
      content.indexOf('const sampleRenderersMap'),
    );
    expect(exportsSection).toContain("'client/components/ui/navigation-menu.tsx'");
    expect(exportsSection).toContain('"NavigationMenu"');
  });

  it('keeps components/ui/* with SampleDefault in registry when explicitly requested', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/index.html',
      `<!DOCTYPE html><html><body><script type="module" src="/client/main.tsx"></script></body></html>`,
    );
    const fillPickerSource = `
import React from 'react';
export function FillPicker() { return <div />; }
export const SampleDefault = () => <FillPicker />;
`;
    io.files.set('/project/client/components/ui/fill-picker.tsx', fillPickerSource);
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    // fill-picker has SampleDefault — explicitly previewable, must remain in registry
    const content = await manager.ensureComponent(['client/components/ui/fill-picker.tsx']);
    expect(content).toContain("'client/components/ui/fill-picker.tsx'");
  });

  it('does not register lowercase files that export no PascalCase component', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/index.html',
      `<!DOCTYPE html><html><body><script type="module" src="/client/main.tsx"></script></body></html>`,
    );
    io.files.set('/project/client/lib/utils.ts', UTILS_SOURCE);
    io.files.set('/project/client/components/Button.tsx', BUTTON_SOURCE);
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    const content = await manager.ensureComponent(['client/components/Button.tsx']);
    // utils.ts has no PascalCase export → must not appear in registry
    expect(content).not.toContain("'client/lib/utils.ts'");
    expect(content).not.toContain('utils');
    // Button is valid → included
    expect(content).toContain('Button');
  });

  it('scans src/ in addition to detected root so shared components are not missed', async () => {
    // Project with client/ as frontend root but also has components in src/
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/index.html',
      `<!DOCTYPE html><html><body><script type="module" src="/client/main.tsx"></script></body></html>`,
    );
    io.files.set('/project/client/components/Header.tsx', `export function Header() { return <header />; }`);
    io.files.set('/project/src/components/Sidebar.tsx', `export function Sidebar() { return <nav />; }`);
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    const content = await manager.ensureComponent(['client/components/Header.tsx']);
    // client/ component — explicitly requested
    expect(content).toContain('Header');
    // src/ component — discovered via supplemental scan
    expect(content).toContain('Sidebar');
  });
});

const LOGIN_SCREEN_SOURCE = `
import React from 'react';

export default function LoginScreen() {
  return <div>Login</div>;
}
`;

const LOGIN_SCREEN_SAMPLES_SOURCE = `
import React from 'react';
import LoginScreen from './LoginScreen';

export default function LoginScreenSample() {
  return (
    <div style={{ padding: 24, background: '#f5f5f5' }}>
      <LoginScreen />
    </div>
  );
}
`;

describe('*.samples.tsx — co-located sample render files', () => {
  it('isPreviewIneligibleByName excludes *.samples.tsx files', async () => {
    // isPreviewIneligibleByName is not exported — test indirectly via ensureComponent:
    // a file named LoginScreen.samples.tsx must NOT appear in the preview registry.
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/LoginScreen.tsx', LOGIN_SCREEN_SOURCE);
    io.files.set('/project/src/components/LoginScreen.samples.tsx', LOGIN_SCREEN_SAMPLES_SOURCE);
    const manager = createManager(io);

    const content = await manager.ensureComponent([
      'src/components/LoginScreen.tsx',
      'src/components/LoginScreen.samples.tsx',
    ]);

    // The samples file must NOT appear in the componentRegistry or sampleRenderMap
    expect(content).not.toContain("'src/components/LoginScreen.samples.tsx'");
    expect(content).not.toContain('LoginScreen.samples');
    // The real component must still be registered
    expect(content).toContain("'src/components/LoginScreen.tsx'");
  });

  it('*.samples.tsx sibling does not cause errors when passed to ensureComponent', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/LoginScreen.tsx', LOGIN_SCREEN_SOURCE);
    io.files.set('/project/src/components/LoginScreen.samples.tsx', LOGIN_SCREEN_SAMPLES_SOURCE);
    const manager = createManager(io);

    // Should not throw — samples file is silently skipped
    await expect(
      manager.ensureComponent(['src/components/LoginScreen.tsx', 'src/components/LoginScreen.samples.tsx']),
    ).resolves.toBeDefined();
  });

  it('ensureStandaloneEntry is a no-op for samples sibling — sampleRenderMap stays as generated', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/LoginScreen.tsx', LOGIN_SCREEN_SOURCE);
    io.files.set('/project/src/components/LoginScreen.samples.tsx', LOGIN_SCREEN_SAMPLES_SOURCE);
    const manager = createManager(io);

    await manager.ensureComponent(['src/components/LoginScreen.tsx']);
    await manager.ensureStandaloneEntry();

    const standalone = io.files.get('/project/src/__canvas_preview_standalone__.tsx');
    expect(standalone).toBeDefined();
    // The standalone file must not reference the samples file path or import
    expect(standalone).not.toContain('LoginScreen.samples');
    // Standard standalone structure must be intact
    expect(standalone).toContain('sampleRenderMap');
    expect(standalone).toContain('createRoot');
  });

  it('multiple *.samples.tsx variants are all excluded from registry', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    io.files.set(
      '/project/src/components/Button.samples.tsx',
      `import React from 'react'; import { Button } from './Button'; export default () => <Button>Sample</Button>;`,
    );
    io.files.set('/project/src/components/Card.tsx', CARD_SOURCE);
    io.files.set(
      '/project/src/components/Card.samples.tsx',
      `import React from 'react'; import Card from './Card'; export default () => <Card title="Sample" />;`,
    );
    const manager = createManager(io);

    const content = await manager.ensureComponent([
      'src/components/Button.tsx',
      'src/components/Button.samples.tsx',
      'src/components/Card.tsx',
      'src/components/Card.samples.tsx',
    ]);

    expect(content).not.toContain("'src/components/Button.samples.tsx'");
    expect(content).not.toContain("'src/components/Card.samples.tsx'");
    // Real components stay
    expect(content).toContain("'src/components/Button.tsx'");
    expect(content).toContain("'src/components/Card.tsx'");
  });
});

/** Isolate the `declaredPropNamesMap` object literal from generated content. */
function sliceDeclaredPropNamesMap(content: string): string {
  const start = content.indexOf('const declaredPropNamesMap');
  if (start === -1) return '';
  const end = content.indexOf('};', start);
  return content.slice(start, end === -1 ? undefined : end + 2);
}

describe('HYP-465 — default-anonymous prop leak (scanned export == rendered export)', () => {
  // Adversarial repro: a file with a NAMED component AND an anonymous
  // prop-spreading default. extractComponentName → "Card", detectExportStyle →
  // 'default-anonymous', so the generated import `import Card from './Card'`
  // RENDERS the anonymous default (`<div {...props} />`), NOT the named Card.
  // The declaredPropNamesMap must therefore reflect the anonymous default's
  // params (member-access → absent from map → full blob = the honest floor),
  // NOT Card's [title,value,label]. If it whitelisted Card's props, the blob
  // values for title/value/label would be filtered IN and spread onto the host
  // <div> as junk attributes.
  const DIVERGENT_DEFAULT_SOURCE = `export function Card({ title, value, label }) { return <span>{title}</span>; }
export default function (props) { return <div {...props} />; }`;

  it('does NOT whitelist the named component props for a divergent anonymous default', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Card.tsx', DIVERGENT_DEFAULT_SOURCE);
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    const content = await manager.ensureComponent(['src/components/Card.tsx']);

    // The path must be ABSENT from declaredPropNamesMap (anonymous default is
    // member-access → null → undefined → not emitted → filterFallback returns
    // the full blob, which is the intended floor for a prop-spreading default).
    // Scope to the declaredPropNamesMap block — componentExportsMap legitimately
    // keys the same path with ["Card"], which is unrelated to prop filtering.
    const declaredMapBlock = sliceDeclaredPropNamesMap(content);
    expect(declaredMapBlock).not.toContain("'src/components/Card.tsx'");
    // Specifically: Card's declared props must NOT become a whitelist entry.
    expect(content).not.toContain('"title", "value", "label"');
    expect(isValidTypeScript(content)).toBe(true);
  });

  it('whitelists the anonymous default destructure params, not the named component', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/components/Card.tsx',
      `export function Card({ title, value, label }) { return <span>{title}</span>; }
export default function ({ foo, bar }) { return <div>{foo}{bar}</div>; }`,
    );
    io.files.set('/project/package.json', '{}');
    const manager = createManager(io);

    const content = await manager.ensureComponent(['src/components/Card.tsx']);

    // The whitelist must be the rendered default's destructure ([foo,bar]),
    // not Card's [title,value,label].
    expect(content).toContain('\'src/components/Card.tsx\': ["foo", "bar"]');
    expect(content).not.toContain('"title", "value", "label"');
    expect(isValidTypeScript(content)).toBe(true);
  });
});

describe('HYP-546 — provider-shell App.tsx is excluded from the preview registry', () => {
  // Real conloca-app shape: index.html → /src/main.tsx → createRoot(...).render(<App/>),
  // and App.tsx is a PROVIDER shell (wraps the app in AuthProvider/FeatureFlagsProvider,
  // renders its own content, NOT `{children}`). main.tsx is shown ALREADY PATCHED with the
  // @hyperide-managed CanvasPreviewComp branch — the normal on-disk state across sessions —
  // so the extraction must skip that branch and still resolve App via the `else` render.
  const INDEX_HTML = `<!doctype html><html><body>
    <div id="app-root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body></html>`;

  const MAIN_TSX = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './app/App';
import { HostClientProvider } from './app/host-client';
const rootEl = document.getElementById('app-root');
// @hyperide-managed
if (new URLSearchParams(location.search).get("component") && location.pathname.includes("test-preview")) {
  import("./__canvas_preview__").then(m => {
    var CanvasPreviewComp = m.default;
    if (CanvasPreviewComp) createRoot(rootEl).render(<CanvasPreviewComp />);
  }).catch(() => {});
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <QueryClientProvider client={qc}>
        <HostClientProvider client={hc}>
          <App />
        </HostClientProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}`;

  const APP_TSX = `import { AuthProvider, useAuth } from './auth/use-auth';
import { FeatureFlagsProvider } from './feature-flags';
export default function App() {
  return (
    <FeatureFlagsProvider>
      <AuthProvider><AuthRouter /></AuthProvider>
    </FeatureFlagsProvider>
  );
}
function AuthRouter() {
  const { state } = useAuth();
  return <div>{state.kind}</div>;
}`;

  function setupConlocaIo(): InMemoryFileIO {
    const io = new InMemoryFileIO();
    io.files.set('/project/package.json', JSON.stringify({ dependencies: { react: '18', vite: '5' } }));
    io.files.set('/project/index.html', INDEX_HTML);
    io.files.set('/project/src/main.tsx', MAIN_TSX);
    io.files.set('/project/src/app/App.tsx', APP_TSX);
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    return io;
  }

  it('excludes the entry-root provider shell App.tsx but keeps a normal component', async () => {
    const io = setupConlocaIo();
    const manager = createManager(io);

    // User selects Button; App.tsx arrives via the project-wide supplement scan (no options).
    const content = await manager.ensureComponent(['src/components/Button.tsx']);

    expect(content).toContain("'src/components/Button.tsx'");
    // The provider-shell App.tsx (createRoot target) must NOT be registered.
    expect(content).not.toContain("'src/app/App.tsx'");
    expect(isValidTypeScript(content)).toBe(true);
  });

  it('still includes provider-importing components that are NOT the entry root', async () => {
    const io = setupConlocaIo();

    // Guard 1: LanguageProvider-style file that DEFINES its own context — a real,
    // selectable component, not the mounted app shell.
    io.files.set(
      '/project/src/components/LanguageProvider.tsx',
      `import React, { createContext } from 'react';
const LanguageContext = createContext(null);
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  return <LanguageContext.Provider value={null}>{children}</LanguageContext.Provider>;
}
export const SampleDefault = () => <LanguageProvider><span>hi</span></LanguageProvider>;`,
    );

    // Guard 2: a component that imports a provider only to wrap its SampleDefault.
    io.files.set(
      '/project/src/components/Widget.tsx',
      `import React from 'react';
import { ThemeProvider } from './theme';
export function Widget({ label }: { label: string }) { return <div>{label}</div>; }
export const SampleDefault = () => <ThemeProvider><Widget label="x" /></ThemeProvider>;`,
    );

    // Guard 3: a composite that imports a provider but is NOT mounted by main.tsx.
    io.files.set(
      '/project/src/components/Composite.tsx',
      `import React from 'react';
import { AuthProvider } from '../app/auth/use-auth';
export default function Composite() { return <AuthProvider><div>composite</div></AuthProvider>; }`,
    );

    // Guard 4: main.tsx renders <HostClientProvider> from a DIRECTORY import
    // ('./app/host-client' → entry-root set contains 'src/app/host-client'). A real
    // component living inside that directory has path 'src/app/host-client/<File>',
    // which must NOT match the stripped directory path — directory imports never
    // wrongly exclude their members.
    io.files.set(
      '/project/src/app/host-client/HostClientProvider.tsx',
      `import React from 'react';
export function HostClientProvider({ children }: { children: React.ReactNode }) { return <>{children}</>; }
export const SampleDefault = () => <HostClientProvider><span>x</span></HostClientProvider>;`,
    );

    const manager = createManager(io);
    const content = await manager.ensureComponent(['src/components/Button.tsx']);

    expect(content).not.toContain("'src/app/App.tsx'"); // shell still excluded
    expect(content).toContain("'src/components/LanguageProvider.tsx'");
    expect(content).toContain("'src/components/Widget.tsx'");
    expect(content).toContain("'src/components/Composite.tsx'");
    expect(content).toContain("'src/app/host-client/HostClientProvider.tsx'");
    expect(isValidTypeScript(content)).toBe(true);
  });

  it('purges a persisted provider-shell App.tsx on the fast path (no missing imports)', async () => {
    // Simulate a preview file generated BEFORE this fix shipped: App.tsx is already
    // registered. First gen without the entry file present lets App in; then the
    // entry (index.html + main.tsx) appears and a later ensureComponent for an
    // already-registered component takes the fast path — App must still be purged.
    const io = new InMemoryFileIO();
    io.files.set('/project/package.json', JSON.stringify({ dependencies: { react: '18', vite: '5' } }));
    io.files.set('/project/src/app/App.tsx', APP_TSX);
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);

    // First gen: no index.html/main.tsx yet → App is registered (legacy behavior).
    const before = await createManager(io).ensureComponent(['src/components/Button.tsx', 'src/app/App.tsx']);
    expect(before).toContain("'src/app/App.tsx'");

    // Entry appears. A fresh manager (new session) for an already-registered
    // component takes the fast path — App must still be purged.
    io.files.set('/project/index.html', INDEX_HTML);
    io.files.set('/project/src/main.tsx', MAIN_TSX);
    const after = await createManager(io).ensureComponent(['src/components/Button.tsx']);

    expect(after).not.toContain("'src/app/App.tsx'");
    expect(after).toContain("'src/components/Button.tsx'");
    expect(isValidTypeScript(after)).toBe(true);
  });

  it('does NOT exclude a provider-shell App when no SPA entry file exists (non-SPA / unknown)', async () => {
    // No index.html and no src/main.tsx → _detectSpaEntryFile returns null →
    // entry-root set is empty → the exclusion never fires. App.tsx stays selectable.
    const io = new InMemoryFileIO();
    io.files.set('/project/package.json', '{}');
    io.files.set('/project/src/app/App.tsx', APP_TSX);
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    const manager = createManager(io);

    const content = await manager.ensureComponent(['src/app/App.tsx']);

    expect(content).toContain("'src/app/App.tsx'");
    expect(isValidTypeScript(content)).toBe(true);
  });
});

describe('PreviewFileManager — app-mode (preview as app)', () => {
  const ROUTED_APP_SHELL = `
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
export default function App() {
  return <BrowserRouter><Routes><Route path="/" element={<Home/>} /></Routes></BrowserRouter>;
}`;
  const LEAF = `import React from 'react';
export function Button() { return <button>x</button>; }`;

  it('isAppEntryCandidate: true for a router/provider shell, false for a leaf component', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/App.tsx', ROUTED_APP_SHELL);
    io.files.set('/project/src/Button.tsx', LEAF);
    const manager = createManager(io);
    expect(await manager.isAppEntryCandidate('src/App.tsx')).toBe(true);
    expect(await manager.isAppEntryCandidate('src/Button.tsx')).toBe(false);
  });

  it('isAppEntryCandidate: FALSE for non-pushState routers (Hash/Static/React-Navigation)', async () => {
    // The UI gate must reject routers the address bar cannot drive — the driver only navigates via
    // pushState/location.pathname. Guards against reverting the gate back to broad detectRouterShell.
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/HashApp.tsx',
      `import { HashRouter } from 'react-router-dom';
export default function App() { return <HashRouter><div/></HashRouter>; }`,
    );
    io.files.set(
      '/project/src/StaticApp.tsx',
      `import { StaticRouter } from 'react-router-dom/server';
export default () => <StaticRouter location="/"><div/></StaticRouter>;`,
    );
    io.files.set(
      '/project/src/NativeApp.tsx',
      `import { NavigationContainer } from '@react-navigation/native';
export default () => <NavigationContainer><div/></NavigationContainer>;`,
    );
    const manager = createManager(io);
    expect(await manager.isAppEntryCandidate('src/HashApp.tsx')).toBe(false);
    expect(await manager.isAppEntryCandidate('src/StaticApp.tsx')).toBe(false);
    expect(await manager.isAppEntryCandidate('src/NativeApp.tsx')).toBe(false);
  });

  it('isAppEntryCandidate: false for a provider-importing LEAF that is not the entry root', async () => {
    // A leaf wrapper that merely imports a provider (e.g. QueryClientProvider) but is NOT the
    // SPA entry root must not be offered "preview as app" (it would render raw, wrongly).
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/main.tsx',
      `import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);`,
    );
    io.files.set(
      '/project/src/App.tsx',
      `import { BrowserRouter } from 'react-router-dom';
export default function App() { return <BrowserRouter><div/></BrowserRouter>; }`,
    );
    io.files.set(
      '/project/src/CardList.tsx',
      `import { QueryClientProvider } from '@tanstack/react-query';
export function CardList() { return <QueryClientProvider client={undefined as never}><ul/></QueryClientProvider>; }`,
    );
    const manager = createManager(io);
    // App owns a router → candidate; the provider-only leaf is NOT an entry root → not a candidate.
    expect(await manager.isAppEntryCandidate('src/App.tsx')).toBe(true);
    expect(await manager.isAppEntryCandidate('src/CardList.tsx')).toBe(false);
  });

  it('isAppEntryCandidate: false for an entry root whose router/providers live in main.tsx', async () => {
    // App is the createRoot target but does NOT own a router/provider — main.tsx wraps it.
    // Rendering it raw would crash outside that context, so it must NOT be a candidate.
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/main.tsx',
      `import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
createRoot(document.getElementById('root')!).render(<BrowserRouter><App /></BrowserRouter>);`,
    );
    io.files.set('/project/src/App.tsx', `export default function App() { return <div>home</div>; }`);
    const manager = createManager(io);
    expect(await manager.isAppEntryCandidate('src/App.tsx')).toBe(false);
  });

  it('isAppEntryCandidate: false for a PROVIDER-shell entry root whose ROUTER is in main.tsx', async () => {
    // The exact split the review flagged: main.tsx owns <BrowserRouter>, App owns only providers
    // + <Routes>. App IS the createRoot entry root AND a provider shell, but it does NOT own the
    // router — raw-rendering it crashes ("useRoutes may be used only in the context of a Router").
    // Router-only gating must reject it.
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/main.tsx',
      `import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
createRoot(document.getElementById('root')!).render(<BrowserRouter><App /></BrowserRouter>);`,
    );
    io.files.set(
      '/project/src/App.tsx',
      `import { AuthProvider } from './AuthProvider';
import { Routes, Route } from 'react-router-dom';
export default function App() {
  return <AuthProvider><Routes><Route path="/" element={<Home/>} /></Routes></AuthProvider>;
}`,
    );
    const manager = createManager(io);
    // Imports Routes/Route + AuthProvider but NOT BrowserRouter → not a router shell → rejected.
    expect(await manager.isAppEntryCandidate('src/App.tsx')).toBe(false);
  });

  it('isAppEntryCandidate: true for a PATCHED (@hyperide-managed) router root — drives app-mode B', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/App.tsx',
      `import P from './__canvas_preview__'; // @hyperide-managed\n${ROUTED_APP_SHELL}`,
    );
    const manager = createManager(io);
    expect(await manager.isAppEntryCandidate('src/App.tsx')).toBe(true);
  });

  it('isAppEntryCandidate: false for a traversal / absolute path (no read outside project root)', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/App.tsx', ROUTED_APP_SHELL);
    const manager = createManager(io);
    expect(await manager.isAppEntryCandidate('../../../etc/passwd')).toBe(false);
    expect(await manager.isAppEntryCandidate('/etc/passwd')).toBe(false);
    expect(await manager.isAppEntryCandidate('src/../../secret/Evil.tsx')).toBe(false);
  });

  it('enableAppEntry puts a clean router root into the generated appEntrySet (app-mode A)', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/App.tsx', ROUTED_APP_SHELL);
    io.files.set('/project/src/Button.tsx', LEAF);
    const manager = createManager(io);
    manager.enableAppEntry('src/App.tsx');
    const content = await manager.forceRefreshComponent('src/App.tsx');
    expect(content).toContain("const appEntrySet = new Set<string>([\n  'src/App.tsx',\n]);");
    expect(isValidTypeScript(content)).toBe(true);
  });

  it('ensureComponent fast path regenerates when app-mode is toggled (appEntrySet mismatch)', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/App.tsx', ROUTED_APP_SHELL);
    io.files.set('/project/src/Button.tsx', LEAF);
    const manager = createManager(io);
    // First build in component-mode — App is a router shell, excluded; only Button registers.
    const before = await manager.ensureComponent(['src/Button.tsx']);
    expect(before).toContain('const appEntrySet = new Set<string>([\n]);');
    // Enable app-mode for App and ensure again — the fast path must NOT short-circuit.
    manager.enableAppEntry('src/App.tsx');
    const after = await manager.ensureComponent(['src/Button.tsx']);
    expect(after).toContain("'src/App.tsx',");
  });
});

describe('PreviewFileManager — app-mode B (patched router root) no regen churn', () => {
  const PATCHED_ROOT = `import P from './__canvas_preview__'; // @hyperide-managed
import { BrowserRouter, Routes, Route } from 'react-router-dom';
export default function App() {
  return <BrowserRouter><Routes><Route path="/" element={<H/>} /></Routes></BrowserRouter>;
}`;
  const LEAF = `import React from 'react';
export function Button() { return <button>x</button>; }`;

  it('a patched (managed) app entry never enters appEntrySet and does not force perpetual regen', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/App.tsx', PATCHED_ROOT);
    io.files.set('/project/src/Button.tsx', LEAF);
    const manager = createManager(io);
    // Enable app-mode for the patched root, then build once.
    manager.enableAppEntry('src/App.tsx');
    const first = await manager.ensureComponent(['src/Button.tsx']);
    // Patched root is excluded from the registry (managed marker) — appEntrySet stays empty.
    expect(first).toContain('const appEntrySet = new Set<string>([\n]);');
    // A second ensureComponent must NOT regenerate (no app-entry mismatch churn): identical content.
    const second = await manager.ensureComponent(['src/Button.tsx']);
    expect(second).toBe(first);
  });
});

describe('PreviewFileManager.isAppEntryCandidate', () => {
  const BROWSER_ROUTER_APP = `import { BrowserRouter, Routes, Route } from 'react-router-dom';
export default function App() {
  return <BrowserRouter><Routes><Route path="/" element={<Home/>} /></Routes></BrowserRouter>;
}`;

  // react-router v6.4+ data-router root: config via createBrowserRouter, mounted via RouterProvider.
  // This is the shape the foundation's detectRouterShell missed; fix #2 makes it a candidate.
  const DATA_ROUTER_APP = `import { createBrowserRouter, RouterProvider } from 'react-router-dom';
const router = createBrowserRouter([
  { path: '/', element: <Home/> },
  { path: '/settings', element: <Settings/> },
]);
export default function App() { return <RouterProvider router={router} />; }`;

  const PROVIDER_ONLY_APP = `import { AuthProvider } from './auth';
export default function App() { return <AuthProvider><Dashboard/></AuthProvider>; }`;

  const LEAF = `import React from 'react';
export default function Button() { return <button>x</button>; }`;

  it('returns true for a <BrowserRouter> root', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/App.tsx', BROWSER_ROUTER_APP);
    const manager = createManager(io);
    expect(await manager.isAppEntryCandidate('src/App.tsx')).toBe(true);
  });

  it('returns true for a data-router root (createBrowserRouter + RouterProvider)', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/App.tsx', DATA_ROUTER_APP);
    const manager = createManager(io);
    expect(await manager.isAppEntryCandidate('src/App.tsx')).toBe(true);
  });

  it('returns false for a provider-only root (router lives elsewhere — would crash rendered raw)', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/App.tsx', PROVIDER_ONLY_APP);
    const manager = createManager(io);
    expect(await manager.isAppEntryCandidate('src/App.tsx')).toBe(false);
  });

  it('returns false for an ordinary leaf component', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/Button.tsx', LEAF);
    const manager = createManager(io);
    expect(await manager.isAppEntryCandidate('src/Button.tsx')).toBe(false);
  });

  it('returns false for an unreadable path (best-effort, never throws)', async () => {
    const io = new InMemoryFileIO();
    const manager = createManager(io);
    expect(await manager.isAppEntryCandidate('src/Missing.tsx')).toBe(false);
  });

  it('returns false for a path that escapes the project root (defense in depth)', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/App.tsx', BROWSER_ROUTER_APP);
    const manager = createManager(io);
    expect(await manager.isAppEntryCandidate('../secrets/App.tsx')).toBe(false);
  });

  it('KNOWN LIMITATION: a SPLIT data-router root (router config in a sibling file) is not detected', async () => {
    // App.tsx renders <RouterProvider router={router} /> but imports `router` from ./router, which
    // is where createBrowserRouter lives. The data-router signal requires BOTH the browser/hash
    // builder AND a RouterProvider in the SAME file; here App.tsx has only the provider and
    // router.tsx has only the builder, so neither is a candidate. isAppEntryCandidate also scans
    // only the selected file's own imports (no cross-file resolution — mirrors
    // _resolveEntryRootComponentPaths, which follows only DIRECT entry imports, never a sibling).
    // Resolving local router imports is a deferred follow-up; the common case (createBrowserRouter
    // AND RouterProvider together in App.tsx) is covered by the data-router test above.
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/App.tsx',
      `import { RouterProvider } from 'react-router-dom';
import { router } from './router';
export default function App() { return <RouterProvider router={router} />; }`,
    );
    io.files.set(
      '/project/src/router.tsx',
      `import { createBrowserRouter } from 'react-router-dom';
export const router = createBrowserRouter([{ path: '/', element: <Home/> }]);`,
    );
    const manager = createManager(io);
    // App.tsx: RouterProvider only (no builder) → not a candidate.
    expect(await manager.isAppEntryCandidate('src/App.tsx')).toBe(false);
    // router.tsx: builder only (no RouterProvider, no component) → correctly NOT a candidate either.
    expect(await manager.isAppEntryCandidate('src/router.tsx')).toBe(false);
  });
});
