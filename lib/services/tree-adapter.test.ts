import { describe, expect, it } from 'bun:test';
import { parseCode } from '../ast/parser';
import type { ComponentNode, ParseContext } from './component-parser';
import { parseJSXElement } from './component-parser';
import { convertComponentNodeToTreeNode, extractTextFromNode } from './tree-adapter';

describe('tree-adapter', () => {
  describe('extractTextFromNode', () => {
    it('returns text from props.children', () => {
      const node: ComponentNode = {
        id: '1',
        type: 'span',
        props: { children: 'Hello' },
        children: [],
        childrenType: 'text',
      };
      expect(extractTextFromNode(node)).toBe('Hello');
    });

    it('returns empty string for jsx childrenType', () => {
      const node: ComponentNode = {
        id: '1',
        type: 'div',
        props: { children: 'Hello' },
        children: [],
        childrenType: 'jsx',
      };
      expect(extractTextFromNode(node)).toBe('');
    });

    it('collects text from nested children', () => {
      const node: ComponentNode = {
        id: '1',
        type: 'div',
        props: {},
        children: [
          { id: '2', type: 'span', props: { children: 'Hello' }, children: [], childrenType: 'text' },
          { id: '3', type: 'span', props: { children: 'World' }, children: [], childrenType: 'text' },
        ],
      };
      expect(extractTextFromNode(node)).toBe('Hello World');
    });
  });

  describe('convertComponentNodeToTreeNode', () => {
    it('converts div to frame type', () => {
      const node: ComponentNode = { id: '1', type: 'div', props: {}, children: [] };
      const result = convertComponentNodeToTreeNode(node);
      expect(result.type).toBe('frame');
      expect(result.label).toBe('div');
    });

    it('converts section to frame type', () => {
      const node: ComponentNode = { id: '1', type: 'section', props: {}, children: [] };
      const result = convertComponentNodeToTreeNode(node);
      expect(result.type).toBe('frame');
    });

    it('converts main to frame type', () => {
      const node: ComponentNode = { id: '1', type: 'main', props: {}, children: [] };
      expect(convertComponentNodeToTreeNode(node).type).toBe('frame');
    });

    it('converts header to frame type', () => {
      const node: ComponentNode = { id: '1', type: 'header', props: {}, children: [] };
      expect(convertComponentNodeToTreeNode(node).type).toBe('frame');
    });

    it('converts footer to frame type', () => {
      const node: ComponentNode = { id: '1', type: 'footer', props: {}, children: [] };
      expect(convertComponentNodeToTreeNode(node).type).toBe('frame');
    });

    it('converts nav to frame type', () => {
      const node: ComponentNode = { id: '1', type: 'nav', props: {}, children: [] };
      expect(convertComponentNodeToTreeNode(node).type).toBe('frame');
    });

    it('converts article to frame type', () => {
      const node: ComponentNode = { id: '1', type: 'article', props: {}, children: [] };
      expect(convertComponentNodeToTreeNode(node).type).toBe('frame');
    });

    it('converts aside to frame type', () => {
      const node: ComponentNode = { id: '1', type: 'aside', props: {}, children: [] };
      expect(convertComponentNodeToTreeNode(node).type).toBe('frame');
    });

    it('converts form to frame type', () => {
      const node: ComponentNode = { id: '1', type: 'form', props: {}, children: [] };
      expect(convertComponentNodeToTreeNode(node).type).toBe('frame');
    });

    it('converts PascalCase to component type', () => {
      const node: ComponentNode = { id: '1', type: 'Button', props: {}, children: [] };
      const result = convertComponentNodeToTreeNode(node);
      expect(result.type).toBe('component');
      expect(result.label).toBe('Button');
    });

    it('converts lowercase non-frame tag to element type', () => {
      const node: ComponentNode = { id: '1', type: 'span', props: {}, children: [] };
      const result = convertComponentNodeToTreeNode(node);
      expect(result.type).toBe('element');
    });

    it('converts fn: prefix to function type with functionLoc', () => {
      const fnLoc = { start: { line: 10, column: 0 }, end: { line: 20, column: 1 } };
      const node: ComponentNode = {
        id: '1',
        type: 'fn:renderRow',
        props: {},
        children: [],
        functionItem: {
          functionName: 'renderRow',
          functionLoc: fnLoc,
          callLoc: { start: { line: 5, column: 4 }, end: { line: 5, column: 16 } },
        },
      };
      const result = convertComponentNodeToTreeNode(node);
      expect(result.type).toBe('function');
      expect(result.label).toBe('renderRow()');
      expect(result.functionLoc).toEqual(fnLoc);
    });

    it('uses data-testid for frame label', () => {
      const node: ComponentNode = {
        id: '1',
        type: 'div',
        props: { 'data-testid': 'sidebar' },
        children: [],
      };
      const result = convertComponentNodeToTreeNode(node);
      expect(result.label).toBe('div "sidebar"');
    });

    it('uses text content for button label', () => {
      const node: ComponentNode = {
        id: '1',
        type: 'button',
        props: { children: 'Submit' },
        children: [],
        childrenType: 'text',
      };
      const result = convertComponentNodeToTreeNode(node);
      expect(result.label).toBe('button "Submit"');
    });

    it('labels a bare {children} passthrough as a brace binding, not quoted literal text', () => {
      // `<button>{children}</button>` parses to childrenType 'expression' with the raw
      // JSX text `{children}`. Quoting it (`button "{children}"`) reads as literal on-
      // screen text, which is misleading. Keep the braces (they signal a JSX binding)
      // but drop the surrounding quotes: `button {children}`.
      const node: ComponentNode = {
        id: '1',
        type: 'button',
        props: { children: '{children}' },
        children: [],
        childrenType: 'expression',
      };
      const result = convertComponentNodeToTreeNode(node);
      expect(result.label).toBe('button {children}');
    });

    it('labels a {children} passthrough on a component as a brace binding', () => {
      const node: ComponentNode = {
        id: '1',
        type: 'Card',
        props: { children: '{children}' },
        children: [],
        childrenType: 'expression',
      };
      const result = convertComponentNodeToTreeNode(node);
      expect(result.label).toBe('Card {children}');
    });

    it('prefers data-testid label over {children} passthrough', () => {
      const node: ComponentNode = {
        id: '1',
        type: 'div',
        props: { 'data-testid': 'sidebar', children: '{children}' },
        childrenType: 'expression',
        children: [],
      };
      const result = convertComponentNodeToTreeNode(node);
      expect(result.label).toBe('div "sidebar"');
    });

    it('keeps a real expression child quoted (not the {children} passthrough)', () => {
      // `<div>{user.name}</div>` is informative as `div "{user.name}"`; only the bare
      // `{children}` passthrough is special-cased.
      const node: ComponentNode = {
        id: '1',
        type: 'div',
        props: { children: '{user.name}' },
        children: [],
        childrenType: 'expression',
      };
      const result = convertComponentNodeToTreeNode(node);
      expect(result.label).toBe('div "{user.name}"');
    });

    it('uses placeholder for input label', () => {
      const node: ComponentNode = {
        id: '1',
        type: 'input',
        props: { placeholder: 'Enter name' },
        children: [],
      };
      const result = convertComponentNodeToTreeNode(node);
      expect(result.label).toBe('input "Enter name"');
    });

    it('uses type fallback for input without placeholder', () => {
      const node: ComponentNode = {
        id: '1',
        type: 'input',
        props: { type: 'email' },
        children: [],
      };
      const result = convertComponentNodeToTreeNode(node);
      expect(result.label).toBe('input [type="email"]');
    });

    it('prunes SVG children', () => {
      const node: ComponentNode = {
        id: '1',
        type: 'svg',
        props: {},
        children: [{ id: '2', type: 'path', props: {}, children: [] }],
      };
      const result = convertComponentNodeToTreeNode(node);
      expect(result.children).toEqual([]);
    });

    it('converts children recursively', () => {
      const node: ComponentNode = {
        id: '1',
        type: 'div',
        props: {},
        children: [
          { id: '2', type: 'span', props: { children: 'text' }, children: [], childrenType: 'text' },
          { id: '3', type: 'Button', props: {}, children: [] },
        ],
        childrenType: 'jsx',
      };
      const result = convertComponentNodeToTreeNode(node);
      expect(result.children).toHaveLength(2);
      expect(result.children?.[0].type).toBe('element');
      expect(result.children?.[0].label).toBe('span "text"');
      expect(result.children?.[1].type).toBe('component');
    });

    it('groups map children into synthetic map wrapper', () => {
      const mapId = 'map-1';
      const node: ComponentNode = {
        id: '1',
        type: 'div',
        props: {},
        children: [
          {
            id: '2',
            type: 'li',
            props: {},
            children: [],
            mapItem: { parentMapId: mapId, depth: 0, expression: 'items' },
          },
          {
            id: '3',
            type: 'li',
            props: {},
            children: [],
            mapItem: { parentMapId: mapId, depth: 0, expression: 'items' },
          },
        ],
        childrenType: 'jsx',
      };
      const result = convertComponentNodeToTreeNode(node);
      expect(result.children).toHaveLength(1);
      expect(result.children?.[0].type).toBe('map');
      expect(result.children?.[0].label).toBe('items.map()');
      expect(result.children?.[0].children).toHaveLength(2);
    });

    it('does not group children with different mapIds', () => {
      const node: ComponentNode = {
        id: '1',
        type: 'div',
        props: {},
        children: [
          {
            id: '2',
            type: 'li',
            props: {},
            children: [],
            mapItem: { parentMapId: 'map-a', depth: 0, expression: 'items' },
          },
          {
            id: '3',
            type: 'span',
            props: {},
            children: [],
          },
          {
            id: '4',
            type: 'li',
            props: {},
            children: [],
            mapItem: { parentMapId: 'map-b', depth: 0, expression: 'users' },
          },
        ],
        childrenType: 'jsx',
      };
      const result = convertComponentNodeToTreeNode(node);
      expect(result.children).toHaveLength(3);
      expect(result.children?.[0].type).toBe('map');
      expect(result.children?.[0].label).toBe('items.map()');
      expect(result.children?.[1].type).toBe('element');
      expect(result.children?.[2].type).toBe('map');
      expect(result.children?.[2].label).toBe('users.map()');
    });
  });

  describe('full pipeline: parseJSXElement + convertComponentNodeToTreeNode', () => {
    it('parses a real component through shared parser and adapter', () => {
      const source = `
        function MyComponent() {
          const renderItem = (item) => <li>{item.name}</li>;

          return (
            <div>
              <header>
                <h1>Welcome</h1>
              </header>
              <nav>
                <Button>Click me</Button>
              </nav>
              <main>
                {items.map((item) => (
                  <article key={item.id}>
                    <span>{item.name}</span>
                  </article>
                ))}
                {isVisible && <aside>Info</aside>}
                {renderItem(item)}
              </main>
              <input placeholder="Search..." />
              <footer>
                <svg><path d="M0 0" /></svg>
              </footer>
            </div>
          );
        }
      `;

      const ast = parseCode(source);

      // Find the JSXElement in the return statement
      let rootJSX: import('@babel/types').JSXElement | null = null;
      const t = require('@babel/types');
      const _traverse = require('@babel/traverse');
      const traverse = _traverse.default ?? _traverse;
      traverse(ast, {
        ReturnStatement(path: import('@babel/traverse').NodePath<import('@babel/types').ReturnStatement>) {
          if (t.isJSXElement(path.node.argument)) {
            rootJSX = path.node.argument;
            path.stop();
          }
        },
      });

      if (!rootJSX) throw new Error('rootJSX not found');

      const parseContext: ParseContext = { fileAST: ast };
      const componentNode = parseJSXElement(rootJSX, undefined, undefined, undefined, parseContext);
      if (!componentNode) throw new Error('componentNode is null');

      const tree = convertComponentNodeToTreeNode(componentNode);

      // Root div → frame
      expect(tree.type).toBe('frame');

      // Find children by label patterns (IDs are generated UUIDs)
      const children = tree.children ?? [];

      // header → frame
      const header = children.find((c) => c.type === 'frame' && c.label === 'header');
      expect(header).toBeDefined();

      // h1 inside header → element
      const title = header?.children?.find((c) => c.type === 'element' && c.label === 'h1 "Welcome"');
      expect(title).toBeDefined();

      // nav → frame
      const nav = children.find((c) => c.type === 'frame' && c.label === 'nav');
      expect(nav).toBeDefined();

      // Button → component
      const btn = nav?.children?.find((c) => c.type === 'component' && c.label === 'Button "Click me"');
      expect(btn).toBeDefined();

      // main → frame, contains map wrapper + conditional + function
      const main = children.find((c) => c.type === 'frame' && c.label === 'main');
      expect(main).toBeDefined();

      // map wrapper should exist (articles grouped)
      const mapNode = main?.children?.find((c) => c.type === 'map');
      expect(mapNode).toBeDefined();
      expect(mapNode?.label).toContain('.map()');

      // Conditional aside should exist somewhere in main children
      const aside = main?.children?.find((c) => c.type === 'frame' && c.label === 'aside "Info"');
      expect(aside).toBeDefined();

      // Function expansion: renderItem call should produce fn: node
      const fnNode = main?.children?.find((c) => c.type === 'function');
      expect(fnNode).toBeDefined();
      expect(fnNode?.label).toBe('renderItem()');

      // input with placeholder
      const input = children.find((c) => c.label === 'input "Search..."');
      expect(input).toBeDefined();

      // footer → frame
      const footer = children.find((c) => c.type === 'frame' && c.label === 'footer');
      expect(footer).toBeDefined();

      // SVG children should be pruned
      const svgNode = footer?.children?.find((c) => c.label === 'svg');
      expect(svgNode).toBeDefined();
      expect(svgNode?.children).toEqual([]);
    });
  });
});
