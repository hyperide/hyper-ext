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
});
