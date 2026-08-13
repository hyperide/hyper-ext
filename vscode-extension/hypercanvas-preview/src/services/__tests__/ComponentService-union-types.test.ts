/**
 * @file HYP-454 — string-literal union prop types must be extracted as their
 * literal members (`'primary' | 'ghost'`), NOT collapsed to `unknown | unknown`.
 *
 * Exercises ComponentService._getTypeString via the full _parseComponent path so
 * the union members survive into PropInfo.type, where the sample-value generator
 * (lib/preview-generator/sample-values.ts) can resolve them to a real enum value.
 */

import * as fs from 'node:fs';
import { describe, expect, it } from 'bun:test';
import { generateSamplePropValues } from '@lib/preview-generator/sample-values';
import type { ComponentInfo } from '@lib/types';
import { ComponentService } from '../ComponentService';

// The real LocalButton fixture lives in the sibling ext-test-projects checkout, which is
// NOT present in a clean clone of this repo. Run the real-file regression only when it
// exists; the inline fixtures above cover the logic in every environment.
const LOCAL_BUTTON_PATH =
  '/Users/ultra/work/ext-test-projects/conloca-mini-monorepo/targets/web/src/app/ui/LocalButton.tsx';
const hasLocalButton = (() => {
  try {
    return fs.existsSync(LOCAL_BUTTON_PATH);
  } catch {
    return false;
  }
})();

// Access the private _parseComponent for a vscode-free unit test (source passed inline).
function parse(source: string, p = 'src/ui/LocalButton.tsx'): Promise<ComponentInfo | null> {
  const svc = new ComponentService('/tmp/ws', async () => undefined);
  return (
    svc as unknown as { _parseComponent(path: string, src: string): Promise<ComponentInfo | null> }
  )._parseComponent(p, source);
}

