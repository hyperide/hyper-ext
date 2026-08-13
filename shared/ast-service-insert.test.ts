import { beforeEach, describe, expect, it } from 'bun:test';

/**
 * Tests for AstService.insertElement + _ensureImport.
 *
 * Uses real Babel parser/traverser (not mocked) since we're testing
 * AST manipulation correctness. Only file I/O is mocked.
 */

// In-memory filesystem for AST operations
const files: Record<string, string> = {};

const mockFileIO = {
  readFile: async (path: string) => {
    const content = files[path];
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  },
  writeFile: async (path: string, content: string) => {
    files[path] = content;
  },
  access: async (path: string) => {
    if (!(path in files)) throw new Error(`ENOENT: ${path}`);
  },
};

const { AstService } = await import('../vscode-extension/hypercanvas-preview/src/services/AstService');

/** Match import statement regardless of quote style (recast uses double quotes) */
function importPattern(specifier: string, path: string): RegExp {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test-only helper, inputs are hardcoded string literals
  return new RegExp(`import \\{ ${specifier} \\} from ['"]${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
}

describe('AstService.insertElement', () => {
  let service: InstanceType<typeof AstService>;

  beforeEach(() => {
    for (const key of Object.keys(files)) {
      delete files[key];
    }
    service = new AstService('/workspace', mockFileIO);
  });

  it('inserts a native HTML element as child of parent', async () => {
    files['/workspace/src/App.tsx'] = `
import React from 'react';

export function App() {
  return (
    <div data-uniq-id="root-1">
      <p data-uniq-id="p-1">Hello</p>
    </div>
  );
}
`;

    const result = await service.insertElement('src/App.tsx', 'root-1', 'span', { className: 'text-red' });

    expect(result.success).toBe(true);
    expect(result.newId).toBeTruthy();

    const output = files['/workspace/src/App.tsx'];
    expect(output).toContain('<span');
    expect(output).toContain('className="text-red"');
    expect(output).toContain(`data-uniq-id="${result.newId}"`);
  });

  it('does not add import for lowercase (native) elements', async () => {
    files['/workspace/src/App.tsx'] = `
import React from 'react';

export function App() {
  return <div data-uniq-id="root-1"></div>;
}
`;

    await service.insertElement('src/App.tsx', 'root-1', 'button', {});

    const output = files['/workspace/src/App.tsx'];
    const importLines = output.split('\n').filter((l: string) => l.includes('import'));
    expect(importLines).toHaveLength(1);
  });

  it('adds named import for PascalCase component', async () => {
    files['/workspace/src/App.tsx'] = `
import React from 'react';

export function App() {
  return <div data-uniq-id="root-1"></div>;
}
`;

    await service.insertElement(
      'src/App.tsx',
      'root-1',
      'Button',
      {},
      undefined,
      undefined,
      'src/components/Button.tsx',
    );

    const output = files['/workspace/src/App.tsx'];
    expect(output).toMatch(importPattern('Button', './components/Button'));
    expect(output).toContain('<Button');
  });

  it('does not duplicate import if component is already imported', async () => {
    files['/workspace/src/App.tsx'] = `
import React from 'react';
import { Card } from './components/Card';

export function App() {
  return <div data-uniq-id="root-1"><Card data-uniq-id="c-1" /></div>;
}
`;

    await service.insertElement('src/App.tsx', 'root-1', 'Card', {});

    const output = files['/workspace/src/App.tsx'];
    const cardImports = output.split('\n').filter((l: string) => l.includes('import') && l.includes('Card'));
    expect(cardImports).toHaveLength(1);
  });

  it('calculates relative import path correctly for nested files', async () => {
    files['/workspace/src/pages/Dashboard.tsx'] = `
import React from 'react';

export function Dashboard() {
  return <div data-uniq-id="root-1"></div>;
}
`;

    await service.insertElement(
      'src/pages/Dashboard.tsx',
      'root-1',
      'Header',
      {},
      undefined,
      undefined,
      'src/components/Header.tsx',
    );

    const output = files['/workspace/src/pages/Dashboard.tsx'];
    expect(output).toMatch(importPattern('Header', '../components/Header'));
  });

  it('infers import path from existing component imports when no componentFilePath', async () => {
    files['/workspace/src/App.tsx'] = `
import React from 'react';
import { Button } from './ui/Button';

export function App() {
  return <div data-uniq-id="root-1"><Button data-uniq-id="b-1">Click</Button></div>;
}
`;

    await service.insertElement('src/App.tsx', 'root-1', 'Card', {});

    const output = files['/workspace/src/App.tsx'];
    expect(output).toMatch(importPattern('Card', './ui/Card'));
  });

  it('inserts import after last existing import', async () => {
    files['/workspace/src/App.tsx'] = `
import React from 'react';
import { useState } from 'react';

export function App() {
  return <div data-uniq-id="root-1"></div>;
}
`;

    await service.insertElement(
      'src/App.tsx',
      'root-1',
      'MyComponent',
      {},
      undefined,
      undefined,
      'src/components/MyComponent.tsx',
    );

    const output = files['/workspace/src/App.tsx'];
    const lines = output.split('\n');
    const importIndices = lines
      .map((l: string, i: number) => (l.includes('import') ? i : -1))
      .filter((i: number) => i >= 0);
    const myCompIdx = lines.findIndex((l: string) => l.includes('MyComponent') && l.includes('import'));

    expect(myCompIdx).toBeGreaterThan(-1);
    expect(myCompIdx).toBe(Math.max(...importIndices));
  });

  it('returns error when parent element not found', async () => {
    files['/workspace/src/App.tsx'] = `
import React from 'react';

export function App() {
  return <div data-uniq-id="root-1"></div>;
}
`;

    const result = await service.insertElement('src/App.tsx', 'nonexistent', 'span', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('strips file extension from import path', async () => {
    files['/workspace/src/App.tsx'] = `
import React from 'react';

export function App() {
  return <div data-uniq-id="root-1"></div>;
}
`;

    await service.insertElement(
      'src/App.tsx',
      'root-1',
      'Avatar',
      {},
      undefined,
      undefined,
      'src/components/Avatar.jsx',
    );

    const output = files['/workspace/src/App.tsx'];
    expect(output).toMatch(/['"]\.\/components\/Avatar['"]/);
    expect(output).not.toContain('.jsx');
  });
});
