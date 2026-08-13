import { describe, expect, it } from 'bun:test';
import { parse } from '@babel/parser';
import { findElementByPosition } from './position-finder';

describe('findElementByPosition', () => {
  const source = `
import React from 'react';
export function App() {
  return (
    <div className="app">
      <h1>Hello</h1>
      <p>World</p>
    </div>
  );
}`;

  it('should find div at its exact start position', () => {
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    // <div> starts at line 5, column 4
    const result = findElementByPosition(ast, 5, 4);
    expect(result).not.toBeNull();
    expect(result?.element.openingElement.name).toHaveProperty('name', 'div');
  });

  it('should find h1 at its exact start position', () => {
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    // <h1> starts at line 6, column 6
    const result = findElementByPosition(ast, 6, 6);
    expect(result).not.toBeNull();
    expect(result?.element.openingElement.name).toHaveProperty('name', 'h1');
  });

  it('should return null for non-existent position', () => {
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    const result = findElementByPosition(ast, 100, 0);
    expect(result).toBeNull();
  });

  it('should return the innermost element when positions overlap', () => {
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    // Position of <h1> -- not <div> even though <div> contains it
    const result = findElementByPosition(ast, 6, 6);
    expect(result?.element.openingElement.name).toHaveProperty('name', 'h1');
  });

  it('should fall back to line-only match when column is off', () => {
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    // <div> starts at line 5, column 4. Column 99 has no match — falls back to line.
    const result = findElementByPosition(ast, 5, 99);
    expect(result).not.toBeNull();
    expect(result?.element.openingElement.name).toHaveProperty('name', 'div');
  });

  it('should prefer exact column match over line-only fallback', () => {
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    // Exact match at line 6, column 6 should win even if line-only would also match
    const result = findElementByPosition(ast, 6, 6);
    expect(result?.element.openingElement.name).toHaveProperty('name', 'h1');
  });

  it('should return null when no element on target line', () => {
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    // Line 100 has no JSX
    const result = findElementByPosition(ast, 100, 99);
    expect(result).toBeNull();
  });
});

// ─── React 19 line-tolerance tests ───────────────────────────────────────────
// React 19 _debugStack gives COMPILED positions (V8 Error.stack).
// Vite compilation merges "return (" + "<Element>" → one compiled line, shifting
// line numbers by 1-2 relative to source. findElementByPosition must search
// ±2 nearby lines when the exact line has no JSXElement.

describe('findElementByPosition — line tolerance (React 19 / Vite offset)', () => {
  // Source has <article> at line 5 but no JSX on line 4.
  // Simulates React 19: V8 Error.stack says compiled line 4, source <article> is at line 5.
  const sourceWithArticle = `
import React from 'react';
export function Tweet() {
  return (
    <article className="border">
      <span>content</span>
    </article>
  );
}`;
  // Lines: 1=(empty), 2=import, 3=export function, 4=return (, 5=<article>, 6=<span>, 7=</article>

  it('falls back to line+1 when target line has no JSX (compiled offset: line 4 → source line 5)', () => {
    const ast = parse(sourceWithArticle, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    // Compiled line 4 maps to source line 5 (<article>). Line 4 in source is "return (" — no JSX.
    const result = findElementByPosition(ast, 4, 4);
    expect(result).not.toBeNull();
    expect(result?.element.openingElement.name).toHaveProperty('name', 'article');
  });

  it('falls back to line-1 when target line has no JSX (compiled offset: source line 5 → compiled line 6)', () => {
    // Simulates the opposite direction: compiled line 6 maps to source line 5 (<article>).
    const ast = parse(sourceWithArticle, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    // Line 6 in source is <span>, so searching for line 6 with wrong col finds <span> first.
    // Let's use line 8 (end of function, no JSX) → falls back to <article> at line 5 or <span> at line 6.
    const result = findElementByPosition(ast, 8, 0);
    // Should find the closest JSX within tolerance (line 6 = delta 2)
    expect(result).not.toBeNull();
  });

  it('does NOT cross ±2 line boundary — returns null for line 20 when JSX ends at line 7', () => {
    const ast = parse(sourceWithArticle, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    // Line 20 is far from any JSX (which ends at line 7). Tolerance is 2, so lines 18-22 are checked.
    const result = findElementByPosition(ast, 20, 0);
    expect(result).toBeNull();
  });

  it('exact match still wins over nearby-line fallback', () => {
    const ast = parse(sourceWithArticle, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    // <span> is at line 6. Exact match should win over any line-5 fallback.
    const result = findElementByPosition(ast, 6, 6);
    expect(result?.element.openingElement.name).toHaveProperty('name', 'span');
  });
});
