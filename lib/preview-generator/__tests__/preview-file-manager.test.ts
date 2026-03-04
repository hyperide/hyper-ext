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
  it('should reject component paths with ".." segments', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    // This path tries to escape projectRoot
    io.files.set('/etc/passwd', 'root:x:0:0:root');
    const manager = createManager(io);

    // Only the traversal path — should throw because no valid components remain
    await expect(manager.ensureComponent(['../../../etc/passwd'])).rejects.toThrow(PreviewGenerationError);
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

    // Should not throw — Broken component should be included with fallback name
    const content = await manager.ensureComponent(['src/components/Broken.tsx', 'src/components/Button.tsx']);
    expect(content).toContain('Button');
    // Broken should still be registered (with filename-derived name)
    expect(content).toContain('Broken');
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
