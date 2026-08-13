/**
 * Tests for AST traverser utilities
 */

import { describe, expect, it } from 'bun:test';
import { parseCode } from './parser';
import {
  analyzeJSXChildren,
  findAllJSXElements,
  findElementByUuid,
  findElementWithUuidAtPosition,
  getChildrenLocation,
  getJSXTagName,
  getUuidFromElement,
  traverseJSXElements,
} from './traverser';

describe('findElementByUuid', () => {
  it('should find element by UUID', () => {
    const code = `
      const Component = () => (
        <div data-uniq-id="test-uuid-123">
          <span>Hello</span>
        </div>
      );
    `;
    const ast = parseCode(code);

    const result = findElementByUuid(ast, 'test-uuid-123');

    expect(result).not.toBeNull();
    expect(result?.element.openingElement.name).toMatchObject({ name: 'div' });
  });

  it('should return null if UUID not found', () => {
    const code = '<div>No UUID</div>';
    const ast = parseCode(code);

    const result = findElementByUuid(ast, 'non-existent');

    expect(result).toBeNull();
  });

  it('should find nested element by UUID', () => {
    const code = `
      <div data-uniq-id="parent">
        <div data-uniq-id="child">
          <span data-uniq-id="grandchild">Deep</span>
        </div>
      </div>
    `;
    const ast = parseCode(code);

    const result = findElementByUuid(ast, 'grandchild');

    expect(result).not.toBeNull();
    expect(result?.element.openingElement.name).toMatchObject({ name: 'span' });
  });

  it('should find element with UUID in JSXExpressionContainer string literal', () => {
    const code = `
      const Component = () => (
        <div data-uniq-id={"test-uuid-expr"}>Hello</div>
      );
    `;
    const ast = parseCode(code);

    const result = findElementByUuid(ast, 'test-uuid-expr');

    expect(result).not.toBeNull();
    expect(result?.element.openingElement.name).toMatchObject({ name: 'div' });
  });

  it('should find element with UUID in static template literal', () => {
    const code = `
      const Component = () => (
        <div data-uniq-id={\`test-uuid-template\`}>Hello</div>
      );
    `;
    const ast = parseCode(code);

    const result = findElementByUuid(ast, 'test-uuid-template');

    expect(result).not.toBeNull();
    expect(result?.element.openingElement.name).toMatchObject({ name: 'div' });
  });

  it('should NOT find element with UUID in dynamic template literal', () => {
    const code = `
      const Component = () => {
        const id = 'dynamic';
        return <div data-uniq-id={\`test-uuid-\${id}\`}>Hello</div>;
      };
    `;
    const ast = parseCode(code);

    // Dynamic template literals should not be matched
    const result = findElementByUuid(ast, 'test-uuid-dynamic');

    expect(result).toBeNull();
  });
});

describe('getUuidFromElement', () => {
  it('should extract UUID from element', () => {
    const code = '<div data-uniq-id="test-123">Content</div>';
    const ast = parseCode(code);

    const result = findElementByUuid(ast, 'test-123');
    expect(result).not.toBeNull();

    if (!result) throw new Error('Element not found');
    const uuid = getUuidFromElement(result.element);
    expect(uuid).toBe('test-123');
  });

  it('should return null if element has no UUID', () => {
    const code = '<div>No UUID</div>';
    const ast = parseCode(code);

    const elements = findAllJSXElements(ast);
    expect(elements.length).toBeGreaterThan(0);

    const uuid = getUuidFromElement(elements[0].element);
    expect(uuid).toBeNull();
  });

  it('should extract UUID from JSXExpressionContainer string literal', () => {
    const code = '<div data-uniq-id={"test-expr-uuid"}>Content</div>';
    const ast = parseCode(code);

    const elements = findAllJSXElements(ast);
    expect(elements.length).toBeGreaterThan(0);

    const uuid = getUuidFromElement(elements[0].element);
    expect(uuid).toBe('test-expr-uuid');
  });

  it('should extract UUID from static template literal', () => {
    const code = '<div data-uniq-id={`test-template-uuid`}>Content</div>';
    const ast = parseCode(code);

    const elements = findAllJSXElements(ast);
    expect(elements.length).toBeGreaterThan(0);

    const uuid = getUuidFromElement(elements[0].element);
    expect(uuid).toBe('test-template-uuid');
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

describe('findElementWithUuidAtPosition', () => {
  it('should find element at cursor position', () => {
    // Line numbers are 1-based in Babel
    const code = `const App = () => (
  <div data-uniq-id="root">
    <span data-uniq-id="child">Hello</span>
  </div>
);`;
    const ast = parseCode(code);

    // Position inside the span (line 3, somewhere inside)
    const result = findElementWithUuidAtPosition(ast, 3, 10);
    expect(result).not.toBeNull();
    expect(result?.uuid).toBe('child');
    expect(result?.tagName).toBe('span');
  });

  it('should return null when no element at position', () => {
    const code = `const x = 42;
const y = 'hello';`;
    const ast = parseCode(code);

    const result = findElementWithUuidAtPosition(ast, 1, 5);
    expect(result).toBeNull();
  });

  it('should return null when element at position has no uuid', () => {
    const code = `const App = () => (
  <div>
    <span>Hello</span>
  </div>
);`;
    const ast = parseCode(code);

    const result = findElementWithUuidAtPosition(ast, 3, 5);
    expect(result).toBeNull();
  });

  it('should pick the smallest (most specific) element', () => {
    const code = `const App = () => (
  <div data-uniq-id="outer">
    <div data-uniq-id="inner">
      <span data-uniq-id="deepest">Text</span>
    </div>
  </div>
);`;
    const ast = parseCode(code);

    // Position inside the deepest span
    const result = findElementWithUuidAtPosition(ast, 4, 15);
    expect(result).not.toBeNull();
    expect(result?.uuid).toBe('deepest');
    expect(result?.tagName).toBe('span');
  });

  it('should handle JSXMemberExpression tag names (Dialog.Portal)', () => {
    const code = `const App = () => (
  <Dialog.Portal data-uniq-id="portal">
    <span data-uniq-id="child">Content</span>
  </Dialog.Portal>
);`;
    const ast = parseCode(code);

    // Position on the Dialog.Portal line
    const result = findElementWithUuidAtPosition(ast, 2, 5);
    expect(result).not.toBeNull();
    // The child is smaller, so if cursor is at column 5 of line 2, it should be portal
    // Actually line 2 col 5 is inside Dialog.Portal opening tag
    expect(result?.tagName).toBe('Dialog.Portal');
    expect(result?.uuid).toBe('portal');
  });
});
