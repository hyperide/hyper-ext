/**
 * @file Tests for CSS toggle tokens across VS Code theme variants.
 *
 * Accessed via: VS Code extension webview panels — any panel using toggle UI components.
 * Validates that the correct CSS custom property values are declared in styles.css
 * for each VS Code theme class (dark, light, high-contrast).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cssContent = readFileSync(resolve(import.meta.dir, '../webview/styles.css'), 'utf-8');

/**
 * Extracts CSS blocks (selector + body pairs) from raw CSS text.
 * Handles multi-selector blocks like ":root,\nbody.vscode-dark { ... }".
 */
function getCSSBlocks(css: string): Array<{ selectors: string[]; body: string }> {
  const blocks: Array<{ selectors: string[]; body: string }> = [];
  // Match selector group + block body, skipping @-rules
  const blockRegex = /([^{}@][^{]*)\{([^}]*)\}/gs;
  let match = blockRegex.exec(css);
  while (match !== null) {
    const selectorGroup = match[1].trim();
    const body = match[2];
    const selectors = selectorGroup
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    blocks.push({ selectors, body });
    match = blockRegex.exec(css);
  }
  return blocks;
}

const cssBlocks = getCSSBlocks(cssContent);

/**
 * Extracts the value of a CSS custom property from a specific selector's block.
 * Handles multi-selector blocks (comma-separated selectors sharing a body).
 */
function getTokenForSelector(selector: string, property: string): string | null {
  for (const block of cssBlocks) {
    if (block.selectors.some((s) => s === selector || s.includes(selector))) {
      const propRegex = new RegExp(`${property.replace(/-/g, '\\-')}\\s*:\\s*([^;]+);`);
      const propMatch = block.body.match(propRegex);
      if (propMatch) return propMatch[1].trim();
    }
  }
  return null;
}

describe('extension toggle tokens per theme', () => {
  it('dark theme: container has rgba overlay', () => {
    const value = getTokenForSelector('body.vscode-dark', '--toggle-container-bg');
    expect(value).not.toBeNull();
    expect(value).toContain('rgba(255');
  });

  it('light theme: active pill is white', () => {
    const value = getTokenForSelector('body.vscode-light', '--toggle-active-bg');
    expect(value).toBe('#fff');
  });

  it('high-contrast dark: container is transparent', () => {
    const value = getTokenForSelector('body.vscode-high-contrast', '--toggle-container-bg');
    expect(value).toBe('transparent');
  });

  it('high-contrast dark: active bg is transparent', () => {
    const value = getTokenForSelector('body.vscode-high-contrast', '--toggle-active-bg');
    expect(value).toBe('transparent');
  });

  it('high-contrast light: container is transparent', () => {
    const value = getTokenForSelector('body.vscode-high-contrast-light', '--toggle-container-bg');
    expect(value).toBe('transparent');
  });

  it('high-contrast light: active bg is transparent', () => {
    const value = getTokenForSelector('body.vscode-high-contrast-light', '--toggle-active-bg');
    expect(value).toBe('transparent');
  });

  it('CSS file contains toggle-container utility class', () => {
    expect(cssContent).toContain('.toggle-container');
    expect(cssContent).toContain('background: var(--toggle-container-bg)');
  });

  it('CSS file contains toggle-active utility class', () => {
    expect(cssContent).toContain('.toggle-active');
    expect(cssContent).toContain('background: var(--toggle-active-bg)');
  });

  it('high-contrast toggle-active has border override', () => {
    expect(cssContent).toContain('body.vscode-high-contrast .toggle-active');
    expect(cssContent).toContain('border: 1px solid var(--vscode-contrastBorder)');
  });
});
