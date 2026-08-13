/**
 * @file Regression tests for in-memory generated-prop injection gating (#210).
 */

import { describe, expect, it } from 'bun:test';
import {
  getPrimitiveRenderableSampleInfo,
  shouldInjectGeneratedProps,
  shouldInjectGeneratedPropsForSelection,
} from '../no-props-sample';

describe('shouldInjectGeneratedProps', () => {
  it('returns true when no sample exists and component has no props', () => {
    expect(shouldInjectGeneratedProps({ generated: false, exists: false }, [])).toBe(true);
  });

  it('returns true when no sample exists and component has required props (try-first approach)', () => {
    // Must attempt render with generated props even for components that declare props.
    // If the render fails, ComponentErrorOverlay shows — but we try first.
    expect(shouldInjectGeneratedProps({ generated: false, exists: false }, [{ name: 'title' }])).toBe(true);
  });

  it('returns false when a sample already exists', () => {
    // Authored SampleDefault wins in the generator — no point computing/posting props.
    expect(shouldInjectGeneratedProps({ generated: false, exists: true }, [])).toBe(false);
  });

  it('returns false when a sample already exists even with props', () => {
    expect(shouldInjectGeneratedProps({ generated: false, exists: true }, [{ name: 'title' }])).toBe(false);
  });

  it('returns false when component definitions are unavailable (parse failure)', () => {
    expect(shouldInjectGeneratedProps({ generated: false, exists: false }, null)).toBe(false);
  });

  it('returns false when component definitions are undefined (not yet fetched)', () => {
    expect(shouldInjectGeneratedProps({ generated: false, exists: false }, undefined)).toBe(false);
  });

  it('is independent of the autoSampleGeneration setting (in-memory never writes source)', () => {
    // The old source-mutation gate read hypercanvas.preview.autoSampleGeneration.
    // In-memory injection must work regardless — assert no vscode dependency by
    // exercising the function with no vscode mock present.
    expect(shouldInjectGeneratedProps({ generated: false, exists: false }, [{ name: 'tweet' }])).toBe(true);
  });

  it('allows in-memory prop injection for plain UI primitives without authored or synthetic samples', () => {
    const sourceCode = `
      export interface BadgeProps { label: string }
      export function Badge({ label }: BadgeProps) { return <span>{label}</span>; }
    `;
    const primitiveSample = getPrimitiveRenderableSampleInfo(sourceCode, 'Badge');

    expect(primitiveSample).toEqual({ hasAuthoredSampleDefault: false, hasSyntheticSampleDefault: false });
    expect(
      shouldInjectGeneratedPropsForSelection(
        { generated: false, exists: false },
        [{ name: 'label', type: 'string', required: true }],
        primitiveSample,
      ),
    ).toBe(true);
  });

  it('skips in-memory prop injection when a UI primitive already has an authored SampleDefault', () => {
    const sourceCode = `
      export function Badge() { return <span />; }
      export const SampleDefault = () => <Badge />;
    `;
    const primitiveSample = getPrimitiveRenderableSampleInfo(sourceCode, 'Badge');

    expect(primitiveSample.hasAuthoredSampleDefault).toBe(true);
    expect(shouldInjectGeneratedPropsForSelection({ generated: false, exists: false }, [], primitiveSample)).toBe(
      false,
    );
  });

  it('skips in-memory prop injection when compound synthesis can render the UI primitive', () => {
    const sourceCode = `
      export function Card({ children }: { children?: React.ReactNode }) { return <div>{children}</div>; }
      export function CardHeader({ children }: { children?: React.ReactNode }) { return <header>{children}</header>; }
      export function CardContent({ children }: { children?: React.ReactNode }) { return <main>{children}</main>; }
    `;
    const primitiveSample = getPrimitiveRenderableSampleInfo(sourceCode, 'Card');

    expect(primitiveSample.hasSyntheticSampleDefault).toBe(true);
    expect(
      shouldInjectGeneratedPropsForSelection(
        { generated: false, exists: false },
        [{ name: 'children', type: 'React.ReactNode', required: false }],
        primitiveSample,
      ),
    ).toBe(false);
  });
});
