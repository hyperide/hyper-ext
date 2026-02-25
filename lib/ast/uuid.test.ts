/**
 * Tests for UUID utilities
 */

import { describe, it, expect } from 'bun:test';
import { parseCode, printAST } from './parser';
import { findElementByUuid, findAllJSXElements, getUuidFromElement } from './traverser';
import { generateUuid, updateAllChildUuids, ensureUuid } from './uuid';

describe('generateUuid', () => {
  it('should generate valid UUID', () => {
    const uuid = generateUuid();

    expect(uuid).toBeDefined();
    expect(typeof uuid).toBe('string');
    expect(uuid.length).toBeGreaterThan(0);

    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('should generate unique UUIDs', () => {
    const uuid1 = generateUuid();
    const uuid2 = generateUuid();

    expect(uuid1).not.toBe(uuid2);
  });
});

describe('updateAllChildUuids', () => {
  it('should update UUIDs in all children', () => {
    const code = `
      <div data-uniq-id="parent">
        <span data-uniq-id="child1">One</span>
        <span data-uniq-id="child2">Two</span>
      </div>
    `;
    const ast = parseCode(code);

    const parent = findElementByUuid(ast, 'parent');
    expect(parent).not.toBeNull();

    updateAllChildUuids(parent!.element);

    // Parent UUID should remain unchanged
    const parentUuid = getUuidFromElement(parent!.element);
    expect(parentUuid).toBe('parent');

    // Children should have new UUIDs
    const output = printAST(ast);
    expect(output).not.toContain('child1');
    expect(output).not.toContain('child2');
    expect(output).toContain('data-uniq-id="parent"');
  });

  it('should handle nested children recursively', () => {
    const code = `
      <div data-uniq-id="root">
        <div data-uniq-id="level1">
          <div data-uniq-id="level2">
            <span data-uniq-id="level3">Deep</span>
          </div>
        </div>
      </div>
    `;
    const ast = parseCode(code);

    const root = findElementByUuid(ast, 'root');
    expect(root).not.toBeNull();

    updateAllChildUuids(root!.element);

    const output = printAST(ast);
    expect(output).not.toContain('level1');
    expect(output).not.toContain('level2');
    expect(output).not.toContain('level3');
    expect(output).toContain('data-uniq-id="root"');
  });

  it('should handle elements without existing UUIDs', () => {
    const code = `
      <div data-uniq-id="parent">
        <span>Child without UUID</span>
      </div>
    `;
    const ast = parseCode(code);

    const parent = findElementByUuid(ast, 'parent');
    expect(parent).not.toBeNull();

    expect(() => {
      updateAllChildUuids(parent!.element);
    }).not.toThrow();
  });

  it('should handle JSX in expressions (map, ternary)', () => {
    const code = `
      <div data-uniq-id="parent">
        {items.map(item => <li data-uniq-id="item" key={item.id}>{item.name}</li>)}
        {condition ? <span data-uniq-id="true-branch">Yes</span> : <span data-uniq-id="false-branch">No</span>}
      </div>
    `;
    const ast = parseCode(code);

    const parent = findElementByUuid(ast, 'parent');
    expect(parent).not.toBeNull();

    updateAllChildUuids(parent!.element);

    const output = printAST(ast);
    expect(output).not.toContain('data-uniq-id="item"');
    expect(output).not.toContain('data-uniq-id="true-branch"');
    expect(output).not.toContain('data-uniq-id="false-branch"');
  });
});

describe('ensureUuid', () => {
  it('should add UUID if not present', () => {
    const code = '<div>Content</div>';
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);

    const uuid = ensureUuid(elements[0].element);

    expect(uuid).toBeDefined();
    expect(typeof uuid).toBe('string');

    const actualUuid = getUuidFromElement(elements[0].element);
    expect(actualUuid).toBe(uuid);
  });

  it('should use provided UUID', () => {
    const code = '<div>Content</div>';
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);

    const customUuid = 'custom-uuid-123';
    const uuid = ensureUuid(elements[0].element, customUuid);

    expect(uuid).toBe(customUuid);

    const actualUuid = getUuidFromElement(elements[0].element);
    expect(actualUuid).toBe(customUuid);
  });

  it('should overwrite existing UUID', () => {
    const code = '<div data-uniq-id="old-uuid">Content</div>';
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);

    const newUuid = ensureUuid(elements[0].element);

    expect(newUuid).not.toBe('old-uuid');

    const actualUuid = getUuidFromElement(elements[0].element);
    expect(actualUuid).toBe(newUuid);
  });
});