describe('ComponentService string-literal union extraction (HYP-454)', () => {
  it('extracts a string-literal union as its quoted members, not `unknown | unknown`', async () => {
    const source = `
      import type { ReactNode } from 'react';
      export interface LocalButtonProps {
        variant?: 'primary' | 'ghost';
        children: ReactNode;
      }
      export function LocalButton({ variant = 'primary', children }: LocalButtonProps) {
        return <button>{children}</button>;
      }
    `;
    const info = await parse(source);
    const variant = info?.props.find((pr) => pr.name === 'variant');
    expect(variant?.type).not.toContain('unknown');
    expect(variant?.type).toBe("'primary' | 'ghost'");
  });

  it('end-to-end: union type + destructuring default → sampler honors the default (HYP-454)', async () => {
    // The full LocalButton shape. The interface entry carries the union type, the
    // destructuring entry carries the default ('ghost' ≠ first member 'primary'). The
    // sampler's dedupe-merge must combine them and emit the declared default.
    const source = `
      import type { ReactNode } from 'react';
      export interface LocalButtonProps {
        variant?: 'primary' | 'ghost';
        children: ReactNode;
      }
      export function LocalButton({ variant = 'ghost', children }: LocalButtonProps) {
        return <button>{children}</button>;
      }
    `;
    const info = await parse(source);
    // The typed entry exposes the real union, never `unknown | unknown`.
    const typedVariant = info?.props.find((pr) => pr.name === 'variant' && pr.type !== 'unknown');
    expect(typedVariant?.type).toBe("'primary' | 'ghost'");

    const sample = generateSamplePropValues(info?.props ?? []);
    expect(sample.values.variant).toBe('ghost');
    expect(sample.unsatisfied).not.toContain('variant');
  });

  it('does NOT serialize a numeric literal union as a string enum (codex P2)', async () => {
    // `1 | 2` must not become `'1' | '2'` — the sampler would pass the string '1' and
    // break `size === 1`. Numeric literal unions keep the pre-fix `unknown` behavior.
    const source = `
      export function Box({ size }: { size?: 1 | 2 }) {
        return <div>{size}</div>;
      }
    `;
    const info = await parse(source, 'src/ui/Box.tsx');
    const typed = info?.props.find((pr) => pr.name === 'size' && pr.type !== 'unknown');
    // No quoted string members were produced for the numeric union.
    expect(typed?.type ?? 'unknown').not.toContain("'1'");
    const sample = generateSamplePropValues(info?.props ?? []);
    // Whatever we sample, it must never be the string '1'.
    expect(sample.values.size).not.toBe('1');
  });

  // Regression against the ACTUAL fixture the CTO opens (variant?: 'primary' | 'ghost',
  // default = 'primary', extends ButtonHTMLAttributes). default == first member here, so
  // this guards the production parse+sample path the screenshot exercises.
  it.skipIf(!hasLocalButton)('real LocalButton.tsx → samples its declared default "primary"', async () => {
    const src = fs.readFileSync(LOCAL_BUTTON_PATH, 'utf8');
    const info = await parse(src, 'ui/LocalButton.tsx');
    const typedVariant = info?.props.find((pr) => pr.name === 'variant' && pr.type !== 'unknown');
    expect(typedVariant?.type).toBe("'primary' | 'ghost'");

    const sample = generateSamplePropValues(info?.props ?? []);
    expect(sample.values.variant).toBe('primary');
    expect(sample.unsatisfied).not.toContain('variant');
  });

  // -----------------------------------------------------------------------
  // Inline-destructuring union (HYP-454 gap):
  // `export function Button({ variant }: { variant: 'primary' | 'ghost' }) {}`
  // Previously extractPropsFromDestructuring emitted type:'unknown' for all
  // destructured props, even when an inline object type annotation was present.
  // -----------------------------------------------------------------------

  it('inline destructured union → type extracted, not unknown (HYP-454 inline)', async () => {
    const source = `
      export function Button({ variant }: { variant: 'primary' | 'ghost' }) {
        return <button className={variant} />;
      }
    `;
    const info = await parse(source, 'src/ui/Button.tsx');
    const variant = info?.props.find((pr) => pr.name === 'variant');
    expect(variant?.type).not.toBe('unknown');
    expect(variant?.type).toBe("'primary' | 'ghost'");
  });

  it('inline destructured union, required, no default → sampled as first member, not unsatisfied (HYP-454 inline)', async () => {
    const source = `
      export function Button({ variant }: { variant: 'primary' | 'ghost' }) {
        return <button className={variant} />;
      }
    `;
    const info = await parse(source, 'src/ui/Button.tsx');
    const sample = generateSamplePropValues(info?.props ?? []);
    expect(sample.values.variant).toBe('primary');
    expect(sample.unsatisfied).not.toContain('variant');
  });

  // HYP-454 gap: optional marker on TSPropertySignature (`?:`) was ignored, causing
  // optional inline union props to be marked required:true and land in unsatisfied.
  it('inline destructured optional union → required:false, NOT in unsatisfied (HYP-454 optional)', async () => {
    const source = `
      export function Button({ variant }: { variant?: 'primary' | 'ghost' }) {
        return <button className={variant} />;
      }
    `;
    const info = await parse(source, 'src/ui/Button.tsx');
    const variant = info?.props.find((pr) => pr.name === 'variant');
    expect(variant?.required).toBe(false);
    const sample = generateSamplePropValues(info?.props ?? []);
    expect(sample.unsatisfied).not.toContain('variant');
  });

  // -----------------------------------------------------------------------
  // HYP-486: when one file exports MULTIPLE components, the prop schema for the
  // SELECTED component must not leak a sibling component's destructuring default.
  // Here `Button` has no default (sampler should fall back to the first union
  // member 'primary'), while the sibling `Badge` carries `variant = 'ghost'`.
  // A flat prop collection merged Badge's default onto Button's variant, making
  // the sampler emit 'ghost' for Button. Props must be scoped per component name.
  // -----------------------------------------------------------------------
  it('multi-component file → selected component does NOT inherit a sibling default (HYP-486)', async () => {
    const source = `
      export function Button({ variant }: { variant?: 'primary' | 'ghost' }) {
        return <button className={variant} />;
      }
      export function Badge({ variant = 'ghost' }: { variant?: 'primary' | 'ghost' }) {
        return <span className={variant} />;
      }
    `;
    const info = await parse(source, 'src/ui/Button.tsx');
    expect(info?.name).toBe('Button');

    const variant = info?.props.find((pr) => pr.name === 'variant');
    // Button declares no default — Badge's 'ghost' must not leak in.
    expect(variant?.defaultValue).toBeUndefined();

    const sample = generateSamplePropValues(info?.props ?? [], { componentName: 'Button' });
    expect(sample.values.variant).toBe('primary');
  });

  // -----------------------------------------------------------------------
  // HYP-486 (review follow-up): the *type-member* merge was still unscoped.
  // `deferredTypeMembers` merged EVERY `*Props` interface/type in the file into
  // the selected component. In a file with `ButtonProps` and `BadgeProps`,
  // selecting `Button` pulled in Badge-only fields (`tone`) and, worse, let
  // `BadgeProps`'s same-name field overwrite Button's type based on traversal
  // order. Type members must be scoped to the selected component's props-param
  // type (`ButtonProps`), not all `*Props` in the file.
  // -----------------------------------------------------------------------
  it('multi-component file → selected component does NOT inherit a sibling Props interface (HYP-486)', async () => {
    const source = `
      export interface ButtonProps {
        variant?: 'primary' | 'ghost';
      }
      export interface BadgeProps {
        // conflicting same-name field with a DIFFERENT type
        variant?: 'solid' | 'outline';
        // Badge-only field that must NOT leak onto Button
        tone?: 'info' | 'warn';
      }
      export function Button({ variant }: ButtonProps) {
        return <button className={variant} />;
      }
      export function Badge({ variant, tone }: BadgeProps) {
        return <span className={variant} data-tone={tone} />;
      }
    `;
    const info = await parse(source, 'src/ui/Button.tsx');
    expect(info?.name).toBe('Button');

    // Badge-only field must not appear on Button's prop schema.
    const tone = info?.props.find((pr) => pr.name === 'tone');
    expect(tone).toBeUndefined();

    // The conflicting `variant` field must keep ButtonProps' type, not Badge's.
    const variant = info?.props.find((pr) => pr.name === 'variant');
    expect(variant?.type).toBe("'primary' | 'ghost'");
    expect(variant?.type).not.toContain('solid');
    expect(variant?.type).not.toContain('outline');
  });

  // -----------------------------------------------------------------------
  // HYP-486 (codex review follow-up): the previewed component is exported via an
  // export LIST (`export { Button }`) AFTER another PascalCase local helper. The
  // ExportNamedDeclaration handler only recorded inline-declaration exports, so the
  // export-list specifier never reached `exportedVarNames`. componentName therefore
  // stayed on the FIRST PascalCase local ('Helper'), and the scoped lookup built
  // props from Helper — DROPPING Button's destructured `variant`. componentName must
  // resolve to the actually-exported component (mirror the preview generator).
  // -----------------------------------------------------------------------
  it('export-list specifier after a helper → componentName resolves to the exported component, props kept (HYP-486)', async () => {
    const source = `
      const Helper = (x) => x;
      const Button = ({ variant }: { variant?: 'a' | 'b' }) => null;
      export { Button };
    `;
    const info = await parse(source, 'src/ui/Button.tsx');
    // The exported component, not the first local helper.
    expect(info?.name).toBe('Button');

    // Button's destructured prop must survive (not dropped, not Helper's).
    const variant = info?.props.find((pr) => pr.name === 'variant');
    expect(variant).toBeDefined();
    expect(variant?.type).toBe("'a' | 'b'");
  });
});
