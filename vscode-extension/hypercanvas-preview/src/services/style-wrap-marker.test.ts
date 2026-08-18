/**
 * @file HYP-990 (M2) — unit tests for the write-scoped-marker wrap helpers in style-wrap-retry.ts:
 * the marker is stamped on the auto-wrap, verify/rollback key on it, and it makes the surgical
 * inverse unambiguous even against a pre-existing structurally-identical user wrapper.
 */
import _generate from '@babel/generator';
import { describe, expect, it } from 'bun:test';
import { parseCode } from '@lib/ast/parser';
import { findAllJSXElements } from '@lib/ast/traverser';
import type { FindElementResult } from '@lib/types';
import {
  applyWrapCandidate,
  describeEnclosingAutoWrap,
  restoreOwnedWrapStyle,
  restoreWrapStyleByMarker,
  stripWrapperMarker,
  unwrapByMarker,
  updateExistingWrap,
} from './style-wrap-retry';

const generate = (_generate as unknown as { default?: typeof _generate }).default ?? _generate;

function findByTag(code: string, tag: string): { ast: ReturnType<typeof parseCode>; found: FindElementResult } {
  const ast = parseCode(code);
  const found = findAllJSXElements(ast).find(
    (e) => e.element.openingElement.name.type === 'JSXIdentifier' && e.element.openingElement.name.name === tag,
  );
  if (!found) throw new Error(`no <${tag}> in fixture`);
  return { ast, found: found as FindElementResult };
}

const WRAP_SRC = `export function Page() {
  return <Widget />;
}
`;

describe('HYP-990 write-scoped marker', () => {
  it('applyWrapCandidate stamps the transient write marker AND the persistent ownership marker', () => {
    const { ast, found } = findByTag(WRAP_SRC, 'Widget');
    applyWrapCandidate(found, { backgroundColor: '#000' }, 'm1');
    const code = generate(ast).code;
    expect(code).toContain('data-hc-writeid="m1"');
    expect(code).toContain('data-hc-autowrap');
    expect(code).toContain('backgroundColor: "#000"');
  });

  it('unwrapByMarker removes exactly the marked wrapper — never a pre-existing identical user wrapper', () => {
    // A user already authored an identical `<div style={{ backgroundColor: "#000" }}>` around <Other>.
    // Our auto-wrap (marked) goes around <Widget>. Rolling back must remove ONLY ours.
    const src = `export function Page() {
  return (
    <>
      <div style={{ backgroundColor: "#000" }}><Other /></div>
      <div data-hc-writeid="m9" style={{ backgroundColor: "#000" }}><Widget /></div>
    </>
  );
}
`;
    const ast = parseCode(src);
    expect(unwrapByMarker(ast, 'm9')).toBe('removed');
    const code = generate(ast).code;
    // Ours (marked) is gone; the pre-existing identical user wrapper survives.
    expect(code).not.toContain('data-hc-writeid');
    expect(code).toContain('<div style={{');
    expect(code).toContain('<Other />');
    expect(code).toContain('<Widget />');
    // Exactly one `<div` remains — the user's — proving ours was surgically removed, not the user's.
    expect(code.match(/<div/g)?.length).toBe(1);
  });

  it('unwrapByMarker returns absent when no wrapper carries the marker', () => {
    const ast = parseCode(`export const A = () => <div style={{ color: "red" }}><X /></div>;`);
    expect(unwrapByMarker(ast, 'nope')).toBe('absent');
  });

  it('stripWrapperMarker removes only the marker attribute, keeping the wrapper + style', () => {
    const ast = parseCode(`export const A = () => <div data-hc-writeid="k" style={{ color: "red" }}><X /></div>;`);
    expect(stripWrapperMarker(ast, 'k')).toBe('stripped');
    const code = generate(ast).code;
    expect(code).not.toContain('data-hc-writeid');
    expect(code).toContain('style={{');
    expect(code).toContain('color: "red"');
    expect(code).toContain('<X />');
  });

  it('describeEnclosingAutoWrap detects a target inside OUR auto-wrap (persistent ownership marker)', () => {
    const { found } = findByTag(
      `export const A = () => <div data-hc-autowrap style={{ backgroundColor: "#111" }}><Widget /></div>;`,
      'Widget',
    );
    const enclosing = describeEnclosingAutoWrap(found);
    expect(enclosing).not.toBeNull();
    expect(enclosing?.priorStyles).toEqual({ backgroundColor: '#111' });
  });

  it('describeEnclosingAutoWrap does NOT treat a user-authored bare style div as ours (no ownership marker)', () => {
    const { found } = findByTag(
      `export const A = () => <div style={{ backgroundColor: "#111" }}><Widget /></div>;`,
      'Widget',
    );
    // A user's own `<div style>` carries no `data-hc-autowrap` — it must never be updated in place.
    expect(describeEnclosingAutoWrap(found)).toBeNull();
  });

  it('describeEnclosingAutoWrap ignores a real user div carrying extra attributes', () => {
    const { found } = findByTag(
      `export const A = () => <div className="card" style={{ backgroundColor: "#111" }}><Widget /></div>;`,
      'Widget',
    );
    expect(describeEnclosingAutoWrap(found)).toBeNull();
  });

  it('update-in-place then restore round-trips the wrapper style (rollback path)', () => {
    const ast = parseCode(`export const A = () => <div style={{ backgroundColor: "#111" }}><Widget /></div>;`);
    const wrap = findAllJSXElements(ast).find(
      (e) => e.element.openingElement.name.type === 'JSXIdentifier' && e.element.openingElement.name.name === 'div',
    );
    if (!wrap) throw new Error('no wrapper');
    updateExistingWrap(wrap.element, { backgroundColor: '#222' }, 'm3');
    expect(generate(ast).code).toContain('backgroundColor: "#222"');
    expect(generate(ast).code).toContain('data-hc-writeid="m3"');

    expect(restoreWrapStyleByMarker(ast, 'm3', { backgroundColor: '#111' })).toBe('restored');
    const code = generate(ast).code;
    expect(code).toContain('backgroundColor: "#111"');
    expect(code).not.toContain('data-hc-writeid');
    expect(code).not.toContain('#222');
  });

  it('restoreOwnedWrapStyle — structural fallback restores a marker-DROPPED owned wrapper (Opus)', () => {
    // The transient write marker is gone (a formatter dropped it) but data-hc-autowrap persists and
    // the wrapper carries the MERGED (new) style. The structural fallback must revert it to priorStyles.
    const ast = parseCode(
      `export const A = () => <div data-hc-autowrap style={{ backgroundColor: "#222", color: "#333" }}><Widget /></div>;`,
    );
    expect(restoreOwnedWrapStyle(ast, 'Widget', { backgroundColor: '#111' })).toBe('restored');
    const code = generate(ast).code;
    expect(code).toContain('backgroundColor: "#111"');
    expect(code).not.toContain('#222');
    expect(code).not.toContain('#333');
    expect(code).toContain('data-hc-autowrap'); // ownership marker kept
  });

  it('restoreOwnedWrapStyle — NEVER touches a user div with no ownership marker', () => {
    const ast = parseCode(`export const A = () => <div style={{ backgroundColor: "#222" }}><Widget /></div>;`);
    expect(restoreOwnedWrapStyle(ast, 'Widget', { backgroundColor: '#111' })).toBe('absent');
    expect(generate(ast).code).toContain('#222'); // user div untouched
  });
});
