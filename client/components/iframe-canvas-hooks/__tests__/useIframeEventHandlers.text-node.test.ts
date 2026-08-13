/**
 * @file useIframeEventHandlers — Text-node target guard (e2e #13, SaaS consumer).
 *
 * Accessed via: the SaaS canvas iframe — `useIframeEventHandlers` wires capture-phase
 *   click / mousedown / mouseover listeners on the previewed document.
 * Why this exists: clicking/hovering VISIBLE TEXT inside the preview reports
 *   `e.target` as a Text node (nodeType 3, no `closest` / `getAttribute`). Before the
 *   fix the handlers did `const target = e.target as HTMLElement` then `target.closest(...)`
 *   / `tracer.resolveClickLocal(target)` and threw `target.closest is not a function`
 *   (`i.getAttribute is not a function` in the e2e cascade, ~333 failures).
 * Guard: the handlers now run `e.target` through the shared `normalizeEventTarget`
 *   helper (the SAME helper the extension's iframe-drag-handlers consume — AGENTS.md
 *   HARD RULE: an element-resolution fix must be consumed by BOTH client/ and the ext).
 *   This proves the SaaS side resolves a Text-node press to the owning Element instead
 *   of crashing.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useIframeEventHandlers } from '../useIframeEventHandlers';
import type { ElementTracer } from '@/lib/element-tracing/element-tracer';
import type { SourceLocation } from '@shared/element-tracing/types';

const SOURCE: SourceLocation = { fileName: 'src/App.tsx', line: 10, column: 2 };

/**
 * A minimal tracer that RECORDS the element handed to `resolveClickLocal`, so the
 * test can assert the handler passed the owning Element (not the raw Text node).
 * Cast to ElementTracer — the hook only touches these three members.
 */
function makeRecordingTracer() {
  const seen: { resolveClickLocal: HTMLElement[] } = { resolveClickLocal: [] };
  const tracer = {
    resolveClickLocal: (el: HTMLElement) => {
      seen.resolveClickLocal.push(el);
      return { nodeRef: 'ref-1', itemIndex: null, source: SOURCE };
    },
    getSourceLocation: () => SOURCE,
    getItemIndex: () => null,
  } as unknown as ElementTracer;
  return { tracer, seen };
}

/**
 * Use the MAIN happy-dom document as the iframe's `contentDocument`.
 *
 * A live `<iframe>.contentDocument` is a separate happy-dom realm whose globals
 * (e.g. `SyntaxError`) are undefined, which trips `@testing-library/react`'s
 * act-compat during `renderHook`. The main-realm document is a real `Document`
 * with working `addEventListener` / `closest` / `Text`, so the handlers and the
 * dispatched events behave identically while staying in one realm.
 */
function makeLiveIframe() {
  const doc = document;
  const iframe = { contentDocument: doc, contentWindow: window } as unknown as HTMLIFrameElement;
  return { iframe, doc };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useIframeEventHandlers — Text-node target (SaaS consumer of normalizeEventTarget)', () => {
  test('design-mode click whose e.target is a Text node → no throw, resolves the owning <button>', () => {
    const { iframe, doc } = makeLiveIframe();
    const button = doc.createElement('button');
    const label = doc.createTextNode('Click me');
    button.appendChild(label);
    doc.body.appendChild(button);

    const { tracer, seen } = makeRecordingTracer();
    const onElementClick = mock((_ref: string | null, _el: HTMLElement) => {});

    renderHook(() =>
      useIframeEventHandlers({
        iframeRef: { current: iframe },
        engine: { getMode: () => 'design' },
        tracer,
        setPendingSelection: () => {},
        canvasMode: 'single',
        onElementClick,
      }),
    );

    // Dispatch a real capture-phase click whose target is the Text node, exactly like
    // a user pressing on the button's visible label. Before the guard this threw inside
    // the handler; the dispatch must complete cleanly.
    act(() => {
      const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
      expect(() => label.dispatchEvent(evt)).not.toThrow();
    });

    // The handler resolved the OWNING element (the button), not the Text node.
    expect(seen.resolveClickLocal).toHaveLength(1);
    expect(seen.resolveClickLocal[0]).toBe(button as unknown as HTMLElement);
    expect(onElementClick).toHaveBeenCalledTimes(1);
    expect(onElementClick.mock.calls[0][1]).toBe(button as unknown as HTMLElement);
  });

  test('design-mode hover whose e.target is a Text node → no throw, resolves the owning element', () => {
    const { iframe, doc } = makeLiveIframe();
    const card = doc.createElement('div');
    const text = doc.createTextNode('hover me');
    card.appendChild(text);
    doc.body.appendChild(card);

    const { tracer, seen } = makeRecordingTracer();
    const onElementHover = mock((_ref: string | null, _el: HTMLElement | null) => {});

    renderHook(() =>
      useIframeEventHandlers({
        iframeRef: { current: iframe },
        engine: { getMode: () => 'design' },
        tracer,
        setPendingSelection: () => {},
        canvasMode: 'single',
        onElementHover,
      }),
    );

    act(() => {
      const evt = new MouseEvent('mouseover', { bubbles: true, cancelable: true });
      expect(() => text.dispatchEvent(evt)).not.toThrow();
    });

    expect(seen.resolveClickLocal).toHaveLength(1);
    expect(seen.resolveClickLocal[0]).toBe(card as unknown as HTMLElement);
    expect(onElementHover).toHaveBeenCalledTimes(1);
    expect(onElementHover.mock.calls[0][1]).toBe(card as unknown as HTMLElement);
  });
});
