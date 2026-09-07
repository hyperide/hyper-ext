/**
 * @file A UI primitive whose Props interface EXTENDS a native HTML
 * attributes type (`ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>`)
 * inherits `children` without ever naming it in its own source: no destructured
 * `children` param (absorbed into `...rest`), no `children` member in the Props
 * interface body. ComponentService._parseComponent is a Babel AST walk, not a TS
 * type-checker — it never resolves the `extends` heritage clause, so `children` was
 * missing from `component.props` entirely. `generateSamplePropValues`
 * (lib/preview-generator/sample-values.ts) only fabricates placeholder text for a
 * `children` PROP IT KNOWS ABOUT, so a component in this shape rendered as a real,
 * visible-but-textless `<Button />` in the HyperIDE preview panel — reported by Alex
 * against conloca-private's `packages/cms-spa/src/components/ui/Button.tsx`.
 *
 * Mirrors the fixture shape and end-to-end test style of
 * ComponentService-union-types.test.ts (HYP-454), the sibling fix in the same
 * generateSamplePropValues lineage (HYP-453 → HYP-915 → this). Same "prop-requiring atom
 * in conloca-private/packages/cms-spa stays uninspectable" theme HYP-922 filed against
 * Card.tsx — that ticket's literal symptom (the "No sample for this component"
 * placeholder) was superseded by HYP-915's registry-inclusion fix; this is the
 * next-layer gap HYP-915's fix exposed, not the same bug restated.
 */

import { describe, expect, it } from 'bun:test';
import { generateSamplePropValues } from '@lib/preview-generator/sample-values';
import type { ComponentInfo } from '@lib/types';
import { ComponentService } from '../ComponentService';

// Access the private _parseComponent for a vscode-free unit test (source passed inline).
function parse(source: string, p = 'src/components/ui/Button.tsx'): Promise<ComponentInfo | null> {
  const svc = new ComponentService('/tmp/ws', async () => undefined);
  return (
    svc as unknown as { _parseComponent(path: string, src: string): Promise<ComponentInfo | null> }
  )._parseComponent(p, source);
}

// Trimmed down to the shape that matters: `ButtonProps` extends React's own
// `ButtonHTMLAttributes` (the source of the inherited `children?: ReactNode`), the
// component destructures only its OWN props plus a `...props` rest, and never names
// `children` anywhere.
const conlocaButtonSource = `
  import type { ButtonHTMLAttributes, Ref } from 'react';

  interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'outline' | 'ghost' | 'destructive' | 'tonal';
    size?: 'default' | 'sm';
    ref?: Ref<HTMLButtonElement>;
  }

  export function Button({
    variant = 'primary',
    size = 'default',
    type = 'button',
    className,
    ref,
    ...props
  }: ButtonProps) {
    return <button ref={ref} type={type} className={className} {...props} />;
  }
`;

