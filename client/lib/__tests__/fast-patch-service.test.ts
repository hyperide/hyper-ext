import { beforeEach, describe, expect, it, mock } from 'bun:test';

/**
 * FastPatchService rebuilt on the ElementTracer bridge (HYP-411).
 * The Phase 1 version targeted a `[data-uniq-id]` attribute that HYP-268
 * removed from the preview DOM. The rebuild resolves the live element via
 * the tracer (getElementFromIframe), tags it with its own attribute, and
 * injects a <style> rule keyed off that tag — so it works regardless of
 * what attributes the rendered DOM carries.
 */

interface FakeEl {
  attrs: Record<string, string>;
  setAttribute: (k: string, v: string) => void;
  removeAttribute: (k: string) => void;
}

function makeEl(): FakeEl {
  const attrs: Record<string, string> = {};
  return {
    attrs,
    setAttribute: (k, v) => {
      attrs[k] = v;
    },
    removeAttribute: (k) => {
      delete attrs[k];
    },
  };
}

let resolved: Record<string, FakeEl | null> = {};
let mockStyleEl: { textContent: string; id: string } | null = null;
let hasIframe = true;

mock.module('@/lib/dom-utils', () => ({
  getElementFromIframe: (elementId: string) => resolved[elementId] ?? null,
  getPreviewIframe: () =>
    hasIframe
      ? {
          contentDocument: {
            getElementById: () => mockStyleEl,
            createElement: () => {
              mockStyleEl = { textContent: '', id: '' };
              return mockStyleEl;
            },
            head: { appendChild: () => {} },
          },
        }
      : null,
  getDOMClassesFromIframe: () => '',
  getComputedStylesFromIframe: () => null,
}));

import { FastPatchService } from '../fast-patch-service';

describe('FastPatchService (tracer bridge)', () => {
  let service: FastPatchService;

  beforeEach(() => {
    resolved = {};
    mockStyleEl = null;
    hasIframe = true;
    service = new FastPatchService();
  });

  it('tags the tracer-resolved element and injects a rule keyed off the tag', () => {
    const el = makeEl();
    resolved['elem-1'] = el;

    service.applyPatch('elem-1', { backgroundColor: 'red', padding: '16px' });

    const tag = el.attrs['data-fast-patch-id'];
    expect(tag).toBeDefined();
    expect(mockStyleEl?.textContent).toContain(`[data-fast-patch-id="${tag}"]`);
    expect(mockStyleEl?.textContent).toContain('background-color: red !important');
    expect(mockStyleEl?.textContent).toContain('padding: 16px !important');
    // It must NOT rely on the removed data-uniq-id substrate.
    expect(mockStyleEl?.textContent).not.toContain('data-uniq-id');
  });

  it('replaces the previous patch for the same element (stable tag)', () => {
    const el = makeEl();
    resolved['elem-1'] = el;

    service.applyPatch('elem-1', { color: 'red' });
    const firstTag = el.attrs['data-fast-patch-id'];
    service.applyPatch('elem-1', { color: 'blue' });

    expect(el.attrs['data-fast-patch-id']).toBe(firstTag);
    expect(mockStyleEl?.textContent).toContain('color: blue');
    expect(mockStyleEl?.textContent).not.toContain('color: red');
  });

  it('clearPatch removes the rule and untags the element', () => {
    const el1 = makeEl();
    const el2 = makeEl();
    resolved['elem-1'] = el1;
    resolved['elem-2'] = el2;

    service.applyPatch('elem-1', { color: 'red' });
    service.applyPatch('elem-2', { color: 'blue' });
    const tag1 = el1.attrs['data-fast-patch-id'];
    service.clearPatch('elem-1');

    expect(el1.attrs['data-fast-patch-id']).toBeUndefined();
    expect(mockStyleEl?.textContent).not.toContain(`[data-fast-patch-id="${tag1}"]`);
    expect(mockStyleEl?.textContent).toContain('color: blue');
  });

  it('clearAll untags every element and empties the stylesheet', () => {
    const el1 = makeEl();
    const el2 = makeEl();
    resolved['elem-1'] = el1;
    resolved['elem-2'] = el2;

    service.applyPatch('elem-1', { color: 'red' });
    service.applyPatch('elem-2', { color: 'blue' });
    service.clearAll();

    expect(el1.attrs['data-fast-patch-id']).toBeUndefined();
    expect(el2.attrs['data-fast-patch-id']).toBeUndefined();
    expect(mockStyleEl?.textContent).toBe('');
  });

  it('does not throw and paints nothing when the element cannot be resolved', () => {
    expect(() => service.applyPatch('missing', { color: 'red' })).not.toThrow();
    expect(mockStyleEl?.textContent ?? '').toBe('');
  });

  it('does not throw when the preview iframe is missing', () => {
    hasIframe = false;
    const el = makeEl();
    resolved['elem-1'] = el;
    expect(() => service.applyPatch('elem-1', { color: 'red' })).not.toThrow();
  });
});
