import { describe, expect, it } from 'bun:test';
import { parse } from '@babel/parser';
import {
  buildContainerSampleJsxBody,
  buildDeterministicContainerSampleScaffold,
  buildSampleScaffold,
  normalizeSampleComponentName,
} from '../sample-scaffold';

const ALERT_SOURCE = `
import * as React from "react";

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} role="alert" className={className} {...props} />
));

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => <h5 ref={ref} className={className} {...props} />);

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => <div ref={ref} className={className} {...props} />);

export { Alert, AlertTitle, AlertDescription };
`;

describe('buildSampleScaffold', () => {
  it('adds visible compound children for optional-prop container components', () => {
    const scaffold = buildSampleScaffold({
      sourceCode: ALERT_SOURCE,
      componentName: 'Alert',
      exportName: 'SampleDefault',
      propEntries: [],
    });

    expect(scaffold).toContain('<Alert>');
    expect(scaffold).toContain('<AlertTitle>Preview title</AlertTitle>');
    expect(scaffold).toContain(
      '<AlertDescription>This sample shows the component with visible content.</AlertDescription>',
    );
    expect(scaffold).toContain('</Alert>');
    expect(scaffold).not.toContain('TODO');
  });

  it('keeps explicit prop values when the user filled the overlay form', () => {
    const scaffold = buildSampleScaffold({
      sourceCode: ALERT_SOURCE,
      componentName: 'Alert',
      exportName: 'SampleDefault',
      propEntries: [['variant', 'destructive']],
    });

    expect(scaffold).toContain('<Alert');
    expect(scaffold).toContain('variant={"destructive"}');
    expect(scaffold).toContain('/>');
  });

  it('emits parseable JSX for explicit prop samples', () => {
    const scaffold = buildSampleScaffold({
      sourceCode: ALERT_SOURCE,
      componentName: 'Alert',
      exportName: 'SampleDefault',
      propEntries: [['variant', 'destructive']],
    });

    expect(scaffold).toContain('variant={"destructive"}');
    expect(scaffold).toContain('/>');
    expect(() => parse(scaffold, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
  });

  it('serializes nested object prop values as parseable JSX (feature #210 auto-sample)', () => {
    const scaffold = buildSampleScaffold({
      sourceCode: ALERT_SOURCE,
      componentName: 'Tweet',
      exportName: 'SampleDefault',
      propEntries: [['tweet', { likes: 1, user: { name: 'Sample name', verified: false } }]],
    });

    expect(scaffold).toContain('tweet={');
    expect(scaffold).toContain('"likes":1');
    expect(scaffold).toContain('"name":"Sample name"');
    expect(() => parse(scaffold, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
  });

  it('serializes function prop values as a real arrow function, not a string', () => {
    const scaffold = buildSampleScaffold({
      sourceCode: ALERT_SOURCE,
      componentName: 'Button',
      exportName: 'SampleDefault',
      propEntries: [['onClick', () => undefined]],
    });

    // Must be an executable expression, not "() => undefined" as a string literal.
    expect(scaffold).toContain('onClick={() => {}}');
    expect(scaffold).not.toContain('"() =>');
    expect(() => parse(scaffold, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
  });

  it('preserves nested function fields inside object prop values', () => {
    const scaffold = buildSampleScaffold({
      sourceCode: ALERT_SOURCE,
      componentName: 'Toolbar',
      exportName: 'SampleDefault',
      propEntries: [['actions', { onSave: () => undefined, label: 'Save' }]],
    });

    // The nested function must survive as an executable arrow, not be dropped by JSON.stringify.
    expect(scaffold).toContain('"onSave":() => {}');
    expect(scaffold).toContain('"label":"Save"');
    expect(scaffold).not.toContain('actions={{}}');
    expect(() => parse(scaffold, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
  });

  it('uses object spread for prop names that cannot be JSX attributes', () => {
    const scaffold = buildSampleScaffold({
      sourceCode: ALERT_SOURCE,
      componentName: 'Alert',
      exportName: 'SampleDefault',
      propEntries: [['2xl', true]],
    });

    expect(scaffold).toContain('{...{"2xl":true}}');
    expect(() => parse(scaffold, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
  });

  it('does not use cross-file re-exports as compound children', () => {
    const scaffold = buildSampleScaffold({
      sourceCode: `
export const Alert = (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />;
export { AlertTitle } from './alert-title';
`,
      componentName: 'Alert',
      exportName: 'SampleDefault',
      propEntries: [],
    });

    expect(scaffold).not.toContain('<AlertTitle>');
    expect(scaffold).toContain('<Alert');
  });

  it('does not use unrelated PascalCase exports as compound children', () => {
    const scaffold = buildSampleScaffold({
      sourceCode: `
export const Alert = (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />;
export const Button = ({ children }: { children: React.ReactNode }) => <button>{children}</button>;
`,
      componentName: 'Alert',
      exportName: 'SampleDefault',
      propEntries: [],
    });

    expect(scaffold).not.toContain('<Button>');
    expect(scaffold).toContain('<Alert');
  });
});

describe('normalizeSampleComponentName', () => {
  it('normalizes path-like names to JSX-safe identifiers', () => {
    expect(normalizeSampleComponentName('components/user-card.tsx')).toBe('UserCard');
  });
});

describe('buildContainerSampleJsxBody', () => {
  it('returns a JSX body and the names it references for a compound module', () => {
    const result = buildContainerSampleJsxBody({
      sourceCode: ALERT_SOURCE,
      componentName: 'Alert',
    });

    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.body.startsWith('<Alert>')).toBe(true);
    expect(result.body.endsWith('</Alert>')).toBe(true);
    expect(result.body).toContain('<AlertTitle>');
    expect(result.body).toContain('<AlertDescription>');
    // Referenced names include the root and every subcomponent in source order
    expect(result.referencedNames).toContain('Alert');
    expect(result.referencedNames).toContain('AlertTitle');
    expect(result.referencedNames).toContain('AlertDescription');
    // The body must parse as valid JSX expression once wrapped in an arrow
    expect(() =>
      parse(`const X = () => (${result.body});`, { sourceType: 'module', plugins: ['typescript', 'jsx'] }),
    ).not.toThrow();
  });

  it('returns null when there are no compound subcomponents', () => {
    const result = buildContainerSampleJsxBody({
      sourceCode: `
import * as React from "react";
export const Button = (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />;
`,
      componentName: 'Button',
    });
    expect(result).toBeNull();
  });
});

// Minimal stand-in for a real shadcn/ui carousel.tsx — the only thing that
// matters for the scaffold pipeline is the set of named PascalCase exports
// (the bodies are arrow components so `scanRenderableExportNames` keeps them).
// Real shadcn export shape: Carousel, CarouselContent, CarouselItem,
// CarouselPrevious, CarouselNext (plus a CarouselApi *type* which we want the
// scaffold to ignore — type-only exports are filtered upstream).
const CAROUSEL_SOURCE = `
import * as React from "react";
import useEmblaCarousel, { type UseEmblaCarouselType } from "embla-carousel-react";

export type CarouselApi = UseEmblaCarouselType[1];

export const Carousel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>((props, ref) => <div ref={ref} {...props} />);

export const CarouselContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>((props, ref) => <div ref={ref} {...props} />);

export const CarouselItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>((props, ref) => <div ref={ref} role="group" {...props} />);

export const CarouselPrevious = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>((props, ref) => <button ref={ref} {...props} />);

export const CarouselNext = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>((props, ref) => <button ref={ref} {...props} />);
`;

describe('compound shadcn carousel scaffold', () => {
  it('buildSampleScaffold renders Carousel + Content + Item + Previous + Next', () => {
    const scaffold = buildSampleScaffold({
      sourceCode: CAROUSEL_SOURCE,
      componentName: 'Carousel',
      exportName: 'SampleDefault',
      propEntries: [],
    });

    expect(scaffold).toContain('<Carousel>');
    expect(scaffold).toContain('<CarouselContent>');
    expect(scaffold).toContain('<CarouselItem>');
    expect(scaffold).toContain('<CarouselPrevious>');
    expect(scaffold).toContain('<CarouselNext>');
    expect(scaffold).toContain('</Carousel>');
    // Type-only exports must not leak into the scaffold
    expect(scaffold).not.toContain('CarouselApi');
    expect(scaffold).not.toContain('TODO');
    // The whole scaffold must parse as TS+JSX
    expect(() => parse(scaffold, { sourceType: 'module', plugins: ['typescript', 'jsx'] })).not.toThrow();
  });

  it('buildDeterministicContainerSampleScaffold produces a non-null scaffold for compound modules', () => {
    const scaffold = buildDeterministicContainerSampleScaffold({
      sourceCode: CAROUSEL_SOURCE,
      componentName: 'Carousel',
      exportName: 'SampleDefault',
    });

    expect(scaffold).not.toBeNull();
    if (!scaffold) return;
    expect(scaffold).toContain('<CarouselItem>');
    expect(scaffold).toContain('<CarouselPrevious>');
    expect(scaffold).toContain('<CarouselNext>');
  });

  it('buildContainerSampleJsxBody references every compound part for the synthetic SampleDefault path', () => {
    const result = buildContainerSampleJsxBody({
      sourceCode: CAROUSEL_SOURCE,
      componentName: 'Carousel',
    });

    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.body.startsWith('<Carousel>')).toBe(true);
    expect(result.body.endsWith('</Carousel>')).toBe(true);
    expect(result.body).toContain('<CarouselContent>');
    expect(result.body).toContain('<CarouselItem>');
    expect(result.body).toContain('<CarouselPrevious>');
    expect(result.body).toContain('<CarouselNext>');

    // referencedNames is consumed by the generator to decide which symbols to
    // namespace-prefix in the inline arrow it emits — so the carousel root
    // and every part the scaffold mentions must be present.
    expect(result.referencedNames).toContain('Carousel');
    expect(result.referencedNames).toContain('CarouselContent');
    expect(result.referencedNames).toContain('CarouselItem');
    expect(result.referencedNames).toContain('CarouselPrevious');
    expect(result.referencedNames).toContain('CarouselNext');

    expect(() =>
      parse(`const X = () => (${result.body});`, { sourceType: 'module', plugins: ['typescript', 'jsx'] }),
    ).not.toThrow();
  });
});
