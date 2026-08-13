/**
 * @file Tests for request-derived StyleWriteContext creation
 *
 * Accessed via: bun test lib/style-write/style-write-request-context.test.ts
 * Assumptions: request-derived context is a bridge until StyleReadManager provides
 *   full source-owner facts at the platform boundary.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import { describe, expect, it } from 'bun:test';
import {
  createStyleWriteContextFromRequest,
  getRequestRoutableCssSystem,
  resolveWriteCascade,
} from './style-write-request-context';

describe('resolveWriteCascade (D2 cascade — always writes, never skips for unknown)', () => {
  it('edits in place: an element-owned system wins (no fallback, step "element")', () => {
    const result = resolveWriteCascade({
      filePath: '/p/App.tsx',
      elementRef: '/p/App.tsx:7:4',
      styles: { color: 'red' },
      selectedSourceTabId: 'auto',
      elementCssSystems: ['tailwind-v4'],
      projectDefaultCssSystem: 'tailwind-v4',
    });
    expect(result).toEqual({ system: 'tailwind-v4', step: 'element', isFallback: false });
  });

  it('UNKNOWN (surfaceless) element cascades to the project priority system — NOT a skip', () => {
    const result = resolveWriteCascade({
      filePath: '/p/App.tsx',
      elementRef: '/p/App.tsx:7:4',
      styles: { color: 'red' },
      selectedSourceTabId: 'auto',
      elementCssSystems: [],
      projectDefaultCssSystem: 'tailwind-v4',
    });
    expect(result).toEqual({ system: 'tailwind-v4', step: 'project-default', isFallback: true });
  });

  it('UNKNOWN element with a detected project system (no UIKit default) cascades to it', () => {
    const result = resolveWriteCascade({
      filePath: '/p/App.tsx',
      elementRef: '/p/App.tsx:7:4',
      styles: { color: 'red' },
      selectedSourceTabId: 'auto',
      elementCssSystems: [],
      projectCssSystems: ['css-modules'],
    });
    expect(result).toEqual({ system: 'css-modules', step: 'project-system', isFallback: true });
  });

  it('PROJECT WITH NO SYSTEM AT ALL → needs-prompt (set up Tailwind?), inline as the declined floor', () => {
    const result = resolveWriteCascade({
      filePath: '/p/App.tsx',
      elementRef: '/p/App.tsx:7:4',
      styles: { color: 'red' },
      selectedSourceTabId: 'auto',
      elementCssSystems: [],
      // No project default, no detected project systems — the genuine "no system at all" case.
    });
    expect(result).toEqual({
      system: 'inline-style',
      step: 'inline',
      isFallback: true,
      needsProjectSystemPrompt: true,
    });
  });
});

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

  it('treats the multi-select Auto chip like computed (no explicit target)', () => {
    expect(getRequestRoutableCssSystem('auto')).toBeUndefined();
  });
});

describe('createStyleWriteContextFromRequest — Auto + surfaceless floor (D2 §4.3/§4.4)', () => {
  it('treats the Auto chip identically to computed — edits in place via element systems', () => {
    const context = createStyleWriteContextFromRequest({
      filePath: '/project/src/App.tsx',
      elementRef: '/project/src/App.tsx:7:4',
      styles: { color: 'red' },
      selectedSourceTabId: 'auto',
      elementCssSystems: ['tailwind-v4'],
    });
    expect(context.projectCapabilities.projectCssSystems).toEqual(['tailwind-v4']);
  });

  it('does NOT throw for the Auto chip (it is a non-routable sentinel, not an unsupported tab)', () => {
    expect(() =>
      createStyleWriteContextFromRequest({
        filePath: '/project/src/App.tsx',
        elementRef: '/project/src/App.tsx:7:4',
        styles: { color: 'red' },
        selectedSourceTabId: 'auto',
        elementCssSystems: ['inline-style'],
      }),
    ).not.toThrow();
  });

  it('a surfaceless element floors to the project UIKit default, NOT a silent inline fallback', () => {
    const context = createStyleWriteContextFromRequest({
      filePath: '/project/src/App.tsx',
      elementRef: '/project/src/App.tsx:7:4',
      styles: { color: 'red' },
      selectedSourceTabId: 'auto',
      // No element systems (surfaceless), but the project default is Tailwind.
      elementCssSystems: [],
      projectDefaultCssSystem: 'tailwind-v4',
    });
    expect(context.projectCapabilities.projectCssSystems).toEqual(['tailwind-v4']);
  });

  it('keeps edit-in-place: an existing element system wins over the project default', () => {
    const context = createStyleWriteContextFromRequest({
      filePath: '/project/src/App.tsx',
      elementRef: '/project/src/App.tsx:7:4',
      styles: { color: 'red' },
      selectedSourceTabId: 'auto',
      elementCssSystems: ['css-modules'],
      projectDefaultCssSystem: 'tailwind-v4',
    });
    expect(context.projectCapabilities.projectCssSystems).toEqual(['css-modules']);
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
