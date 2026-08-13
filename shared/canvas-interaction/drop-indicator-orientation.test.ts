/**
 * @file Tests for `chooseIndicatorOrientation` (drop-indicator-orientation.ts).
 *
 * Accessed via: Internal module, not exposed.
 *
 * Covers the two regressions reported on 2026-05-06:
 * - Tailwind `grid grid-cols-2 gap-3` was inferred as vertical because
 *   `gridAutoFlow` resolved to default `'row'`.
 * - Wrapper `<div>` between drop element and the actual flex-row container
 *   broke the previous immediate-parent check.
 */

import { describe, expect, it } from "bun:test";
import { chooseIndicatorOrientation, isHorizontalLayout } from "./drop-indicator-orientation";

interface FakeStyle {
  display?: string;
  flexDirection?: string;
  gridAutoFlow?: string;
  gridTemplateColumns?: string;
}

interface FakeElement {
  parent: FakeElement | null;
  style: FakeStyle;
}

function makeChain(...layers: FakeStyle[]): HTMLElement {
  // layers[0] is the drop element, layers[1] its parent, layers[2] grandparent, ...
  let prev: FakeElement | null = null;
  for (let i = layers.length - 1; i >= 0; i--) {
    const cur: FakeElement = { parent: prev, style: layers[i] };
    prev = cur;
  }
  // Wrap in HTMLElement-shaped facade. parentElement walks up the chain;
  // getComputedStyle is injected via deps.
  const drop = prev as FakeElement;
  return wrap(drop) as unknown as HTMLElement;
}

interface FakeHTMLElement {
  parentElement: FakeHTMLElement | null;
  __node: FakeElement;
}

function wrap(node: FakeElement): FakeHTMLElement {
  return {
    get parentElement() {
      return node.parent ? wrapMemo(node.parent) : null;
    },
    __node: node,
  } as FakeHTMLElement;
}

const memo = new WeakMap<FakeElement, FakeHTMLElement>();
function wrapMemo(node: FakeElement): FakeHTMLElement {
  const cached = memo.get(node);
  if (cached) return cached;
  const w = wrap(node);
  memo.set(node, w);
  return w;
}

function styleOf(el: HTMLElement): CSSStyleDeclaration {
  const node = (el as unknown as FakeHTMLElement).__node;
  return node.style as unknown as CSSStyleDeclaration;
}

