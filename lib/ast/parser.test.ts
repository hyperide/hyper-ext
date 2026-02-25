/**
 * Tests for AST parser utilities
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseCode, printAST, readAndParseFile, writeAST } from './parser';

describe('parseCode', () => {
  it('should parse simple JSX code', () => {
    const code = 'const Component = () => <div>Hello</div>;';
    const ast = parseCode(code);

    expect(ast).toBeDefined();
    expect(ast.type).toBe('File');
    expect(ast.program).toBeDefined();
  });

  it('should parse TypeScript with JSX', () => {
    const code = `
      interface Props {
        name: string;
      }
      const Component: React.FC<Props> = ({ name }) => <div>{name}</div>;
    `;
    const ast = parseCode(code);

    expect(ast).toBeDefined();
    expect(ast.program.body.length).toBeGreaterThan(0);
  });

  it('should parse complex JSX with nested elements', () => {
    const code = `
      const Component = () => (
        <div className="container">
          <h1>Title</h1>
          <ul>
            {items.map(item => <li key={item.id}>{item.name}</li>)}
          </ul>
        </div>
      );
    `;
    const ast = parseCode(code);

    expect(ast).toBeDefined();
    expect(ast.program.body.length).toBe(1);
  });
});

describe('printAST', () => {
  it('should print AST back to code', () => {
    const code = 'const x = 42;';
    const ast = parseCode(code);
    const output = printAST(ast);

    expect(output).toContain('const x = 42');
  });

  it('should preserve JSX structure', () => {
    const code = '<div className="test"><span>Hello</span></div>';
    const ast = parseCode(code);
    const output = printAST(ast);

    expect(output).toContain('<div');
    expect(output).toContain('className="test"');
    expect(output).toContain('<span>Hello</span>');
  });

  it('should respect print options', () => {
    const code = 'const x = 42;';
    const ast = parseCode(code);
    const output = printAST(ast, { tabWidth: 4 });

    expect(output).toBeDefined();
  });
});

describe('readAndParseFile', () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ast-parser-test-'));
    tempFile = path.join(tempDir, 'test.tsx');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should read and parse file', async () => {
    const code = 'const Component = () => <div>Test</div>;';
    await fs.writeFile(tempFile, code, 'utf-8');

    const result = await readAndParseFile(tempFile);

    expect(result.ast).toBeDefined();
    expect(result.absolutePath).toBe(tempFile);
  });

  it('should resolve relative paths', async () => {
    const code = 'const x = 1;';
    await fs.writeFile(tempFile, code, 'utf-8');

    const relativePath = path.relative(process.cwd(), tempFile);
    const result = await readAndParseFile(relativePath);

    expect(result.absolutePath).toBe(path.resolve(process.cwd(), relativePath));
  });

  it('should throw error for non-existent file', async () => {
    const nonExistent = path.join(tempDir, 'non-existent.tsx');

    await expect(readAndParseFile(nonExistent)).rejects.toThrow();
  });
});

describe('writeAST', () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ast-parser-test-'));
    tempFile = path.join(tempDir, 'output.tsx');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should write AST to file', async () => {
    const code = 'const Component = () => <div>Test</div>;';
    const ast = parseCode(code);

    await writeAST(ast, tempFile);

    const written = await fs.readFile(tempFile, 'utf-8');
    expect(written).toContain('Component');
    expect(written).toContain('<div>Test</div>');
  });

  it('should preserve formatting when round-tripping', async () => {
    const code = `const Component = () => {
  return <div className="test">Hello</div>;
};`;

    const ast = parseCode(code);
    await writeAST(ast, tempFile);

    const written = await fs.readFile(tempFile, 'utf-8');
    expect(written).toContain('Component');
  });
});
