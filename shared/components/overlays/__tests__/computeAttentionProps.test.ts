import { describe, expect, it } from 'bun:test';
import { computeAttentionProps } from '../ComponentErrorOverlay';
import type { SimplePropInfo } from '../PropsForm';

function p(name: string, type = 'unknown', required = false): SimplePropInfo {
  return { name, type, required };
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

  it('excludes function props — PropsForm renders them "Not editable", so flagging is useless (HYP-485)', () => {
    // `onClick` is a required function the auto-sample generator can't satisfy, but the
    // Props panel shows it as "Not editable (function)" — flagging it gives the user
    // nothing to act on.
    const result = computeAttentionProps({
      unsatisfiedProps: ['onClick'],
      extractedProps: ['onClick'],
      propsSchema: [p('onClick', '() => void', true), p('variant', 'string', false)],
    });
    expect(result).not.toContain('onClick');
    expect(result).toEqual([]);
  });

  it('excludes reactNode props — also "Not editable" in PropsForm (HYP-485)', () => {
    const result = computeAttentionProps({
      unsatisfiedProps: ['icon'],
      extractedProps: [],
      propsSchema: [p('icon', 'ReactNode', false), p('label', 'string', false)],
    });
    expect(result).not.toContain('icon');
    expect(result).toEqual([]);
  });

  // The real producer is componentSourceParser.getTypeString(), which emits the bare
  // word "Function" for `() => void` — NOT the arrow syntax the hand-written tests used.
  // toPropTypeInfo must recognise the parser's vocabulary or production function props
  // map to `unknown`, render as editable text, and resurface in "needs attention".
  it('excludes function props typed as the parser-emitted "Function" (HYP-485)', () => {
    const result = computeAttentionProps({
      unsatisfiedProps: ['onClick'],
      extractedProps: ['onClick'],
      propsSchema: [p('onClick', 'Function', true), p('variant', 'string', false)],
    });
    expect(result).not.toContain('onClick');
    expect(result).toEqual([]);
  });

  // componentSourceParser / sample-values treat ReactElement, React.ReactElement,
  // JSXElement and React.JSX.Element as ReactNode-ish element types. toPropTypeInfo
  // must mirror that set, else they drift to `unknown` and stay attention-eligible.
  it.each(['ReactElement', 'React.ReactElement', 'JSXElement', 'React.JSX.Element'])(
    'excludes react-element prop typed as %s (HYP-485)',
    (type) => {
      const result = computeAttentionProps({
        unsatisfiedProps: ['icon'],
        extractedProps: ['icon'],
        propsSchema: [p('icon', type, true), p('label', 'string', false)],
      });
      expect(result).not.toContain('icon');
      expect(result).toEqual([]);
    },
  );

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
