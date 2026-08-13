/**
 * Tests for AST traverser utilities
 */

import { describe, expect, it } from 'bun:test';
import type { NodePath } from '@babel/traverse';
import type * as t from '@babel/types';
import { parseCode } from './parser';
import {
  analyzeJSXChildren,
  findAllJSXElements,
  findElementAtPosition,
  getChildrenLocation,
  getJSXTagName,
  traverseJSXElements,
  traverseWithoutScope,
} from './traverser';

describe('traverseWithoutScope', () => {
  it('does not throw on a top-level duplicate declaration that the scope crawl rejects (HYP-785)', () => {
    // `@babel/parser` tolerates the collision; a scope-enabled `traverse` throws `Duplicate
    // declaration "Layout"`. The noScope helper must walk it structurally without crashing.
    const ast = parseCode(
      `import { Layout } from 'antd';\nexport function Layout() {\n  return <div className="x" />;\n}\n`,
    );
    let visited = 0;
    expect(() =>
      traverseWithoutScope(ast, {
        JSXElement(_path: NodePath<t.JSXElement>) {
          visited++;
        },
      }),
    ).not.toThrow();
    expect(visited).toBe(1);
  });
});

describe('findAllJSXElements', () => {
  it('should find all JSX elements', () => {
    const code = `
      <div>
        <span>One</span>
        <p>Two</p>
      </div>
    `;
    const ast = parseCode(code);

    const elements = findAllJSXElements(ast);

    expect(elements.length).toBe(3); // div, span, p
  });

  it('should return empty array for no JSX', () => {
    const code = 'const x = 42;';
    const ast = parseCode(code);

    const elements = findAllJSXElements(ast);

    expect(elements).toEqual([]);
  });

  it('should find elements in expressions', () => {
    const code = `
      const Component = () => {
        return items.map(item => <li key={item.id}>{item.name}</li>);
      };
    `;
    const ast = parseCode(code);

    const elements = findAllJSXElements(ast);

    expect(elements.length).toBe(1); // li element
  });
});

describe('traverseJSXElements', () => {
  it('should traverse all JSX elements', () => {
    const code = `
      <div>
        <span>One</span>
        <p>Two</p>
      </div>
    `;
    const ast = parseCode(code);

    const names: string[] = [];
    traverseJSXElements(ast, (element) => {
      const name = element.openingElement.name;
      if ('name' in name) {
        names.push(name.name);
      }
    });

    expect(names).toEqual(['div', 'span', 'p']);
  });

  it('should stop traversal when visitor returns true', () => {
    const code = `
      <div>
        <span>One</span>
        <p>Two</p>
      </div>
    `;
    const ast = parseCode(code);

    let count = 0;
    traverseJSXElements(ast, () => {
      count++;
      return count === 1; // Stop after first element
    });

    expect(count).toBe(1);
  });

  it('should visit nested elements', () => {
    const code = `
      <div>
        <section>
          <article>
            <p>Deep</p>
          </article>
        </section>
      </div>
    `;
    const ast = parseCode(code);

    let count = 0;
    traverseJSXElements(ast, () => {
      count++;
    });

    expect(count).toBe(4); // div, section, article, p
  });
});

// Helper: parse JSX and get the first JSXElement
function getFirstElement(code: string) {
  const ast = parseCode(code);
  const elements = findAllJSXElements(ast);
  return elements[0].element;
}

describe('analyzeJSXChildren', () => {
  it('should return undefined childrenType for empty children', () => {
    const el = getFirstElement('<div></div>');
    const result = analyzeJSXChildren(el);
    expect(result).toEqual({ childrenType: undefined, textContent: '' });
  });

  it('should return undefined childrenType for self-closing element', () => {
    const el = getFirstElement('<br />');
    const result = analyzeJSXChildren(el);
    expect(result).toEqual({ childrenType: undefined, textContent: '' });
  });

  it('should detect text-only children', () => {
    const el = getFirstElement('<div>Hello</div>');
    const result = analyzeJSXChildren(el);
    expect(result.childrenType).toBe('text');
    expect(result.textContent).toBe('Hello');
  });

  it('should detect string literal expression', () => {
    const el = getFirstElement("<div>{'hello'}</div>");
    const result = analyzeJSXChildren(el);
    expect(result.childrenType).toBe('expression');
    expect(result.textContent).toBe("{'hello'}");
  });

  it('should detect identifier expression', () => {
    const el = getFirstElement('<div>{title}</div>');
    const result = analyzeJSXChildren(el);
    expect(result.childrenType).toBe('expression');
    expect(result.textContent).toBe('{title}');
  });

  it('should detect template literal expression', () => {
    const el = getFirstElement('<div>{`text`}</div>');
    const result = analyzeJSXChildren(el);
    expect(result.childrenType).toBe('expression');
    expect(result.textContent).toContain('{');
    expect(result.textContent).toContain('text');
  });

  it('should detect member expression as expression-complex', () => {
    const el = getFirstElement('<div>{item.name}</div>');
    const result = analyzeJSXChildren(el);
    expect(result.childrenType).toBe('expression-complex');
    expect(result.textContent).toBe('{item.name}');
  });

  it('should detect call expression as expression-complex', () => {
    const el = getFirstElement('<div>{formatDate(date)}</div>');
    const result = analyzeJSXChildren(el);
    expect(result.childrenType).toBe('expression-complex');
    expect(result.textContent).toBe('{formatDate(date)}');
  });

  it('should detect ternary as expression-complex', () => {
    const el = getFirstElement("<div>{a ? 'yes' : 'no'}</div>");
    const result = analyzeJSXChildren(el);
    expect(result.childrenType).toBe('expression-complex');
    expect(result.textContent).toContain('?');
  });

  it('should detect mixed text + expression as expression-complex', () => {
    const el = getFirstElement('<div>Hello {name}</div>');
    const result = analyzeJSXChildren(el);
    expect(result.childrenType).toBe('expression-complex');
    expect(result.textContent).toContain('Hello');
    expect(result.textContent).toContain('{name}');
  });

  it('should detect JSX children', () => {
    const ast = parseCode('<div><span /></div>');
    // Get the outer div (first element)
    const elements = findAllJSXElements(ast);
    const div = elements[0].element;
    const result = analyzeJSXChildren(div);
    expect(result.childrenType).toBe('jsx');
    expect(result.textContent).toBe('');
  });

  it('should handle empty expression gracefully', () => {
    const el = getFirstElement('<div>{/* comment */}</div>');
    const result = analyzeJSXChildren(el);
    expect(result).toEqual({ childrenType: undefined, textContent: '' });
  });

  it('should handle binary expression', () => {
    const el = getFirstElement('<div>{count + 1}</div>');
    const result = analyzeJSXChildren(el);
    expect(result.childrenType).toBe('expression-complex');
    expect(result.textContent).toBe('{count + 1}');
  });

  it('should handle logical expression', () => {
    const el = getFirstElement('<div>{value && fallback}</div>');
    const result = analyzeJSXChildren(el);
    expect(result.childrenType).toBe('expression-complex');
    expect(result.textContent).toContain('&&');
  });
});

