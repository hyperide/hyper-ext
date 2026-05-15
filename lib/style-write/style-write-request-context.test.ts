/**
 * @file Tests for request-derived StyleWriteContext creation
 *
 * Accessed via: bun test lib/style-write/style-write-request-context.test.ts
 * Assumptions: request-derived context is a bridge until StyleReadManager provides
 *   full source-owner facts at the platform boundary.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import { describe, expect, it } from 'bun:test';
import { createStyleWriteContextFromRequest, getRequestRoutableCssSystem } from './style-write-request-context';

describe('getRequestRoutableCssSystem', () => {
  it('extracts explicit Tailwind source tab IDs', () => {
    expect(getRequestRoutableCssSystem('tailwind-v4:elementClass')).toBe('tailwind-v4');
  });

  it('extracts explicit CSS Modules source tab IDs', () => {
    expect(getRequestRoutableCssSystem('css-modules:card')).toBe('css-modules');
  });

  it('does not route computed or unsupported adapter tabs', () => {
    expect(getRequestRoutableCssSystem(undefined)).toBeUndefined();
    expect(getRequestRoutableCssSystem('computed')).toBeUndefined();
    expect(getRequestRoutableCssSystem('tamagui:props')).toBeUndefined();
  });
});

describe('createStyleWriteContextFromRequest', () => {
  it('creates a Tailwind write context from an explicit source tab request', () => {
    const context = createStyleWriteContextFromRequest({
      filePath: '/project/src/App.tsx',
      elementRef: '/project/src/App.tsx:7:4',
      tagName: 'div',
      styles: { paddingLeft: '16' },
      selectedSourceTabId: 'tailwind-v4:elementClass',
      state: 'hover',
    });

    expect(context.projectCapabilities.projectCssSystems).toEqual(['tailwind-v4']);
    expect(context.condition).toEqual({ state: 'hover' });
    expect(context.elementFacts.sourceOwners).toEqual([
      expect.objectContaining({
        cssSystem: 'tailwind-v4',
        sourceForm: 'elementClass',
        filePath: '/project/src/App.tsx',
        elementRef: '/project/src/App.tsx:7:4',
        property: 'padding-left',
      }),
    ]);
  });

  it('routes computed writes through inferred element systems instead of the legacy Tailwind path', () => {
    const context = createStyleWriteContextFromRequest({
      filePath: '/project/src/App.tsx',
      elementRef: '/project/src/App.tsx:7:4',
      styles: { color: 'red' },
      selectedSourceTabId: 'computed',
      elementCssSystems: ['inline-style'],
    });

    expect(context.projectCapabilities.projectCssSystems).toEqual(['inline-style']);
    expect(context.elementFacts.sourceOwners).toEqual([
      expect.objectContaining({
        cssSystem: 'inline-style',
        sourceForm: 'scriptReactStyleRule',
        property: 'color',
      }),
    ]);
  });

  it('rejects unsupported explicit source tabs instead of silently falling back', () => {
    expect(() =>
      createStyleWriteContextFromRequest({
        filePath: '/project/src/App.tsx',
        elementRef: '/project/src/App.tsx:7:4',
        styles: { color: 'red' },
        selectedSourceTabId: 'tamagui:props',
      }),
    ).toThrow('Unsupported style source tab');
  });

  it('uses provided CSS Modules source owners for explicit module tabs', () => {
    const owner = {
      cssSystem: 'css-modules' as const,
      sourceForm: 'cssStyleRule' as const,
      cssSyntax: 'css' as const,
      filePath: '/project/src/Card.module.css',
      elementRef: '/project/src/Card.tsx:4:9',
      selector: '.card',
      property: 'padding-left',
      condition: { state: 'base' as const },
      confidence: 'exact' as const,
    };

    const context = createStyleWriteContextFromRequest({
      filePath: '/project/src/Card.tsx',
      elementRef: '/project/src/Card.tsx:4:9',
      tagName: 'article',
      styles: { paddingLeft: '16' },
      selectedSourceTabId: 'css-modules:card',
      sourceOwners: [owner],
      elementCssSystems: ['css-modules'],
      projectCssSystems: ['css-modules'],
    });

    expect(context.projectCapabilities.projectCssSystems).toEqual(['css-modules']);
    expect(context.elementFacts.elementCssSystems).toEqual(['css-modules']);
    expect(context.elementFacts.sourceOwners).toEqual([owner]);
  });
});
