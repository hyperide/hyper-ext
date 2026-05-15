import { describe, expect, it } from 'bun:test';
import { liftToCommonSiblings } from './drop-target-lift';

interface MockNode {
  tagName: string;
  parentElement: MockNode | null;
}

function makeEl(tagName: string): MockNode {
  return { tagName, parentElement: null };
}

function setParent(child: MockNode, parent: MockNode | null) {
  child.parentElement = parent;
}

describe('liftToCommonSiblings', () => {
  it('returns null pair when source and drop are the same element', () => {
    const a = makeEl('DIV') as unknown as HTMLElement;
    const result = liftToCommonSiblings(a, a);
    expect(result.source).toBeNull();
    expect(result.drop).toBeNull();
  });

  it('lifts an inner span and a sibling card to siblings of their grid container', () => {
    // Tree:
    //   grid
    //   ├── cardA
    //   │   └── innerSpan       ← drag source (e.g. emoji)
    //   └── cardB               ← drop target
    const grid = makeEl('DIV');
    const cardA = makeEl('DIV');
    const innerSpan = makeEl('SPAN');
    const cardB = makeEl('DIV');
    setParent(cardA, grid);
    setParent(innerSpan, cardA);
    setParent(cardB, grid);

    const result = liftToCommonSiblings(
      innerSpan as unknown as HTMLElement,
      cardB as unknown as HTMLElement,
    );
    expect(result.source).toBe(cardA as unknown as HTMLElement);
    expect(result.drop).toBe(cardB as unknown as HTMLElement);
  });

  it('lifts both sides when both are deeply nested under their cards', () => {
    // grid
    // ├── cardA
    // │   └── wrapperA
    // │       └── textA
    // └── cardB
    //     └── wrapperB
    //         └── textB
    const grid = makeEl('DIV');
    const cardA = makeEl('DIV');
    const wrapperA = makeEl('DIV');
    const textA = makeEl('DIV');
    const cardB = makeEl('DIV');
    const wrapperB = makeEl('DIV');
    const textB = makeEl('DIV');
    setParent(cardA, grid);
    setParent(wrapperA, cardA);
    setParent(textA, wrapperA);
    setParent(cardB, grid);
    setParent(wrapperB, cardB);
    setParent(textB, wrapperB);

    const result = liftToCommonSiblings(
      textA as unknown as HTMLElement,
      textB as unknown as HTMLElement,
    );
    expect(result.source).toBe(cardA as unknown as HTMLElement);
    expect(result.drop).toBe(cardB as unknown as HTMLElement);
  });

  it('returns null pair when there is no common ancestor', () => {
    const a = makeEl('DIV') as unknown as HTMLElement;
    const b = makeEl('DIV') as unknown as HTMLElement;
    const result = liftToCommonSiblings(a, b);
    expect(result.source).toBeNull();
    expect(result.drop).toBeNull();
  });

  it('returns null when one side is the common ancestor itself', () => {
    // dropping ON the parent of the source: there is nothing to lift on the
    // drop side because drop IS the common ancestor.
    const grid = makeEl('DIV');
    const card = makeEl('DIV');
    setParent(card, grid);
    const result = liftToCommonSiblings(
      card as unknown as HTMLElement,
      grid as unknown as HTMLElement,
    );
    expect(result.source).toBe(card as unknown as HTMLElement);
    expect(result.drop).toBeNull();
  });
});
