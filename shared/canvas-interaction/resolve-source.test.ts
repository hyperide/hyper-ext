/**
 * @file Tests for shared call-site source resolution.
 *
 * Accessed via: Internal module, not exposed
 */

import { describe, expect, it } from 'bun:test';
import type { DebugSource, Fiber } from '../element-tracing/fiber-internals';
import type { SourceLocation } from '../element-tracing/types';
import { resolveCallSiteTarget } from './resolve-source';

function mockFiber(overrides: Partial<Fiber> = {}): Fiber {
  return {
    tag: 5,
    type: 'div',
    stateNode: null,
    return: null,
    child: null,
    sibling: null,
    memoizedProps: {},
    _debugSource: null,
    _debugOwner: null,
    ...overrides,
  };
}

function source(overrides: Partial<SourceLocation> = {}): SourceLocation {
  return {
    fileName: '/app/src/components/UserSuggestion.tsx',
    line: 10,
    column: 6,
    ...overrides,
  };
}

describe('resolveCallSiteTarget', () => {
  it('uses the repeated component call-site index for imported component internals rendered in a map', () => {
    const callSiteSource: DebugSource = {
      fileName: '/app/src/components/TrendingSidebar.tsx',
      lineNumber: 59,
      columnNumber: 13,
    };

    const firstUserSuggestion = mockFiber({
      tag: 0,
      type: function UserSuggestion() {},
      _debugSource: callSiteSource,
    });
    const secondUserSuggestion = mockFiber({
      tag: 0,
      type: function UserSuggestion() {},
      _debugSource: callSiteSource,
    });
    const trendingSidebar = mockFiber({
      tag: 0,
      type: function TrendingSidebar() {},
      child: firstUserSuggestion,
      _debugSource: {
        fileName: '/app/src/components/TrendingSidebar.tsx',
        lineNumber: 20,
        columnNumber: 3,
      },
    });

    firstUserSuggestion.return = trendingSidebar;
    firstUserSuggestion.sibling = secondUserSuggestion;
    secondUserSuggestion.return = trendingSidebar;

    const internalDiv = mockFiber({
      tag: 5,
      type: 'div',
      return: secondUserSuggestion,
      _debugSource: {
        fileName: '/app/src/components/UserSuggestion.tsx',
        lineNumber: 7,
        columnNumber: 5,
      },
    });
    const internalSpan = mockFiber({
      tag: 5,
      type: 'span',
      return: internalDiv,
      _debugSource: {
        fileName: '/app/src/components/UserSuggestion.tsx',
        lineNumber: 10,
        columnNumber: 7,
      },
    });

    secondUserSuggestion.child = internalDiv;
    internalDiv.child = internalSpan;

    const result = resolveCallSiteTarget(source(), internalSpan, 'src/components/TrendingSidebar.tsx', 0);

    expect(result).toEqual({
      source: {
        fileName: '/app/src/components/TrendingSidebar.tsx',
        line: 59,
        column: 12,
      },
      itemIndex: 1,
    });
  });

  it('keeps direct source and direct item index when the source already belongs to the rendered file', () => {
    const directSource = source({
      fileName: '/app/src/components/TrendingSidebar.tsx',
      line: 42,
      column: 8,
    });
    const fiber = mockFiber();

    expect(resolveCallSiteTarget(directSource, fiber, 'src/components/TrendingSidebar.tsx', 2)).toEqual({
      source: directSource,
      itemIndex: 2,
    });
  });

  it('falls back to the real component source when the call site is the synthetic preview wrapper (HYP-429)', () => {
    // tamagui-whatsapp: the synthetic __canvas_preview__.tsx imports and renders
    // <ChatInputBar/>. Clicking a div inside ChatInputBar must resolve to the real
    // component file, never to the synthetic wrapper that is its call site.
    const directSource = source({
      fileName: '/app/src/components/ChatInputBar.tsx',
      line: 18,
      column: 4,
    });

    // The call-site ancestor lives in the synthetic preview entry.
    const previewWrapper = mockFiber({
      tag: 0,
      type: function CanvasPreview() {},
      _debugSource: {
        fileName: '/app/src/__canvas_preview__.tsx',
        lineNumber: 12,
        columnNumber: 6,
      },
    });
    const internalDiv = mockFiber({
      tag: 5,
      type: 'div',
      return: previewWrapper,
      _debugSource: {
        fileName: '/app/src/components/ChatInputBar.tsx',
        lineNumber: 18,
        columnNumber: 4,
      },
    });
    previewWrapper.child = internalDiv;

    const result = resolveCallSiteTarget(directSource, internalDiv, 'src/__canvas_preview__.tsx', 0);

    expect(result.source).toEqual(directSource);
  });

  it('uses the rendered-file ancestor item index when clicking a nested child inside a map item', () => {
    const buttonSource: DebugSource = {
      fileName: '/app/src/components/Sidebar.tsx',
      lineNumber: 67,
      columnNumber: 13,
    };
    const spanSource: DebugSource = {
      fileName: '/app/src/components/Sidebar.tsx',
      lineNumber: 76,
      columnNumber: 15,
    };

    const nav = mockFiber();
    const firstButton = mockFiber({ tag: 5, type: 'button', return: nav, _debugSource: buttonSource });
    const secondButton = mockFiber({ tag: 5, type: 'button', return: nav, _debugSource: buttonSource });
    const secondSpan = mockFiber({ tag: 5, type: 'span', return: secondButton, _debugSource: spanSource });
    nav.child = firstButton;
    firstButton.sibling = secondButton;
    secondButton.child = secondSpan;

    const result = resolveCallSiteTarget(
      {
        fileName: '/app/src/components/Sidebar.tsx',
        line: 76,
        column: 14,
      },
      secondSpan,
      'src/components/Sidebar.tsx',
      0,
    );

    expect(result).toEqual({
      source: {
        fileName: '/app/src/components/Sidebar.tsx',
        line: 76,
        column: 14,
      },
      itemIndex: 1,
    });
  });
});
