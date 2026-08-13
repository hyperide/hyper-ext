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
            <div data-uniq-id="root">
              <header data-uniq-id="hdr">
                <h1 data-uniq-id="title">Welcome</h1>
              </header>
              <nav data-uniq-id="nav-main">
                <Button data-uniq-id="btn1">Click me</Button>
              </nav>
              <main data-uniq-id="content">
                {items.map((item) => (
                  <article data-uniq-id="card" key={item.id}>
                    <span data-uniq-id="name">{item.name}</span>
                  </article>
                ))}
                {isVisible && <aside data-uniq-id="sidebar">Info</aside>}
                {renderItem(item)}
              </main>
              <input data-uniq-id="search" placeholder="Search..." />
              <footer data-uniq-id="ftr">
                <svg data-uniq-id="icon"><path d="M0 0" /></svg>
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

      const parseContext: ParseContext = { fileAST: ast, seenIds: new Set() };
      const componentNode = parseJSXElement(rootJSX, undefined, undefined, undefined, parseContext);
      if (!componentNode) throw new Error('componentNode is null');

      const tree = convertComponentNodeToTreeNode(componentNode);

      // Root div → frame
      expect(tree.type).toBe('frame');
      expect(tree.id).toBe('root');

      // header → frame
      const header = tree.children?.find((c) => c.id === 'hdr');
      expect(header).toBeDefined();
      expect(header?.type).toBe('frame');

      // h1 inside header → element
      const title = header?.children?.find((c) => c.id === 'title');
      expect(title).toBeDefined();
      expect(title?.type).toBe('element');
      expect(title?.label).toBe('h1 "Welcome"');

      // nav → frame
      const nav = tree.children?.find((c) => c.id === 'nav-main');
      expect(nav).toBeDefined();
      expect(nav?.type).toBe('frame');

      // Button → component
      const btn = nav?.children?.find((c) => c.id === 'btn1');
      expect(btn).toBeDefined();
      expect(btn?.type).toBe('component');
      expect(btn?.label).toBe('Button "Click me"');

      // main → frame, contains map wrapper + conditional + function
      const main = tree.children?.find((c) => c.id === 'content');
      expect(main).toBeDefined();
      expect(main?.type).toBe('frame');

      // map wrapper should exist (articles grouped)
      const mapNode = main?.children?.find((c) => c.type === 'map');
      expect(mapNode).toBeDefined();
      expect(mapNode?.label).toContain('.map()');

      // Conditional aside should exist somewhere in main children
      const aside = main?.children?.find((c) => c.id === 'sidebar');
      expect(aside).toBeDefined();
      expect(aside?.type).toBe('frame');

      // Function expansion: renderItem call should produce fn: node
      const fnNode = main?.children?.find((c) => c.type === 'function');
      expect(fnNode).toBeDefined();
      expect(fnNode?.label).toBe('renderItem()');

      // input with placeholder
      const input = tree.children?.find((c) => c.id === 'search');
      expect(input).toBeDefined();
      expect(input?.label).toBe('input "Search..."');

      // footer → frame
      const footer = tree.children?.find((c) => c.id === 'ftr');
      expect(footer).toBeDefined();
      expect(footer?.type).toBe('frame');

      // SVG children should be pruned
      const svgNode = footer?.children?.find((c) => c.id === 'icon');
      expect(svgNode).toBeDefined();
      expect(svgNode?.children).toEqual([]);
    });
  });
});
