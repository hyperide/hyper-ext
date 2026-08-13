/**
 * @file Tests for shared call-site source resolution.
 *
 * Accessed via: Internal module, not exposed
 */

import { describe, expect, it } from 'bun:test';
import type { DebugSource, Fiber } from '../element-tracing/fiber-internals';
import { isSyntheticPreviewPath } from '../element-tracing/synthetic-preview';
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

// React-19-style fiber whose _debugStack resolves to a single frame at the given URL.
function makeStackFiber(fileName: string, line: number, col: number, overrides: Partial<Fiber> = {}): Fiber {
  const stack = new Error();
  stack.stack = `Error\n    at http://localhost:5173/${fileName}:${line}:${col}`;
  return mockFiber({ _debugStack: stack, ...overrides } as Partial<Fiber>);
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

  it('recovers the rendered component source when the DIRECT source IS the synthetic preview wrapper, skipping a library frame — React 19 _debugStack (HYP-424)', () => {
    // tamagui-whatsapp / React 19 + Vite (the exact Docker-reproduced shape): the
    // clicked host div's NEAREST resolved source collapses to the synthetic preview
    // entry __canvas_preview__.tsx. Walking up, the first non-synthetic fiber source is
    // a LIBRARY internal (react-native-safe-area-context) that the internal-frame
    // filter does not strip — just as wrong a target as the wrapper. The element's REAL
    // component source (ChatInputBar.tsx, the rendered component) is further up the chain.
    //
    // resolveCallSiteTarget's call-site walk reads only `_debugSource` (absent in React
    // 19) so it commits the synthetic line. The fix must reject the synthetic
    // directSource AND prefer the rendered component file over the library frame.
    const chatInputBar = makeStackFiber('src/components/ChatInputBar.tsx', 18, 5, {
      tag: 0,
      type: function ChatInputBar() {},
    });
    // Library internal between the wrapper and the user component (the real-world leak).
    const libInternal = makeStackFiber(
      'node_modules/react-native-safe-area-context/lib/module/SafeAreaContext.js',
      52,
      138,
      {
        tag: 0,
        type: function SafeAreaProvider() {},
        return: chatInputBar,
      },
    );
    // Clicked host div: its own _debugStack frame collapses to the synthetic wrapper.
    const clickedDiv = makeStackFiber('src/__canvas_preview__.tsx', 969, 31, {
      tag: 5,
      type: 'div',
      return: libInternal,
    });
    chatInputBar.child = libInternal;
    libInternal.child = clickedDiv;

    // directSource is the synthetic wrapper — exactly what getSourceLocationFromDOM
    // hands resolveClickLocal for the leaking Tamagui div[style].
    const syntheticDirect = source({
      fileName: 'src/__canvas_preview__.tsx',
      line: 969,
      column: 30,
    });

    const result = resolveCallSiteTarget(syntheticDirect, clickedDiv, 'src/components/ChatInputBar.tsx', 0);

    expect(isSyntheticPreviewPath(result.source.fileName)).toBe(false);
    expect(result.source.fileName).toContain('ChatInputBar.tsx');
    expect(result.source.fileName).not.toContain('node_modules');
    expect(result.source).toEqual({
      fileName: 'src/components/ChatInputBar.tsx',
      line: 18,
      column: 4,
    });
  });

  it('recovers the rendered file from DEEPER in a single _debugStack, past a leading library frame (HYP-424)', () => {
    // The real Docker shape: the clicked div's OWN _debugStack lists the synthetic
    // wrapper, then a react-native-safe-area-context library frame, then the real
    // ChatInputBar.tsx call site — all in ONE stack. A first-frame-per-fiber walk
    // stops at the library frame; the fix must scan every frame and prefer the
    // rendered file.
    const stack = new Error();
    stack.stack = [
      'Error',
      '    at http://localhost:5173/src/__canvas_preview__.tsx:969:31',
      '    at http://localhost:5173/node_modules/react-native-safe-area-context/lib/module/SafeAreaContext.js:52:138',
      '    at http://localhost:5173/src/components/ChatInputBar.tsx:18:5',
    ].join('\n');
    const clickedDiv = mockFiber({ tag: 5, type: 'div', _debugStack: stack } as Partial<Fiber>);

    const syntheticDirect = source({ fileName: 'src/__canvas_preview__.tsx', line: 969, column: 30 });
    const result = resolveCallSiteTarget(syntheticDirect, clickedDiv, 'src/components/ChatInputBar.tsx', 0);

    expect(isSyntheticPreviewPath(result.source.fileName)).toBe(false);
    expect(result.source.fileName).not.toContain('node_modules');
    expect(result.source.fileName).toContain('ChatInputBar.tsx');
    expect(result.source).toEqual({ fileName: 'src/components/ChatInputBar.tsx', line: 18, column: 4 });
  });

  it('recovers the rendered component from a DESCENDANT when the clicked element is the wrapper scaffold div (HYP-424)', () => {
    // The exact Docker shape: the test clicks the FIRST div[style], which is the synthetic
    // wrapper's OWN scaffold container `<div style={...}>{<ChatInputBar/>}</div>`. Its fiber
    // source is the synthetic wrapper and ChatInputBar is its CHILD, not an ancestor — so the
    // upward walk finds nothing and recovery must descend into the subtree.
    const chatInputBar = makeStackFiber('src/components/ChatInputBar.tsx', 18, 5, {
      tag: 0,
      type: function ChatInputBar() {},
    });
    // The wrapper's scaffold container div (its source IS the synthetic wrapper).
    const scaffoldDiv = makeStackFiber('src/__canvas_preview__.tsx', 969, 31, {
      tag: 5,
      type: 'div',
    });
    scaffoldDiv.child = chatInputBar;
    chatInputBar.return = scaffoldDiv;

    const syntheticDirect = source({ fileName: 'src/__canvas_preview__.tsx', line: 969, column: 30 });
    const result = resolveCallSiteTarget(syntheticDirect, scaffoldDiv, 'src/components/ChatInputBar.tsx', 0);

    expect(isSyntheticPreviewPath(result.source.fileName)).toBe(false);
    expect(result.source.fileName).toContain('ChatInputBar.tsx');
    expect(result.source).toEqual({ fileName: 'src/components/ChatInputBar.tsx', line: 18, column: 4 });
  });

  it('does NOT settle for an unrelated ancestor frame when the rendered file is absent (defers to warm-retry) (HYP-424)', () => {
    // Tamagui host nodes can have their own JSX line optimized out of the _debugStack,
    // so the rendered component file is sometimes absent and the only non-synthetic
    // frames are unrelated module boundaries (the app entry src/main.tsx, a wrapping
    // provider). Committing those would be just as wrong as the synthetic wrapper, so
    // recovery yields nothing and the direct (synthetic) source is kept — the click
    // path then routes it into the source-map warm-and-retry, which maps the compiled
    // host position back to the real component. So resolveCallSiteTarget returns the
    // synthetic directSource here (a sentinel the caller treats as "retry", never a
    // committed selection).
    const appEntry = makeStackFiber('src/main.tsx', 10, 92, { tag: 0, type: function App() {} });
    const clickedDiv = makeStackFiber('src/__canvas_preview__.tsx', 969, 31, {
      tag: 5,
      type: 'div',
      return: appEntry,
    });
    appEntry.child = clickedDiv;

    const syntheticDirect = source({ fileName: 'src/__canvas_preview__.tsx', line: 969, column: 30 });

    // renderedFile (ChatInputBar.tsx) is NOT present in the chain — only main.tsx is.
    const result = resolveCallSiteTarget(syntheticDirect, clickedDiv, 'src/components/ChatInputBar.tsx', 0);

    // Must NOT mis-resolve to the unrelated app entry.
    expect(result.source.fileName).not.toContain('main.tsx');
    // Keeps the synthetic direct source as the retry sentinel.
    expect(result.source).toEqual(syntheticDirect);
  });

  it('finds the call site via _debugStack when the imported component ancestor has no _debugSource — React 19 (HYP-897)', () => {
    // Real-world repro (conloca-app, live-verified): OrgSettingsPage.tsx renders
    // <HostRoutePage> (an imported, cross-file component). HostRoutePage's own
    // implementation lives in a different file and returns a host <div> directly —
    // in React 19 that div's nearest ancestor with source info is the HostRoutePage
    // component fiber itself, which carries ONLY `_debugStack` (React 19 never sets
    // `_debugSource`). The old call-site walk checked `current._debugSource`
    // exclusively, so for a React 19 app it silently found no cross-file ancestor
    // and fell through to the direct (wrong-file) source — the Explorer-tree
    // selection's nodeRef (computed from the AST call site "OrgSettingsPage.tsx:56:4")
    // then never matched the FiberSourceIndex key built from this resolution,
    // so `findElementsByRef` missed and the selection overlay never rendered.
    const hostRoutePage = makeStackFiber('src/app/org-settings/OrgSettingsPage.tsx', 56, 5, {
      tag: 0,
      type: function HostRoutePage() {},
    });
    const internalDiv = makeStackFiber('src/app/ui/HostRoutePage.tsx', 12, 4, {
      tag: 5,
      type: 'div',
      return: hostRoutePage,
    });
    hostRoutePage.child = internalDiv;

    const directSource = source({ fileName: 'src/app/ui/HostRoutePage.tsx', line: 12, column: 3 });
    const result = resolveCallSiteTarget(directSource, internalDiv, 'src/app/org-settings/OrgSettingsPage.tsx', 0);

    expect(result.source).toEqual({
      fileName: 'src/app/org-settings/OrgSettingsPage.tsx',
      line: 56,
      column: 4,
    });
  });

  it('does not use a _debugStack-only ancestor as the call site when directSource started synthetic and recovery found nothing (gate x React 19, HYP-897)', () => {
    // Directly locks in the interaction this diff introduces: adding `_debugStack`
    // support to the call-site walk must NOT resurrect the HYP-424 "unrelated ancestor"
    // regression for a React 19 app. Same shape as the pre-existing HYP-424 "does NOT
    // settle for an unrelated ancestor frame" test above (an ancestor whose ONLY source
    // is `_debugStack`, e.g. an app entry point that isn't the rendered file), asserted
    // here under its own name so the gate x _debugStack interaction has a direct test,
    // not just a shared inference from an older test.
    const appEntry = makeStackFiber('src/main.tsx', 10, 92, { tag: 0, type: function App() {} });
    const clickedDiv = makeStackFiber('src/__canvas_preview__.tsx', 969, 31, {
      tag: 5,
      type: 'div',
      return: appEntry,
    });
    appEntry.child = clickedDiv;

    const syntheticDirect = source({ fileName: 'src/__canvas_preview__.tsx', line: 969, column: 30 });
    const result = resolveCallSiteTarget(syntheticDirect, clickedDiv, 'src/components/ChatInputBar.tsx', 0);

    // appEntry has ONLY `_debugStack` (no `_debugSource`) — before this diff it was
    // invisible to the call-site walk entirely; after this diff the walk CAN read it,
    // but the synthetic-direct-source gate must still keep it from being committed.
    expect(result.source.fileName).not.toContain('main.tsx');
    expect(result.source).toEqual(syntheticDirect);
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