describe("chooseIndicatorOrientation", () => {
  it("returns horizontal for flex-row immediate parent", () => {
    const drop = makeChain({}, { display: "flex", flexDirection: "row" });
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("horizontal");
  });

  it("returns horizontal for flex row-reverse", () => {
    const drop = makeChain({}, { display: "flex", flexDirection: "row-reverse" });
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("horizontal");
  });

  it("returns vertical for flex-column immediate parent", () => {
    const drop = makeChain({}, { display: "flex", flexDirection: "column" });
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("vertical");
  });

  it("returns vertical for inline-flex column-reverse", () => {
    const drop = makeChain({}, { display: "inline-flex", flexDirection: "column-reverse" });
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("vertical");
  });

  it("inline-flex row → horizontal", () => {
    const drop = makeChain({}, { display: "inline-flex", flexDirection: "row" });
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("horizontal");
  });

  // Regression: Tailwind's `grid grid-cols-2 gap-3` from bulka Index.tsx:272.
  it("grid with multiple column tracks and default row flow → horizontal", () => {
    const drop = makeChain(
      {}, // dropEl (the card)
      {
        display: "grid",
        gridAutoFlow: "row",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
      },
    );
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("horizontal");
  });

  it("grid with single column track and row flow → vertical", () => {
    const drop = makeChain({}, { display: "grid", gridAutoFlow: "row", gridTemplateColumns: "minmax(0, 1fr)" });
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("vertical");
  });

  it("grid-auto-flow column → horizontal regardless of column tracks", () => {
    const drop = makeChain({}, { display: "grid", gridAutoFlow: "column", gridTemplateColumns: "none" });
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("horizontal");
  });

  it("grid-auto-flow column dense → horizontal", () => {
    const drop = makeChain({}, { display: "grid", gridAutoFlow: "column dense" });
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("horizontal");
  });

  it("grid with no template columns and row flow → vertical", () => {
    const drop = makeChain({}, { display: "grid", gridAutoFlow: "row", gridTemplateColumns: "none" });
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("vertical");
  });

  // Regression for the second hypothesis: wrapper div between drop element
  // and the actual flex-row container. Old `_isHorizontalLayout` only looked
  // at `dropEl.parentElement` and missed it.
  it("walks past block wrapper div to flex-row grandparent", () => {
    const drop = makeChain(
      {}, // dropEl
      { display: "block" }, // wrapper div, no flex/grid
      { display: "flex", flexDirection: "row" }, // grandparent — actual sibling-level container
    );
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("horizontal");
  });

  it("walks past empty display chain to flex-column ancestor", () => {
    const drop = makeChain({}, { display: "" }, { display: "block" }, { display: "flex", flexDirection: "column" });
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("vertical");
  });

  it("walks past wrapper to grid-cols-2 grandparent", () => {
    const drop = makeChain(
      {},
      { display: "block" },
      { display: "grid", gridAutoFlow: "row", gridTemplateColumns: "1fr 1fr" },
    );
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("horizontal");
  });

  it("returns vertical when chain has no flex/grid ancestor", () => {
    const drop = makeChain({}, { display: "block" }, { display: "block" });
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("vertical");
  });

  it("returns vertical for orphan element (no parent)", () => {
    const drop = makeChain({});
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("vertical");
  });

  it("isHorizontalLayout mirrors chooseIndicatorOrientation === horizontal", () => {
    const horizontal = makeChain({}, { display: "flex", flexDirection: "row" });
    const vertical = makeChain({}, { display: "flex", flexDirection: "column" });
    expect(isHorizontalLayout(horizontal, { getComputedStyle: styleOf })).toBe(true);
    expect(isHorizontalLayout(vertical, { getComputedStyle: styleOf })).toBe(false);
  });

  // Regression: getComputedStyle().gridTemplateColumns includes named grid
  // lines (`[content-start] 1fr [content-end]`). Without bracket-stripping
  // each `[name]` token gets counted as an extra track and a single-column
  // grid reads as horizontal.
  it("grid with single track and named line markers → vertical", () => {
    const drop = makeChain(
      {},
      { display: "grid", gridAutoFlow: "row", gridTemplateColumns: "[content-start] 1fr [content-end]" },
    );
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("vertical");
  });

  it("grid with two tracks and named lines around them → horizontal", () => {
    const drop = makeChain(
      {},
      { display: "grid", gridAutoFlow: "row", gridTemplateColumns: "[start] 1fr [mid] 1fr [end]" },
    );
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("horizontal");
  });

  it("grid with multi-name line tokens → counts only real tracks", () => {
    // `[col-1-end col-2-start]` — two names in one bracket — must still be
    // stripped wholesale; the surrounding tracks count as 2.
    const drop = makeChain(
      {},
      {
        display: "grid",
        gridAutoFlow: "row",
        gridTemplateColumns: "[content-start] minmax(0, 1fr) [col-1-end col-2-start] minmax(0, 1fr) [content-end]",
      },
    );
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("horizontal");
  });

  // New cases: el itself is a flex/grid container (cursor over container padding).
  it("el itself is flex-col → vertical (horizontal indicator)", () => {
    const drop = makeChain({ display: "flex", flexDirection: "column" });
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("vertical");
  });

  it("el itself is flex-row → horizontal (vertical indicator)", () => {
    const drop = makeChain({ display: "flex", flexDirection: "row" });
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("horizontal");
  });

  it("el itself is inline-flex column-reverse → vertical", () => {
    const drop = makeChain({ display: "inline-flex", flexDirection: "column-reverse" });
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("vertical");
  });

  it("el itself is grid multi-track → horizontal", () => {
    const drop = makeChain({ display: "grid", gridAutoFlow: "row", gridTemplateColumns: "1fr 1fr" });
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("horizontal");
  });

  it("el itself is grid single-track → vertical", () => {
    const drop = makeChain({ display: "grid", gridAutoFlow: "row", gridTemplateColumns: "minmax(0,1fr)" });
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("vertical");
  });

  it("el itself is flex-col but parent is flex-row → el wins (vertical)", () => {
    const drop = makeChain({ display: "flex", flexDirection: "column" }, { display: "flex", flexDirection: "row" });
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("vertical");
  });

  it("uses nearest flex/grid container, ignoring outer flex-column when inner row matches sibling level", () => {
    // Drop is inside flex-row, which is inside flex-column outer wrapper.
    // We want the orientation at the IMMEDIATE flex/grid ancestor, since
    // that's the one whose direct children are the visual siblings.
    const drop = makeChain({}, { display: "flex", flexDirection: "row" }, { display: "flex", flexDirection: "column" });
    expect(chooseIndicatorOrientation(drop, { getComputedStyle: styleOf })).toBe("horizontal");
  });
});
