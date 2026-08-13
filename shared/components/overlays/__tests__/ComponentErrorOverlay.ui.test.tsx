/**
 * @file Regression tests for the three dark-mode UI bugs the CTO caught in
 *   ComponentErrorOverlay (shipped in #427 without a screenshot review):
 *     1. Inputs + inline gen/rand buttons overflowing the inner Props card.
 *     2. Input bg/border blending into the props card in dark mode.
 *     3. 'Create Empty Sample' label shown even when fields are filled.
 *
 * These are written RED-FIRST (they fail against the #427 code) and turn green
 * once the layout / token / state fixes land.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalWindow } from 'happy-dom';
import { TID } from '../../../data-testid-map';
import { ComponentErrorOverlay } from '../ComponentErrorOverlay';
import type { SimplePropInfo } from '../PropsForm';
import { inputStyle, selectStyle, formContainerStyle } from '../PropsForm/styles';

beforeEach(() => {
  const win = new GlobalWindow({ url: 'http://localhost' });
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    HTMLDivElement: win.HTMLDivElement,
    HTMLInputElement: win.HTMLInputElement,
    Element: win.Element,
    Node: win.Node,
    Text: win.Text,
    DocumentFragment: win.DocumentFragment,
    Event: win.Event,
    KeyboardEvent: win.KeyboardEvent,
    MouseEvent: win.MouseEvent,
  });
});

const typedSchemaProps = {
  componentPath: 'src/components/Tweet.tsx',
  errorSeq: 1,
  error: "Cannot read properties of undefined (reading 'author')",
  propsSchema: [
    { name: 'author', type: 'string', required: true },
    { name: 'likes', type: 'number', required: true },
    { name: 'verified', type: 'boolean', required: false },
  ] satisfies SimplePropInfo[],
  unsatisfiedProps: ['author'],
  onCreateSample: () => {},
  onConfigureAIKey: () => {},
  onClose: () => {},
};

// ---------------------------------------------------------------------------
// Bug 1 — layout: inputs must stay inside the inner Props card.
// The input + its absolutely-positioned gen/rand button live in a flex:1
// wrapper. With content-box sizing, width:100% + padding + border overflows
// the wrapper, spilling past the card's right edge. border-box is the fix.
// ---------------------------------------------------------------------------
describe('ComponentErrorOverlay — input overflow containment (bug 1)', () => {
  it('text/select input styles use border-box so width:100% includes padding+border', () => {
    expect(inputStyle.boxSizing).toBe('border-box');
    expect(selectStyle.boxSizing).toBe('border-box');
  });

  it('every rendered input/textarea/select inside the props card is width-constrained (border-box)', () => {
    const { container } = render(<ComponentErrorOverlay {...typedSchemaProps} />);
    const fields = container.querySelectorAll('input[type="text"], input[type="number"], select, textarea');
    expect(fields.length).toBeGreaterThan(0);
    for (const el of Array.from(fields)) {
      // happy-dom does not compute layout, so assert the structural constraint:
      // the field carries border-box sizing (so its 100% width is padding-aware).
      expect((el as HTMLElement).style.boxSizing).toBe('border-box');
    }
  });
});

// ---------------------------------------------------------------------------
// Bug 2 — contrast: inputs must read as inputs against the props card.
// The inner props card must NOT reuse the same token as the inputs sitting on
// it, and inputs must have a visible (own) border token + a bg token distinct
// from the card's surface token.
// ---------------------------------------------------------------------------
describe('ComponentErrorOverlay — dark-mode input contrast (bug 2)', () => {
  it('inputs carry an explicit border + bg distinct from the props-card surface', () => {
    // Input must paint a border (token wired) and a background.
    expect(inputStyle.border).toContain('--overlay-input-border');
    expect(String(inputStyle.background)).toContain('--overlay-input-bg');
    // The props card (its container) must NOT paint with the input background
    // token — otherwise inputs and card collapse to one flat block in dark mode.
    expect(String(formContainerStyle.background)).not.toContain('--overlay-input-bg');
    expect(String(formContainerStyle.background)).toContain('--overlay-surface');
  });

  it('SaaS dark palette resolves input bg distinct from the props-card surface', () => {
    const css = readFileSync(join(import.meta.dir, '..', '..', '..', '..', 'client', 'global.css'), 'utf8');
    // Both tokens must be defined.
    expect(css).toContain('--overlay-surface:');
    expect(css).toContain('--overlay-input-bg:');
    // In SaaS the input bg must map to the page background (recessed below the
    // gray surface), matching client/components/ui/input.tsx (bg-background).
    const inputBgLine = css.split('\n').find((l) => l.includes('--overlay-input-bg:'));
    const surfaceLine = css.split('\n').find((l) => l.includes('--overlay-surface:'));
    expect(inputBgLine).toBeTruthy();
    expect(surfaceLine).toBeTruthy();
    // They must not resolve to the same Tailwind token.
    expect(inputBgLine).not.toBe(surfaceLine);
    expect(inputBgLine).toContain('--background');
  });

  it('extension webview defines the new surface token too', () => {
    const css = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        '..',
        '..',
        'vscode-extension',
        'hypercanvas-preview',
        'src',
        'webview',
        'styles.css',
      ),
      'utf8',
    );
    expect(css).toContain('--overlay-surface:');
  });
});

// ---------------------------------------------------------------------------
// Bug 3 — button label must reflect actual current form values.
// ---------------------------------------------------------------------------
describe('ComponentErrorOverlay — Create Sample label reflects filled props (bug 3)', () => {
  const emptyProps = {
    componentPath: 'src/components/Spinner.tsx',
    errorSeq: 1,
    error: 'Something went wrong while rendering',
    propsSchema: [{ name: 'label', type: 'string', required: false }] satisfies SimplePropInfo[],
    onCreateSample: () => {},
    onConfigureAIKey: () => {},
    onClose: () => {},
  };

  it("shows 'Create Empty Sample' when no prop has a value", () => {
    const { getByTestId } = render(<ComponentErrorOverlay {...emptyProps} />);
    expect(getByTestId(TID.preview.componentErrorCreateSample).textContent).toBe('Create Empty Sample');
  });

  it("flips to 'Create Sample' the moment a value is typed", () => {
    const { getByTestId, container } = render(<ComponentErrorOverlay {...emptyProps} />);
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: 'Hello' } });
    expect(getByTestId(TID.preview.componentErrorCreateSample).textContent).toBe('Create Sample');
  });

  it("starts as 'Create Sample' when required props are pre-seeded with generated values", () => {
    // Required props => PropsForm auto-generates initial values on mount, so the
    // form is pre-filled and the label must already read 'Create Sample'.
    const { getByTestId } = render(<ComponentErrorOverlay {...typedSchemaProps} />);
    expect(getByTestId(TID.preview.componentErrorCreateSample).textContent).toBe('Create Sample');
  });

  it("server-renders 'Create Sample' for auto-generated required props (no cache, no effects)", () => {
    // The exact CTO state: required props auto-filled with generated values, but
    // NO cache. renderToStaticMarkup runs no effects, so the label is governed by
    // the synchronous seed. Pre-fix this rendered 'Create Empty Sample' because the
    // seed only looked at cachedValues and ignored the generated values.
    const html = renderToStaticMarkup(<ComponentErrorOverlay {...typedSchemaProps} componentPath="src/x/Fresh.tsx" />);
    expect(html).toContain('Create Sample');
    expect(html).not.toContain('Create Empty Sample');
  });

  it('seeds the label from the cached values synchronously on remount (no effect needed)', () => {
    // 1) Fill a value, which writes into the per-component propsCache.
    const optionalSchema = {
      componentPath: 'src/components/Profile.tsx',
      errorSeq: 1,
      error: 'render failed',
      propsSchema: [{ name: 'bio', type: 'string', required: false }] satisfies SimplePropInfo[],
      onCreateSample: () => {},
      onConfigureAIKey: () => {},
      onClose: () => {},
    };
    const first = render(<ComponentErrorOverlay {...optionalSchema} />);
    const input = first.container.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hello world' } });
    first.unmount();

    // 2) Server-render the same component path. renderToStaticMarkup runs NO
    //    effects, so the label is governed purely by the synchronous initial
    //    state — which must be seeded from the cached value. Pre-fix this read
    //    'Create Empty Sample' because hasAnyProps initialised to false.
    const html = renderToStaticMarkup(<ComponentErrorOverlay {...optionalSchema} />);
    expect(html).toContain('Create Sample');
    expect(html).not.toContain('Create Empty Sample');
  });
});
