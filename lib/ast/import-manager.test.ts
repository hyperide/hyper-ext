/**
 * Tests for import-manager - import management utilities
 */

import { describe, expect, it } from 'bun:test';
import { ensureImport, inferImportDir, isImported, resolveImportPath } from './import-manager';
import { parseCode, printAST } from './parser';

describe('isImported', () => {
  it('should return true for named import', () => {
    const ast = parseCode("import { Button } from './components/Button';");
    expect(isImported(ast, 'Button')).toBe(true);
  });

  it('should return true for default import', () => {
    const ast = parseCode("import React from 'react';");
    expect(isImported(ast, 'React')).toBe(true);
  });

  it('should return false for missing import', () => {
    const ast = parseCode("import { Button } from './components/Button';");
    expect(isImported(ast, 'Card')).toBe(false);
  });

  it('should return false for empty file', () => {
    const ast = parseCode('const x = 1;');
    expect(isImported(ast, 'Button')).toBe(false);
  });
});

describe('resolveImportPath', () => {
  it('should compute relative path from same directory', () => {
    const result = resolveImportPath('/workspace/src/App.tsx', '/workspace/src/Button.tsx');
    expect(result).toBe('./Button');
  });

  it('should compute relative path for sibling directories', () => {
    const result = resolveImportPath('/workspace/src/pages/Home.tsx', '/workspace/src/components/Button.tsx');
    expect(result).toBe('../components/Button');
  });

  it('should strip .tsx extension', () => {
    const result = resolveImportPath('/workspace/src/App.tsx', '/workspace/src/components/Card.tsx');
    expect(result).toBe('./components/Card');
  });

  it('should strip .jsx extension', () => {
    const result = resolveImportPath('/workspace/src/App.tsx', '/workspace/src/Avatar.jsx');
    expect(result).toBe('./Avatar');
  });

  it('should strip .ts extension', () => {
    const result = resolveImportPath('/workspace/src/App.tsx', '/workspace/src/utils.ts');
    expect(result).toBe('./utils');
  });

  it('should use forward slashes', () => {
    const result = resolveImportPath('/workspace/src/App.tsx', '/workspace/src/deep/nested/Thing.tsx');
    expect(result).not.toContain('\\');
    expect(result).toBe('./deep/nested/Thing');
  });
});

describe('inferImportDir', () => {
  it('should infer directory from existing PascalCase imports', () => {
    const ast = parseCode(`
      import React from 'react';
      import { Button } from './ui/Button';

      export function App() { return <div />; }
    `);

    expect(inferImportDir(ast)).toBe('./ui');
  });

  it('should return default when no PascalCase imports found', () => {
    const ast = parseCode(`
      import React from 'react';
      const x = 1;
    `);

    expect(inferImportDir(ast)).toBe('../components');
  });

  it('should use first matching import', () => {
    const ast = parseCode(`
      import { Header } from '../shared/Header';
      import { Footer } from './layout/Footer';
    `);

    expect(inferImportDir(ast)).toBe('../shared');
  });
});

describe('ensureImport', () => {
  it('should add named import with explicit path', () => {
    const ast = parseCode(`
import React from 'react';

export function App() { return <div />; }
    `);

    ensureImport(ast, {
      componentName: 'Button',
      targetFilePath: '/workspace/src/App.tsx',
      componentFilePath: '/workspace/src/components/Button.tsx',
    });

    const output = printAST(ast);
    expect(output).toContain('import { Button }');
    expect(output).toMatch(/['"]\.\/components\/Button['"]/);
  });

  it('should not duplicate existing import', () => {
    const ast = parseCode(`
import React from 'react';
import { Button } from './components/Button';

export function App() { return <div />; }
    `);

    ensureImport(ast, {
      componentName: 'Button',
      targetFilePath: '/workspace/src/App.tsx',
      componentFilePath: '/workspace/src/components/Button.tsx',
    });

    const output = printAST(ast);
    const buttonImports = output.split('\n').filter((l: string) => l.includes('import') && l.includes('Button'));
    expect(buttonImports).toHaveLength(1);
  });

  it('should insert after last import', () => {
    const ast = parseCode(`
import React from 'react';
import { useState } from 'react';

export function App() { return <div />; }
    `);

    ensureImport(ast, {
      componentName: 'Card',
      targetFilePath: '/workspace/src/App.tsx',
      componentFilePath: '/workspace/src/components/Card.tsx',
    });

    const output = printAST(ast);
    const lines = output.split('\n');
    const importIndices = lines
      .map((l: string, i: number) => (l.includes('import') ? i : -1))
      .filter((i: number) => i >= 0);
    const cardIdx = lines.findIndex((l: string) => l.includes('Card') && l.includes('import'));

    expect(cardIdx).toBeGreaterThan(-1);
    expect(cardIdx).toBe(Math.max(...importIndices));
  });

  it('should infer import path from existing imports when no componentFilePath', () => {
    const ast = parseCode(`
import React from 'react';
import { Button } from './ui/Button';

export function App() { return <div />; }
    `);

    ensureImport(ast, {
      componentName: 'Card',
      targetFilePath: '/workspace/src/App.tsx',
    });

    const output = printAST(ast);
    expect(output).toMatch(/['"]\.\/ui\/Card['"]/);
  });

  it('should resolve relative componentFilePath using workspaceRoot', () => {
    const ast = parseCode(`
import React from 'react';

export function App() { return <div />; }
    `);

    ensureImport(ast, {
      componentName: 'Widget',
      targetFilePath: '/workspace/src/App.tsx',
      componentFilePath: 'src/shared/Widget.tsx',
      workspaceRoot: '/workspace',
    });

    const output = printAST(ast);
    expect(output).toMatch(/['"]\.\/shared\/Widget['"]/);
  });
});
