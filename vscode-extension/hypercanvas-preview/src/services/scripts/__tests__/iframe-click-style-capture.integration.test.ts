/**
 * Integration coverage for HYP-1420 Codex P2 (PR #773), through the REAL shared click handler
 * (`@shared/canvas-interaction/click-handler`'s `attachClickHandler`) rather than a synthetic
 * unit test of `resolveStyleCaptureElement` alone (see `iframe-style-capture-resolver.test.ts`
 * for that narrower coverage).
 *
 * Reproduces the exact shape of the bug: a click fires on a NESTED, non-SVG descendant (a
 * `<span>` — SVG icons directly parented by BUTTON/A/LABEL are already escalated to the parent
 * by `resolveOpaqueTarget` before `resolveClickLocal` ever runs, so they can't reproduce this
 * defect; see the module doc below), while the resolver (standing in for
 * `resolveClickLocal`'s real call-site-collapse behavior — e.g. the span living inside a
 * `node_modules` primitive) resolves `nodeRef`/`source` to the OUTER host's call site. This
 * proves two things through production code, not assumptions:
 *   1. `attachClickHandler` really does hand `onElementClick` the raw nested element as `el`
 *      when the resolver's ref diverges from the clicked node (the defect's precondition).
 *   2. Feeding that ref/itemIndex through `resolveStyleCaptureElement` (the fix applied in
 *      `iframe-interaction.ts`) recovers the SAME outer host `findElementsByRef` would return —
 *      not the raw nested element — for runtime style capture.
 */
import { describe, expect, test } from 'bun:test';
import { attachClickHandler } from '@shared/canvas-interaction/click-handler';
import { computeEffectiveRef } from '@shared/canvas-interaction/selection-utils';
import type { LocalResolveResult, TracingResolver } from '@shared/canvas-interaction/types';
import type { NodeMapEntry, SourceLocation } from '@shared/element-tracing/types';
import { resolveStyleCaptureElement } from '../iframe-style-capture-resolver';

const OUTER_HOST_SOURCE: SourceLocation = { fileName: '/src/Button.tsx', line: 12, column: 4 };
const OUTER_HOST_REF = `${OUTER_HOST_SOURCE.fileName}:${OUTER_HOST_SOURCE.line}:${OUTER_HOST_SOURCE.column}`;

const MOCK_ENTRY: NodeMapEntry = {
  nodeRef: OUTER_HOST_REF,
  tag: 'button',
  loc: OUTER_HOST_SOURCE,
  endLoc: OUTER_HOST_SOURCE,
  parentRef: null,
  children: [],
  isComponent: false,
  fingerprint: 'stub',
};

describe('runtime style capture resolves through the same index as the collapsed click ref (HYP-1420 Codex P2)', () => {
  test('a click on a nested non-SVG descendant whose resolved ref points at an outer host captures computedStyle from that outer host, not the raw clicked descendant', () => {
    document.body.innerHTML = '';

    // Outer host: what the resize handle / selection overlay actually key off (explicit,
    // measurably different size from the nested leaf so the assertion is unambiguous).
    const outerHost = document.createElement('button');
    outerHost.style.width = '200px';
    outerHost.style.height = '48px';

    // Nested leaf: the element the click event ACTUALLY fires on (e.g. a node_modules
    // primitive's internal span/icon collapsed by call-site resolution to `outerHost`'s ref).
    const nestedLeaf = document.createElement('span');
    nestedLeaf.style.width = '12px';
    nestedLeaf.style.height = '12px';
    outerHost.appendChild(nestedLeaf);
    document.body.appendChild(outerHost);

    // Stand-in fiber index: resolves the outer host's ref back to the outer host DOM element —
    // exactly like the real `findElementsByRef` does for a collapsed call-site ref.
    const findElementsByRef = (ref: string, _itemIndex: number | null): HTMLElement[] =>
      ref === OUTER_HOST_REF ? [outerHost] : [];

    // Stand-in resolver: simulates `resolveClickLocal` collapsing a nested-primitive click to
    // the outer host's call site while still handing back the clicked (nested) DOM element as
    // `element` is NOT part of its return — `attachClickHandler` passes the raw `target` it
    // received, not anything from the resolver, which is exactly the defect's precondition.
    const resolver: TracingResolver = {
      getSourceLocation: () => null,
      getItemIndex: () => 0,
      resolveClickLocal: (): LocalResolveResult | null => ({
        nodeRef: OUTER_HOST_REF,
        entry: MOCK_ENTRY,
        source: OUTER_HOST_SOURCE,
        itemIndex: 0,
      }),
      findDOMElement: () => null,
    };

    let capturedNodeRef: string | null = null;
    let capturedEl: HTMLElement | null = null;
    let capturedItemIndex: number | null = null;
    let capturedSource: SourceLocation | null = null;

    const dispose = attachClickHandler(
      document,
      {
        onElementClick: (nodeRef, el, _e, itemIndex, source) => {
          capturedNodeRef = nodeRef;
          capturedEl = el;
          capturedItemIndex = itemIndex;
          capturedSource = source;
        },
        onElementHover: () => {},
        getMode: () => 'design',
      },
      resolver,
    );

    try {
      nestedLeaf.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      // Precondition: the real shared click handler hands back the raw NESTED element as `el`,
      // proving this scenario genuinely reaches `iframe-interaction.ts`'s call sites the way
      // the Codex finding describes — not just an assumption about what `attachClickHandler` does.
      expect(capturedEl).toBe(nestedLeaf);
      expect(capturedNodeRef).toBe(OUTER_HOST_REF);

      // Apply the same fix logic as iframe-interaction.ts's onElementClick handler.
      const effectiveRef = capturedSource
        ? computeEffectiveRef(capturedNodeRef, capturedSource)
        : capturedNodeRef;
      const resolvedEl = resolveStyleCaptureElement(effectiveRef, capturedItemIndex, capturedEl!, findElementsByRef);

      expect(resolvedEl).toBe(outerHost);
      expect(resolvedEl).not.toBe(nestedLeaf);
      expect(resolvedEl.style.width).toBe('200px');
      expect(resolvedEl.style.height).toBe('48px');
    } finally {
      dispose();
      document.body.innerHTML = '';
    }
  });
});
