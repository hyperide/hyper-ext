import { describe, expect, it } from 'bun:test';
import { computeAttentionProps } from '../ComponentErrorOverlay';
import type { SimplePropInfo } from '../PropsForm';

function p(name: string): SimplePropInfo {
  return { name, type: 'unknown', required: false };
}

describe('computeAttentionProps', () => {
  it('drops error-extracted props that have no editable field in the schema', () => {
    // `name` was scraped from a runtime crash but is NOT in the prop schema, so the
    // Props panel renders no field for it — it must not be flagged "needs attention".
    const result = computeAttentionProps({
      unsatisfiedProps: [],
      extractedProps: ['name'],
      propsSchema: [p('variant'), p('children'), p('className')],
    });
    expect(result).not.toContain('name');
    expect(result).toEqual([]);
  });

  it('keeps unsatisfied props that ARE in the schema', () => {
    const result = computeAttentionProps({
      unsatisfiedProps: ['config'],
      extractedProps: [],
      propsSchema: [p('config'), p('variant')],
    });
    expect(result).toEqual(['config']);
  });

  it('keeps an extracted prop that also exists in the schema', () => {
    const result = computeAttentionProps({
      unsatisfiedProps: [],
      extractedProps: ['variant'],
      propsSchema: [p('variant')],
    });
    expect(result).toEqual(['variant']);
  });

  it('falls back to extracted props as editable fields when no schema is available', () => {
    // No schema → PropsForm renders a text field per extracted prop, so flagging
    // them is consistent.
    const result = computeAttentionProps({
      unsatisfiedProps: [],
      extractedProps: ['tweet'],
      propsSchema: null,
    });
    expect(result).toEqual(['tweet']);
  });

  it('dedupes the union of unsatisfied and extracted props', () => {
    const result = computeAttentionProps({
      unsatisfiedProps: ['config'],
      extractedProps: ['config'],
      propsSchema: [p('config')],
    });
    expect(result).toEqual(['config']);
  });

  it('returns empty when a present-but-empty schema has no editable field for an extracted prop', () => {
    // PropsForm uses `propsSchema ? schema.map(...) : extracted.map(...)` — a
    // non-null (even empty) schema is the field source, so no field is rendered for
    // `name`. Flagging it would be inconsistent with the Props panel.
    const result = computeAttentionProps({
      unsatisfiedProps: [],
      extractedProps: ['name'],
      propsSchema: [],
    });
    expect(result).toEqual([]);
  });
});
