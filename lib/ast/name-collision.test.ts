/**
 * HYP-785: the WRITE/mutation AST path must not crash on a top-level name collision.
 *
 * A Remix `app/root.tsx` can legitimately collide a top-level import with an export of the same name
 * (`import { Layout } from 'antd'` + Remix's exported `Layout` document shell). `@babel/parser`
 * tolerates it, but `@babel/traverse`'s scope crawl throws on it. The READ path was fixed in
 * #542/#543 (HYP-784); this guards the WRITE/mutation siblings: element resolution, insert, wrap,
 * paste, cross-file move (orphan-import prune) and the nodeRef map that feeds every mutation.
 */

import { describe, expect, it } from 'bun:test';
import { buildNodeMap } from '../element-tracing/node-map-builder';
import { pruneOrphanImports } from './jsx-deps';
import { duplicateElementInAST, insertElementIntoAST, parseTSXElements, wrapElementInAST } from './operations';
import { parseCode, printAST } from './parser';
import { findElementByPosition } from './position-finder';

// `import { Layout }` collides with `export function Layout` — a genuine top-level duplicate
// declaration. The App component (the realistic edit target) lives below it.
const COLLISION_SOURCE = `import { Layout } from 'antd';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

export default function App() {
  return (
    <div className="app">
      <h1>Hello</h1>
      <p>World</p>
    </div>
  );
}
`;
// App's <div className="app"> opens at line 13, column 4 (0-based).
const APP_DIV_LINE = 13;
const APP_DIV_COL = 4;

describe('HYP-785 — write/mutation path tolerates a top-level name collision', () => {
  it('parseCode tolerates the collision (precondition)', () => {
    expect(() => parseCode(COLLISION_SOURCE)).not.toThrow();
  });

  it('findElementByPosition resolves the App div (every mutation resolves through here)', () => {
    const ast = parseCode(COLLISION_SOURCE);
    const result = findElementByPosition(ast, APP_DIV_LINE, APP_DIV_COL);
    expect(result).not.toBeNull();
    expect(result?.element.openingElement.name).toHaveProperty('name', 'div');
  });

  it('insertElementIntoAST (root return) does not throw and inserts', () => {
    const ast = parseCode(COLLISION_SOURCE);
    const { elements } = parseTSXElements('<button>Added</button>');
    const { inserted } = insertElementIntoAST(ast, { parent: null, newElement: elements[0] });
    expect(inserted).toBe(true);
    // Root insert targets the FIRST JSX-returning function by design — here that's `Layout`'s
    // `<html>` return (the realistic "insert into a selected element" flow is covered by the
    // resolved-parent test below). The point of this case is that the root walk no longer throws.
    const out = printAST(ast);
    expect(out).toContain('<button>Added</button>');
    expect(out).toMatch(/<html[\s\S]*<button>Added<\/button>[\s\S]*<\/html>/);
  });

  it('insertElementIntoAST into a resolved parent element works', () => {
    const ast = parseCode(COLLISION_SOURCE);
    const parent = findElementByPosition(ast, APP_DIV_LINE, APP_DIV_COL);
    expect(parent).not.toBeNull();
    const { elements } = parseTSXElements('<span>child</span>');
    const { inserted } = insertElementIntoAST(ast, { parent, newElement: elements[0] });
    expect(inserted).toBe(true);
    expect(printAST(ast)).toContain('<span>child</span>');
  });

  it('wrapElementInAST wraps a resolved element', () => {
    const ast = parseCode(COLLISION_SOURCE);
    const target = findElementByPosition(ast, APP_DIV_LINE, APP_DIV_COL);
    expect(target).not.toBeNull();
    const { wrapped } = wrapElementInAST(target as NonNullable<typeof target>, 'section');
    expect(wrapped).toBe(true);
    const out = printAST(ast);
    expect(out).toContain('<section>');
    expect(out).toContain('className="app"');
  });

  it('duplicateElementInAST duplicates a resolved element', () => {
    const ast = parseCode(COLLISION_SOURCE);
    // The <h1> at line 14, col 6 — a child whose parent is the App div.
    const target = findElementByPosition(ast, 14, 6);
    expect(target).not.toBeNull();
    const { inserted } = duplicateElementInAST(target as NonNullable<typeof target>);
    expect(inserted).toBe(true);
    // Two <h1>Hello</h1> after duplication.
    expect(printAST(ast).match(/<h1>Hello<\/h1>/g)?.length).toBe(2);
  });

  it('parseTSXElements (paste snippet parse) works alongside a collision file', () => {
    const { elements } = parseTSXElements('<button>Pasted</button>');
    expect(elements).toHaveLength(1);
    expect(elements[0].openingElement.name).toHaveProperty('name', 'button');
  });

  it('pruneOrphanImports (moveElement orphan-prune) does not throw on the full file', () => {
    const ast = parseCode(COLLISION_SOURCE);
    expect(() => pruneOrphanImports(ast)).not.toThrow();
    const out = printAST(ast);
    // The App component must survive the prune pass.
    expect(out).toContain('export default function App');
    // The colliding `import { Layout } from 'antd'` must NOT be pruned: the prune walk treats the
    // `Layout` references (the function declaration's own id) as keeping it live. Asserting this
    // pins the behavior so a future visitor tweak that skips declaration-site ids can't silently
    // drop the import while leaving the function — which would change the file's semantics.
    expect(out).toMatch(/import\s*\{\s*Layout\s*\}\s*from\s*['"]antd['"]/);
  });

  it('buildNodeMap (nodeRef map feeding every mutation) builds for the collision file', () => {
    const ast = parseCode(COLLISION_SOURCE);
    const entries = buildNodeMap(ast, 'root.tsx');
    const tags = entries.map((e) => e.tag);
    expect(tags).toContain('div');
    expect(tags).toContain('h1');
    expect(tags).toContain('html');
  });
});
