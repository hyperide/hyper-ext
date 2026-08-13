/**
 * Tests for AST parser utilities
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as t from '@babel/types';
import { parseCode, printAST, spliceNodeSource, spliceStringLiteralValue } from './parser';
import { readAndParseFile, writeAST } from './parser.node';

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

describe('spliceStringLiteralValue (HYP-877)', () => {
  // Parse `source`, grab the FIRST static className literal via the real parser (so start offsets
  // and extra.raw come from the same normalization path production uses), splice `newValue` in.
  function spliceClassName(source: string, newValue: string): string | null {
    const ast = parseCode(source);
    let literal: t.StringLiteral | null = null;
    t.traverseFast(ast, (node) => {
      if (
        !literal &&
        t.isJSXAttribute(node) &&
        t.isJSXIdentifier(node.name) &&
        node.name.name === 'className' &&
        t.isStringLiteral(node.value)
      ) {
        literal = node.value;
      }
    });
    if (!literal) throw new Error('no className literal found');
    const found: t.StringLiteral = literal;
    const raw = (found.extra as { raw?: unknown } | undefined)?.raw;
    if (typeof raw !== 'string' || typeof found.start !== 'number') throw new Error('no raw/start');
    return spliceStringLiteralValue(source, raw, found.start, newValue);
  }

  it('replaces only the literal contents and keeps the original quote char', () => {
    const source = 'const x = <div className="a b">Hi</div>;\n';
    expect(spliceClassName(source, 'c d')).toBe('const x = <div className="c d">Hi</div>;\n');
  });

  it('locates the literal on CRLF sources despite LF-normalized offsets', () => {
    const source = 'const y = 1;\r\nconst x = <div className="a b">Hi</div>;\r\n';
    expect(spliceClassName(source, 'c')).toBe('const y = 1;\r\nconst x = <div className="c">Hi</div>;\r\n');
  });

  it('locates the literal on tab-indented sources via unique-occurrence search', () => {
    const source = 'function F() {\n\treturn <div className="a b">Hi</div>;\n}\n';
    expect(spliceClassName(source, 'c')).toBe('function F() {\n\treturn <div className="c">Hi</div>;\n}\n');
  });

  it('uses the exact offset to disambiguate duplicate literals on a clean LF source', () => {
    // Two byte-identical className literals: the unique-occurrence search alone would refuse, so
    // the trustworthy-offset fast path must select the requested (first) one.
    const source = 'const x = <div className="a"><span className="a">Hi</span></div>;\n';
    expect(spliceClassName(source, 'c')).toBe('const x = <div className="c"><span className="a">Hi</span></div>;\n');
  });

  it('locates the literal on mixed CRLF + tab sources via unique-occurrence search', () => {
    // CRLF shrinkage makes the normalized offset undershoot the raw position, hiding the tab from
    // a normalizedStart-sliced prefix check — the candidate-based tab check must still refuse the
    // fast path and fall through to the unique search (review round 3).
    const source = 'function F() {\r\n\treturn <div className="a b">Hi</div>;\r\n}\r\n';
    expect(spliceClassName(source, 'c')).toBe('function F() {\r\n\treturn <div className="c">Hi</div>;\r\n}\r\n');
  });

  it('returns null on a mixed CRLF + tab source when the literal text is ambiguous', () => {
    const source = 'function F() {\r\n\treturn <div className="a"><span className="a">Hi</span></div>;\r\n}\r\n';
    expect(spliceClassName(source, 'c')).toBeNull();
  });

  it('returns null on a tab-shifted source when the literal text is ambiguous', () => {
    // Two identical literals + tab indentation: offsets are shifted and the text occurs twice, so
    // no candidate can be verified — the splice must refuse rather than guess.
    const source = 'function F() {\n\treturn <div className="a"><span className="a">Hi</span></div>;\n}\n';
    expect(spliceClassName(source, 'c')).toBeNull();
  });

  it('switches to the alternate quote when the value contains the original quote', () => {
    const source = "const x = <div className='a'>Hi</div>;\n";
    expect(spliceClassName(source, "bg-[url('x.png')]")).toBe(
      'const x = <div className="bg-[url(\'x.png\')]">Hi</div>;\n',
    );
  });

  it('returns null when the value contains both quote chars', () => {
    const source = 'const x = <div className="a">Hi</div>;\n';
    expect(spliceClassName(source, 'content-[\'"\']')).toBeNull();
  });

  it('returns null when the value contains a backslash or line break', () => {
    const source = 'const x = <div className="a">Hi</div>;\n';
    expect(spliceClassName(source, 'content-[\\2014]')).toBeNull();
    expect(spliceClassName(source, 'a\nb')).toBeNull();
  });

  it('returns null when originalRaw is not a quoted literal', () => {
    expect(spliceStringLiteralValue('const x = 1;', 'x', 6, 'y')).toBeNull();
    expect(spliceStringLiteralValue('const x = 1;', '"unterminated', 6, 'y')).toBeNull();
  });
});

describe('recast offset normalization premise (HYP-877)', () => {
  // The whole guard/verify design rests on this: recast normalizes the source BEFORE parsing, so
  // AST offsets index the normalized text, not the raw bytes. If a recast upgrade ever stops
  // tab-expanding/CRLF-joining, these assertions flip and the guards can be revisited.
  it('AST offsets are tab-expanded and CRLF-joined, drifting from raw byte offsets', () => {
    const tabbed = 'function F() {\n\treturn "hi";\n}\n';
    const tabbedAst = parseCode(tabbed);
    const fn = tabbedAst.program.body[0] as t.FunctionDeclaration;
    const ret = fn.body.body[0] as t.ReturnStatement;
    const tabbedLiteral = ret.argument as t.StringLiteral;
    expect(tabbedLiteral.start).not.toBe(tabbed.indexOf('"hi"')); // tab expanded to tabWidth spaces

    const crlf = 'const y = 1;\r\nconst x = "hi";\r\n';
    const crlfAst = parseCode(crlf);
    const decl = crlfAst.program.body[1] as t.VariableDeclaration;
    const crlfLiteral = decl.declarations[0].init as t.StringLiteral;
    expect(crlfLiteral.start).not.toBe(crlf.indexOf('"hi"')); // \r\n counted as one char
  });
});

describe('spliceNodeSource offset-drift guard (HYP-877)', () => {
  it('refuses CRLF and tab sources whose normalized offsets misindex the raw bytes', () => {
    const crlf = 'const y = 1;\r\nconst x = <div className={cn("a")}>Hi</div>;\r\n';
    const tabbed = 'function F() {\n\treturn <div className={cn("a")}>Hi</div>;\n}\n';
    for (const source of [crlf, tabbed]) {
      const ast = parseCode(source);
      const stmt = ast.program.body[source === tabbed ? 0 : 1];
      expect(spliceNodeSource(source, stmt, stmt.start ?? 0, stmt.end ?? 0)).toBeNull();
    }
  });

  it('keeps the surgical path when tabs occur only AFTER the spliced span', () => {
    const source = 'const x = <div className={cn("a")}>Hi</div>;\nconst s = "tab:\t";\n';
    const ast = parseCode(source);
    const stmt = ast.program.body[0];
    const spliced = spliceNodeSource(source, stmt, stmt.start ?? 0, stmt.end ?? 0);
    expect(spliced).not.toBeNull();
    expect(spliced).toContain('const s = "tab:\t";');
  });
});
