/**
 * Regression coverage for HYP-1420 Codex P2 (PR #773): clicking a NESTED element inside a
 * Radix `asChild`/Slot shadcn component (e.g. an icon inside a `<Button asChild>`) must have
 * its runtime style captured from the RESOLVED outermost host `findElementsByRef` returns —
 * the same element the resize handle / selection overlay key off — not the raw nested element
 * the click event fired on. Also covers the DOM `.contains()` structural guard added in the
 * same PR's follow-up review rounds: `findElementsByRef` is approximate by design (same-line
 * fallback, cross-path-format rescue, `.map()`-item indexing keyed off a counted `itemIndex`),
 * so a resolved "match" can land in a DISJOINT part of the DOM tree from the element actually
 * clicked (wrong `.map()` instance, a same-basename-different-file collision) — the guard
 * refuses any candidate that doesn't structurally contain the clicked element. It deliberately
 * does NOT disambiguate a candidate that IS a containing ancestor (e.g. a same-line fallback
 * landing on a wrapper instead of the real target) — see `iframe-style-capture-resolver.ts`'s
 * doc comment for why that's intentional (parity with the resize handle's own lookup), and
 * `fiber-source-index.test.ts`'s `findClosestLineDOMElements` hazard test for a live example.
 * See `iframe-style-capture-resolver.ts`'s header comment for the full bug narrative.
 */
import { describe, expect, test } from 'bun:test';
import { resolveStyleCaptureElement } from '../iframe-style-capture-resolver';

function makeButtonWithIcon(): { button: HTMLElement; icon: HTMLElement } {
  const button = document.createElement('button');
  const icon = document.createElement('svg');
  button.appendChild(icon);
  return { button, icon };
}

describe('resolveStyleCaptureElement', () => {
  test('a click on a nested icon inside an asChild Button resolves to the outermost Button host, not the icon', () => {
    const { button, icon } = makeButtonWithIcon();
    const ref = 'Button.tsx:12:4';
    const findElementsByRef = (r: string, itemIndex: number | null) => {
      // Mirrors the real index: a click on the icon resolves (via call-site collapse) to the
      // Button's own source ref, and the index returns the outermost host for that ref —
      // NOT the icon the click event actually fired on.
      expect(itemIndex).toBe(null);
      return r === ref ? [button] : [];
    };

    const resolved = resolveStyleCaptureElement(ref, null, icon, findElementsByRef);

    expect(resolved).toBe(button);
    expect(resolved).not.toBe(icon);
  });

  test('falls back to the raw clicked/pending element when ref is null', () => {
    const { icon } = makeButtonWithIcon();
    const findElementsByRef = () => {
      throw new Error('must not be called when ref is null');
    };

    const resolved = resolveStyleCaptureElement(null, null, icon, findElementsByRef);

    expect(resolved).toBe(icon);
  });

  test('falls back to the raw clicked/pending element when the index cannot resolve the ref yet (cold cache)', () => {
    const { icon } = makeButtonWithIcon();
    const findElementsByRef = () => [];

    const resolved = resolveStyleCaptureElement('Button.tsx:12:4', null, icon, findElementsByRef);

    expect(resolved).toBe(icon);
  });

  test('threads itemIndex through so a .map()-rendered instance resolves the matching host, not a sibling', () => {
    const rowA = document.createElement('button');
    const rowB = document.createElement('button');
    const iconInRowB = document.createElement('svg');
    rowB.appendChild(iconInRowB);
    const ref = 'List.tsx:5:6';
    const findElementsByRef = (r: string, itemIndex: number | null) => {
      if (r !== ref) return [];
      if (itemIndex === 0) return [rowA];
      if (itemIndex === 1) return [rowB];
      return [];
    };

    const resolved = resolveStyleCaptureElement(ref, 1, iconInRowB, findElementsByRef);

    expect(resolved).toBe(rowB);
    expect(resolved).not.toBe(rowA);
    expect(resolved).not.toBe(iconInRowB);
  });

  // HYP-1420 Codex P2 follow-up (PR #773, third review round): two sibling `.map()`-repeated
  // instances share the SAME call-site ref. If the itemIndex reconciliation upstream
  // (`resolveCallSiteTarget`) ever miscounts — e.g. reporting `itemIndex === 0` for a click that
  // actually landed inside the SECOND instance's nested icon — a naive `findElementsByRef(...)[0]`
  // would silently capture the FIRST instance's runtime style for a click on the second. The
  // `.contains()` structural guard catches this: instance #0's host cannot contain an element
  // that is actually rendered inside instance #1's own subtree.
  test('rejects a same-ref sibling instance the index returns for a miscounted itemIndex, falling back to the raw clicked element', () => {
    const instance0Host = document.createElement('button');
    const instance1Host = document.createElement('button');
    const iconInInstance1 = document.createElement('svg');
    instance1Host.appendChild(iconInInstance1);
    // Both instances render from the SAME JSX call site (a `.map()` loop), so they share a ref —
    // only itemIndex is supposed to disambiguate which live DOM instance is meant.
    const ref = 'ListItem.tsx:8:6';
    const findElementsByRef = (r: string, itemIndex: number | null) => {
      if (r !== ref) return [];
      // Simulates the miscount: the click genuinely happened in instance #1, but the itemIndex
      // handed to this lookup wrongly says 0.
      return itemIndex === 0 ? [instance0Host] : [];
    };

    const resolved = resolveStyleCaptureElement(ref, 0, iconInInstance1, findElementsByRef);

    // instance0Host does NOT contain iconInInstance1 (separate DOM subtrees) — the guard must
    // refuse the wrong-instance candidate and keep the element that was actually clicked.
    expect(resolved).toBe(iconInInstance1);
    expect(resolved).not.toBe(instance0Host);
  });

  // HYP-1420 Codex P2 follow-up (PR #773, third review round): a same-basename-different-file
  // collision (`findDOMElementsAcrossPathFormats`'s cross-format rescue can match two entirely
  // different files sharing a basename+line+column — see fiber-source-index.test.ts's
  // "same-basename-different-file collision" case) or any other unrelated-element substitution
  // collapses to the identical shape: the "resolved" candidate is some DOM element that has no
  // structural relationship to the element the click actually fired on.
  test('rejects a wholly unrelated candidate element (different subtree entirely), falling back to the raw clicked element', () => {
    const clickedIcon = document.createElement('svg');
    document.body.appendChild(clickedIcon);
    const unrelatedElementFromAnotherFile = document.createElement('button');
    document.body.appendChild(unrelatedElementFromAnotherFile);
    const ref = 'Button.tsx:12:4';
    const findElementsByRef = () => [unrelatedElementFromAnotherFile];

    const resolved = resolveStyleCaptureElement(ref, 0, clickedIcon, findElementsByRef);

    expect(resolved).toBe(clickedIcon);
    expect(resolved).not.toBe(unrelatedElementFromAnotherFile);

    clickedIcon.remove();
    unrelatedElementFromAnotherFile.remove();
  });

  test('a divergence-free resolution (candidate is exactly the clicked element) is accepted via DOM self-containment', () => {
    const el = document.createElement('button');
    const ref = 'Button.tsx:12:4';
    const findElementsByRef = () => [el];

    const resolved = resolveStyleCaptureElement(ref, 0, el, findElementsByRef);

    expect(resolved).toBe(el);
  });
});
