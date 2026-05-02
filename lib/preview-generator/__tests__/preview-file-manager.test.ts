import { describe, expect, it } from 'bun:test';
import type { FileIO } from '../../ast/file-io';
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
      expect(content).not.toContain('Missing');
    });

    it('should throw PreviewGenerationError when no valid components', async () => {
      const io = new InMemoryFileIO();
      const manager = createManager(io);

      await expect(manager.ensureComponent(['src/components/NoExist.tsx'])).rejects.toThrow(PreviewGenerationError);
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
    expect(result).toBe('ok');

    const routeFile = io.files.get('/project/app/test-preview/page.tsx');
    expect(routeFile).toBeDefined();
    expect(routeFile).toContain('@hyperide-managed');
    expect(routeFile).toContain('CanvasPreview');
    expect(routeFile).toContain('useSearchParams');

    const layoutFile = io.files.get('/project/app/test-preview/layout.tsx');
    expect(layoutFile).toBeDefined();
    expect(layoutFile).toContain('@hyperide-managed');
  });

  it('skips route file if it already exists with @hyperide-managed', async () => {
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

    // File should remain unchanged
    expect(io.files.get('/project/app/test-preview/page.tsx')).toBe(existingContent);
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
});

describe('PreviewFileManager.ensureGitExclude', () => {
  it('creates .git/info/exclude with all entries when file is missing', async () => {
    const io = new InMemoryFileIO();
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.ensureGitExclude();

    const content = io.files.get('/project/.git/info/exclude');
    expect(content).toContain('# HyperIDE — generated preview files');
    expect(content).toContain('src/__canvas_preview__.tsx');
    expect(content).toContain('src/__canvas_preview_standalone__.tsx');
    expect(content).toContain('**/test-preview/');
    expect(content).toContain('**/test-preview.tsx');
  });

  it('appends missing entries to existing exclude file', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/.git/info/exclude', '# existing\n*.log\n');
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.ensureGitExclude();

    const content = io.files.get('/project/.git/info/exclude');
    expect(content).toContain('# existing');
    expect(content).toContain('*.log');
    expect(content).toContain('src/__canvas_preview__.tsx');
  });

  it('is idempotent — does not duplicate entries', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/.git/info/exclude',
      '# HyperIDE — generated preview files\nsrc/__canvas_preview__.tsx\nsrc/__canvas_preview_standalone__.tsx\n**/test-preview/\n**/test-preview.tsx\n',
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
      "// @hyperide-managed\nimport Button from './components/Button';\nconst previewFallbackProps = {};\nexport default function CanvasPreview() {}",
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