describe('ComponentService implicit children from *HTMLAttributes extends', () => {
  it('synthesizes a children PropInfo even though the component never names it', async () => {
    const info = await parse(conlocaButtonSource);
    const children = info?.props.find((p) => p.name === 'children');
    expect(children).toBeDefined();
    expect(children?.type).toBe('ReactNode');
    // Pins the `synthesized: true` marker itself — dropping it from
    // synthesizeChildrenProp's return would otherwise pass this whole suite silently,
    // since nothing else asserts on it directly (review finding GLM F1, HYP-1367).
    expect(children?.synthesized).toBe(true);
  });

  it('does not duplicate children when the component already destructures it', async () => {
    const source = `
      import type { ButtonHTMLAttributes } from 'react';
      interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {}
      export function Button({ children, ...props }: ButtonProps) {
        return <button {...props}>{children}</button>;
      }
    `;
    const info = await parse(source);
    const childrenEntries = info?.props.filter((p) => p.name === 'children') ?? [];
    expect(childrenEntries).toHaveLength(1);
    // The REAL destructured children, not a fabricated one — must not carry the marker.
    expect(childrenEntries[0]?.synthesized).toBeUndefined();
  });

  it('does not synthesize children for a component with no *HTMLAttributes signal', async () => {
    const source = `
      export function Tag({ label }: { label: string }) {
        return <span>{label}</span>;
      }
    `;
    const info = await parse(source);
    const children = info?.props.find((p) => p.name === 'children');
    expect(children).toBeUndefined();
  });

  it('end-to-end: generateSamplePropValues fabricates a humanized label for the synthesized children (HYP-453 branch)', async () => {
    const info = await parse(conlocaButtonSource);
    expect(info?.props).toBeDefined();
    const { values } = generateSamplePropValues(info!.props, { componentName: info!.name });
    // The exact reported symptom: without this fix `values.children` is absent and the
    // preview renders `<Button variant="primary" size="default" ... />` with no visible
    // label at all.
    expect(values.children).toBe('Button');
  });

  it('the synthesized required children prop never forces the "needs AI key" gate (regression guard for preview-panel-error-handler.ts)', async () => {
    // preview-panel-error-handler.ts's no-AI-key "Create Sample" gate reads
    // `propDefs?.some((p) => p.required && !p.synthesized)` — NOT raw `p.required` alone —
    // precisely so a synthesized `children: ReactNode` (required: true by design, see
    // synthesizeChildrenProp's doc comment) never blocks the deterministic scaffold and
    // forces an AI key requirement for a value the sampler can already fabricate on its
    // own. This asserts the gate's actual predicate directly (not `unsatisfied`, which is
    // a different, unrelated signal from generateSamplePropValues) — a regression here
    // (e.g. reverting the gate back to plain `p.required`, or dropping `synthesized` from
    // synthesizeChildrenProp's output) would silently break "Create Sample" for every
    // conloca-Button-shaped component again.
    const info = await parse(conlocaButtonSource);
    expect(info?.props).toBeDefined();
    const hasRequiredProps = info!.props.some((p) => p.required && !p.synthesized);
    expect(hasRequiredProps).toBe(false);
    // generateSamplePropValues still fabricates a real value for it regardless of the gate.
    const { values, unsatisfied } = generateSamplePropValues(info!.props, { componentName: info!.name });
    expect(values.children).toBe('Button');
    expect(unsatisfied).not.toContain('children');
  });

  it('does not synthesize children for a sibling component in the same file whose OWN Props never extends *HTMLAttributes (scoping regression guard)', async () => {
    // A file-global "does this source mention *HTMLAttributes anywhere" check previously
    // made an unrelated selected component in the same file inherit a bogus synthesized
    // `children` prop just because a SIBLING component's Props (or even a stray import)
    // mentioned e.g. ButtonHTMLAttributes elsewhere in the file. The heuristic must be
    // scoped to the SELECTED component's own `${componentName}Props` declaration.
    const source = `
      import type { ButtonHTMLAttributes } from 'react';

      interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {}
      export function Button({ ...props }: ButtonProps) {
        return <button {...props} />;
      }

      interface IconProps {
        label: string;
      }
      export function Icon({ label }: IconProps) {
        return <span aria-label={label} />;
      }
    `;
    const iconInfo = await parse(source, 'src/components/ui/Icon.tsx');
    const children = iconInfo?.props.find((p) => p.name === 'children');
    expect(children).toBeUndefined();
  });

  it('does not synthesize children for a sibling declared BEFORE the *HTMLAttributes one (declaration-order regression guard)', async () => {
    // The scoping fix must not depend on which declaration comes first in the file — a
    // fixed character-window scope (an earlier revision of this fix used one) still
    // bleeds from a SHORT preceding declaration into the next one. Swap the declaration
    // order from the test above: Icon's Props now comes FIRST, right before Button's
    // ButtonHTMLAttributes-extending Props.
    const source = `
      interface IconProps {
        label: string;
      }
      export function Icon({ label }: IconProps) {
        return <span aria-label={label} />;
      }

      import type { ButtonHTMLAttributes } from 'react';

      interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {}
      export function Button({ ...props }: ButtonProps) {
        return <button {...props} />;
      }
    `;
    const iconInfo = await parse(source, 'src/components/ui/Icon.tsx');
    const children = iconInfo?.props.find((p) => p.name === 'children');
    expect(children).toBeUndefined();
  });

  it('synthesizes children when the Props type is not named `${componentName}Props` (real annotation, not the naming convention)', async () => {
    // ComponentService reads the REAL type annotation off the destructured param
    // (`paramPropsTypeName`) rather than assuming every component follows the
    // `${componentName}Props` naming convention. A bare `interface Props` — a common
    // pattern for a component that's the sole export of its file — must still work.
    const source = `
      import type { ButtonHTMLAttributes, Ref } from 'react';

      interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
        variant?: 'primary' | 'outline';
        ref?: Ref<HTMLButtonElement>;
      }

      export function Button({ variant = 'primary', ref, ...props }: Props) {
        return <button ref={ref} {...props} />;
      }
    `;
    const info = await parse(source);
    const children = info?.props.find((p) => p.name === 'children');
    expect(children).toBeDefined();
    expect(children?.type).toBe('ReactNode');
    expect(children?.synthesized).toBe(true);
  });

  it('synthesizes children for the forwardRef<Element, *HTMLAttributes<...>> spelling (no named Props declaration at all)', async () => {
    // shadcn/ui's other very common spelling — the HTML-attributes type is an inline
    // generic argument to forwardRef itself, not a named `interface FooProps`.
    const source = `
      import * as React from 'react';
      export const Alert = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
        ({ className, ...props }, ref) => <div ref={ref} className={className} {...props} />,
      );
    `;
    const info = await parse(source, 'src/components/ui/Alert.tsx');
    const children = info?.props.find((p) => p.name === 'children');
    expect(children).toBeDefined();
    expect(children?.type).toBe('ReactNode');
    expect(children?.synthesized).toBe(true);
  });

  it('synthesizes children for a forwardRef second generic argument that is an INTERSECTION type (real shadcn card.tsx shape)', async () => {
    // Matches this repo's own client/components/ui/card.tsx:
    // `React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { testId?: string }>`.
    // An earlier revision only recognized a direct TSTypeReference second argument and
    // missed this intersection shape entirely (review finding on HYP-1367).
    const source = `
      import * as React from 'react';
      export const Card = React.forwardRef<
        HTMLDivElement,
        React.HTMLAttributes<HTMLDivElement> & { testId?: string }
      >(({ className, testId, ...props }, ref) => <div ref={ref} data-testid={testId} className={className} {...props} />);
    `;
    const info = await parse(source, 'src/components/ui/Card.tsx');
    const children = info?.props.find((p) => p.name === 'children');
    expect(children).toBeDefined();
    expect(children?.type).toBe('ReactNode');
    expect(children?.synthesized).toBe(true);
  });

  it('synthesizes children for a bare `type XProps = *HTMLAttributes<...>` type alias (direct reference, no intersection)', async () => {
    const source = `
      import type { ButtonHTMLAttributes } from 'react';
      type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;
      export function Button(props: ButtonProps) {
        return <button {...props} />;
      }
    `;
    const info = await parse(source);
    const children = info?.props.find((p) => p.name === 'children');
    expect(children).toBeDefined();
    expect(children?.type).toBe('ReactNode');
    expect(children?.synthesized).toBe(true);
  });

  it('synthesizes children for a `type XProps = *HTMLAttributes<...> & { ... }` intersection type alias', async () => {
    const source = `
      import type { HTMLAttributes } from 'react';
      type CardProps = HTMLAttributes<HTMLDivElement> & { variant?: 'a' | 'b' };
      export function Card({ variant, ...props }: CardProps) {
        return <div {...props} />;
      }
    `;
    const info = await parse(source);
    const children = info?.props.find((p) => p.name === 'children');
    expect(children).toBeDefined();
    expect(children?.type).toBe('ReactNode');
    expect(children?.synthesized).toBe(true);
  });

  it('recognizes `extends React.HTMLAttributes<...>` (qualified name heritage, not just the bare identifier form)', async () => {
    const source = `
      import * as React from 'react';
      interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}
      export function Button(props: ButtonProps) {
        return <button {...props} />;
      }
    `;
    const info = await parse(source);
    const children = info?.props.find((p) => p.name === 'children');
    expect(children).toBeDefined();
    expect(children?.synthesized).toBe(true);
  });

  it('does NOT synthesize children for a component whose Props extends a VOID-ELEMENT HTML-attributes type (would crash React)', async () => {
    // <input> is a void element — React throws at runtime if it receives children. A
    // component wrapping one must never get a synthesized `children` prop even though
    // its Props extends *HTMLAttributes (review finding on HYP-1367: verified an earlier
    // revision produced `<Input>Sample content</Input>` around an `<input>`).
    const source = `
      import type { InputHTMLAttributes } from 'react';
      interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}
      export function Input(props: InputProps) {
        return <input {...props} />;
      }
    `;
    const info = await parse(source, 'src/components/ui/Input.tsx');
    const children = info?.props.find((p) => p.name === 'children');
    expect(children).toBeUndefined();
  });

  it('does NOT synthesize children when a void element uses the GENERIC `HTMLAttributes<VoidElement>` spelling, not the specialized name', async () => {
    // Matching only the specialized attributes-type NAME (InputHTMLAttributes,
    // ImgHTMLAttributes, ...) misses the equally common generic spelling
    // `React.HTMLAttributes<HTMLImageElement>` — verified this exact shape crashes React
    // at runtime (`renderToString` throws "img is a self-closing tag and must neither
    // have children...") when children get synthesized for it (review finding on
    // HYP-1367).
    const source = `
      import * as React from 'react';
      interface ImageProps extends React.HTMLAttributes<HTMLImageElement> {}
      export function Image(props: ImageProps) {
        return <img {...props} />;
      }
    `;
    const info = await parse(source, 'src/components/ui/Image.tsx');
    const children = info?.props.find((p) => p.name === 'children');
    expect(children).toBeUndefined();
  });

  it('does NOT synthesize children for a forwardRef void element using the generic HTMLAttributes<VoidElement> spelling', async () => {
    const source = `
      import * as React from 'react';
      export const Input = React.forwardRef<HTMLInputElement, React.HTMLAttributes<HTMLInputElement>>(
        ({ className, ...props }, ref) => <input ref={ref} className={className} {...props} />,
      );
    `;
    const info = await parse(source, 'src/components/ui/Input.tsx');
    const children = info?.props.find((p) => p.name === 'children');
    expect(children).toBeUndefined();
  });

  it('does NOT synthesize children for a component wrapping <textarea> (real client/components/ui/textarea.tsx shape)', async () => {
    // React warns "Use the `defaultValue` or `value` props instead of setting children on
    // <textarea>" and throws when BOTH children and value/defaultValue are supplied — the
    // common case for a wrapper forwarding `value` through `...props`. TextareaHTMLAttributes
    // is not a void element, so the void-element guard alone missed this (review finding
    // codex P1, HYP-1367). Mirrors this repo's own client/components/ui/textarea.tsx exactly:
    // `TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement>`, no explicit
    // children, `...props` spread onto `<textarea>`.
    const source = `
      import * as React from 'react';
      export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
        autoResize?: boolean;
      }
      const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
        ({ className, autoResize, ...props }, ref) => <textarea ref={ref} className={className} {...props} />,
      );
    `;
    const info = await parse(source, 'src/components/ui/Textarea.tsx');
    const children = info?.props.find((p) => p.name === 'children');
    expect(children).toBeUndefined();
  });

  it('does NOT synthesize children when a textarea uses the GENERIC HTMLAttributes<HTMLTextAreaElement> spelling', async () => {
    const source = `
      import * as React from 'react';
      interface TextareaProps extends React.HTMLAttributes<HTMLTextAreaElement> {}
      export function Textarea(props: TextareaProps) {
        return <textarea {...props} />;
      }
    `;
    const info = await parse(source, 'src/components/ui/Textarea.tsx');
    const children = info?.props.find((p) => p.name === 'children');
    expect(children).toBeUndefined();
  });

  it('does NOT synthesize children for a component wrapping <select> (SelectHTMLAttributes)', async () => {
    // <select> only accepts <option>/<optgroup> as meaningful children -- a synthesized
    // plain-string child would render as an inert, invisible text node.
    const source = `
      import type { SelectHTMLAttributes } from 'react';
      interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}
      export function Select(props: SelectProps) {
        return <select {...props} />;
      }
    `;
    const info = await parse(source, 'src/components/ui/Select.tsx');
    const children = info?.props.find((p) => p.name === 'children');
    expect(children).toBeUndefined();
  });

  it('does NOT synthesize children for a forwardRef textarea using the second-generic-argument spelling directly (no named Props interface)', async () => {
    // Distinct code path from the named-Props-interface textarea test above: this goes
    // through the forwardRef second-generic-argument branch (typeNodeExtendsHtmlAttributes),
    // not htmlAttrsPropsDecls keyed by a Props declaration name (review finding GLM round 7:
    // the two paths are separate and each needs its own pin).
    const source = `
      import * as React from 'react';
      export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
        ({ className, ...props }, ref) => <textarea ref={ref} className={className} {...props} />,
      );
    `;
    const info = await parse(source, 'src/components/ui/Textarea.tsx');
    const children = info?.props.find((p) => p.name === 'children');
    expect(children).toBeUndefined();
  });

  it('does NOT synthesize children when a select uses the GENERIC HTMLAttributes<HTMLSelectElement> spelling', async () => {
    // Mirrors the textarea generic-spelling test -- select had no equivalent, and the
    // paired-set design (attrs-name set + DOM-name set) means either half can drift
    // independently (review finding GLM round 7).
    const source = `
      import * as React from 'react';
      interface SelectProps extends React.HTMLAttributes<HTMLSelectElement> {}
      export function Select(props: SelectProps) {
        return <select {...props} />;
      }
    `;
    const info = await parse(source, 'src/components/ui/Select.tsx');
    const children = info?.props.find((p) => p.name === 'children');
    expect(children).toBeUndefined();
  });

  it('DOES synthesize children when SelectHTMLAttributes is parameterized with an unrelated, non-select element (type-valid mismatch, review finding codex P2)', async () => {
    // `SelectHTMLAttributes<HTMLButtonElement>` on a component that renders a <button> is
    // real, type-valid TypeScript (contrived, but compiles) -- that component DOES render a
    // text child, so excluding it purely by the attrs-NAME `SelectHTMLAttributes` would
    // wrongly kill its generated label. The exclusion must only fire when the generic
    // argument is absent or matches the expected element (HTMLSelectElement).
    const source = `
      import * as React from 'react';
      interface ToggleProps extends React.SelectHTMLAttributes<HTMLButtonElement> {}
      export function Toggle(props: ToggleProps) {
        return <button {...props} />;
      }
    `;
    const info = await parse(source, 'src/components/ui/Toggle.tsx');
    const children = info?.props.find((p) => p.name === 'children');
    expect(children).toBeDefined();
    expect(children?.synthesized).toBe(true);
  });

  it('preserves an explicit `children` declared alongside an intersected *HTMLAttributes type (does not overwrite its real type with ReactNode)', async () => {
    // `type ButtonProps = React.ButtonHTMLAttributes<...> & { children: React.ReactElement }`
    // explicitly declares children with a NARROWER type than the synthesized default. The
    // explicit declaration must win — an earlier revision only extracted intersection
    // members when the WHOLE alias was a bare TSTypeLiteral, missing this shape entirely
    // and silently overwriting the real `children: ReactElement` with a synthesized
    // `children: ReactNode` (review finding on HYP-1367).
    const source = `
      import * as React from 'react';
      type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactElement };
      export function Button({ children, ...props }: ButtonProps) {
        return <button {...props}>{children}</button>;
      }
    `;
    const info = await parse(source);
    const childrenEntries = info?.props.filter((p) => p.name === 'children') ?? [];
    expect(childrenEntries).toHaveLength(1);
    expect(childrenEntries[0]?.type).toBe('React.ReactElement');
    // The REAL explicit declaration won, not a fabricated fallback — must not carry the marker.
    expect(childrenEntries[0]?.synthesized).toBeUndefined();
  });
});