describe('getChildrenLocation', () => {
  it('should return location of text child', () => {
    const el = getFirstElement('<div>Hello</div>');
    const loc = getChildrenLocation(el);
    expect(loc).not.toBeNull();
    if (!loc) throw new Error('Location not found');
    expect(loc.line).toBeGreaterThan(0);
  });

  it('should return location of expression child', () => {
    const el = getFirstElement('<div>{name}</div>');
    const loc = getChildrenLocation(el);
    expect(loc).not.toBeNull();
    if (!loc) throw new Error('Location not found');
    expect(loc.line).toBeGreaterThan(0);
  });

  it('should return location of member expression child', () => {
    const el = getFirstElement('<div>{item.name}</div>');
    const loc = getChildrenLocation(el);
    expect(loc).not.toBeNull();
    if (!loc) throw new Error('Location not found');
    expect(loc.line).toBeGreaterThan(0);
  });

  it('should return null for empty element', () => {
    const el = getFirstElement('<div></div>');
    const loc = getChildrenLocation(el);
    expect(loc).toBeNull();
  });

  it('should return null for self-closing element', () => {
    const el = getFirstElement('<br />');
    const loc = getChildrenLocation(el);
    expect(loc).toBeNull();
  });

  it('should return null for whitespace-only text', () => {
    const el = getFirstElement('<div>   </div>');
    const loc = getChildrenLocation(el);
    expect(loc).toBeNull();
  });

  it('should skip empty expressions (comments) and return null', () => {
    const el = getFirstElement('<div>{/* comment */}</div>');
    const loc = getChildrenLocation(el);
    expect(loc).toBeNull();
  });

  it('should return location of first text when mixed with expression', () => {
    const el = getFirstElement('<div>Hello {name}</div>');
    const loc = getChildrenLocation(el);
    expect(loc).not.toBeNull();
    if (!loc) throw new Error('Location not found');
    expect(loc.line).toBeGreaterThan(0);
  });
});

describe('findElementAtPosition', () => {
  it('should find element at cursor position', () => {
    // Line numbers are 1-based in Babel
    const code = `const App = () => (
  <div className="root">
    <span className="child">Hello</span>
  </div>
);`;
    const ast = parseCode(code);

    // Position inside the span (line 3, somewhere inside)
    const result = findElementAtPosition(ast, 3, 10);
    expect(result).not.toBeNull();
    expect(result?.element.openingElement.name).toMatchObject({ name: 'span' });
  });

  it('should return null when no element at position', () => {
    const code = `const x = 42;
const y = 'hello';`;
    const ast = parseCode(code);

    const result = findElementAtPosition(ast, 1, 5);
    expect(result).toBeNull();
  });

  it('should pick the smallest (most specific) element', () => {
    const code = `const App = () => (
  <div>
    <div>
      <span>Text</span>
    </div>
  </div>
);`;
    const ast = parseCode(code);

    // Position inside the deepest span
    const result = findElementAtPosition(ast, 4, 15);
    expect(result).not.toBeNull();
    expect(result?.element.openingElement.name).toMatchObject({ name: 'span' });
  });
});

describe('getJSXTagName', () => {
  it('should return name for simple identifier', () => {
    const el = getFirstElement('<div>text</div>');
    expect(getJSXTagName(el)).toBe('div');
  });

  it('should return name for component', () => {
    const el = getFirstElement('<Button>text</Button>');
    expect(getJSXTagName(el)).toBe('Button');
  });

  it('should return dotted name for member expression', () => {
    const el = getFirstElement('<Flex.Item>text</Flex.Item>');
    expect(getJSXTagName(el)).toBe('Flex.Item');
  });

  it('should return deeply nested member expression', () => {
    const el = getFirstElement('<A.B.C>text</A.B.C>');
    expect(getJSXTagName(el)).toBe('A.B.C');
  });
});
