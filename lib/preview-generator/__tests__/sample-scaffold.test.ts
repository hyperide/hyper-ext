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

  it('keeps explicit prop values AND still adds visible children when the user filled the overlay form (HYP-1367 follow-up)', () => {
    // Regression test: this used to assert a self-closing `<Alert variant={...} />` with
    // NO children whenever any prop was present -- which is exactly the "empty button"
    // symptom (a Button/Alert/etc. with props renders with no visible content). Alert
    // genuinely accepts children (generic HTMLAttributes<HTMLDivElement>), so the fix
    // is to keep BOTH the explicit prop value and the synthesized children.
    const scaffold = buildSampleScaffold({
      sourceCode: ALERT_SOURCE,
      componentName: 'Alert',
      exportName: 'SampleDefault',
      propEntries: [['variant', 'destructive']],
    });

    expect(scaffold).toContain('<Alert');
    expect(scaffold).toContain('variant={"destructive"}');
    expect(scaffold).toContain('<AlertTitle>Preview title</AlertTitle>');
    expect(scaffold).toContain('</Alert>');
    expect(scaffold).not.toMatch(/\/>\s*\)/);
  });

  it('emits parseable JSX for explicit prop samples with children', () => {
    const scaffold = buildSampleScaffold({
      sourceCode: ALERT_SOURCE,
      componentName: 'Alert',
      exportName: 'SampleDefault',
      propEntries: [['variant', 'destructive']],
    });

    expect(scaffold).toContain('variant={"destructive"}');
    expect(scaffold).toContain('</Alert>');
    expect(() => parse(scaffold, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
  });

  it('does not synthesize children for a void-element component even with props (generic HTMLAttributes spelling)', () => {
    const scaffold = buildSampleScaffold({
      sourceCode: `
export const Avatar = React.forwardRef<HTMLImageElement, React.HTMLAttributes<HTMLImageElement>>(
  ({ className, ...props }, ref) => <img ref={ref} className={className} {...props} />,
);
`,
      componentName: 'Avatar',
      exportName: 'SampleDefault',
      propEntries: [['src', 'sample.png']],
    });

    expect(scaffold).toContain('<Avatar');
    expect(scaffold).toContain('src={"sample.png"}');
    expect(scaffold).toContain('/>');
    expect(scaffold).not.toContain('Sample content');
  });

  it('does not synthesize children for a void-element component using the SPECIALIZED attrs-type spelling (load-bearing substring match)', () => {
    // Pins the behavior TEXT_CHILDREN_SUPPRESSING_DOM_SPELLING's doc comment calls
    // load-bearing: matching `InputHTMLAttributes<HTMLInputElement>` via plain substring
    // (no leading `\b`) is what suppresses children here, not an accident. If a future
    // cleanup "fixes" the regex to require a boundary, this test catches the regression.
    const scaffold = buildSampleScaffold({
      sourceCode: `
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={className} {...props} />,
);
`,
      componentName: 'Input',
      exportName: 'SampleDefault',
      propEntries: [['placeholder', 'Email']],
    });

    expect(scaffold).toContain('placeholder={"Email"}');
    expect(scaffold).toContain('/>');
    expect(scaffold).not.toContain('Sample content');
  });

  it('does not synthesize compound children for a void-element wrapper with a same-file sibling (HYP-1399 F1/P1 regression)', () => {
    // A void wrapper (Input over <input>) with a same-prefix sibling export (InputLabel)
    // must still get NO children, even though buildCompoundChildLines would otherwise
    // splice InputLabel in as a compound child -- compound children are children too.
    const scaffold = buildSampleScaffold({
      sourceCode: `
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ ...props }, ref) => <input ref={ref} {...props} />,
);
export const InputLabel = React.forwardRef<HTMLLabelElement, React.HTMLAttributes<HTMLLabelElement>>(
  ({ ...props }, ref) => <label ref={ref} {...props} />,
);
`,
      componentName: 'Input',
      exportName: 'SampleDefault',
      propEntries: [['placeholder', 'Email']],
    });

    expect(scaffold).toContain('placeholder={"Email"}');
    expect(scaffold).toContain('/>');
    expect(scaffold).not.toContain('InputLabel');
    expect(scaffold).not.toContain('Sample content');
  });

  it('documents a known limitation: a comment mentioning a suppressing DOM-attributes spelling is indistinguishable from a real one (HYP-1373, not fixed here)', () => {
    // TEXT_CHILDREN_SUPPRESSING_DOM_SPELLING matches raw source text, so a comment merely
    // MENTIONING e.g. "React.HTMLAttributes<HTMLInputElement>" is indistinguishable from a
    // real type reference to this regex -- an attempted comment/string-stripping fix was
    // tried during review and rejected for introducing a WORSE bug (an apostrophe in JSX
    // text opened an unterminated quote span that swallowed real code, see the doc comment
    // on TEXT_CHILDREN_SUPPRESSING_DOM_SPELLING). This test pins the current, accepted
    // whole-file-scan behavior so a future change to it is deliberate (real fix: HYP-1373).
    const scaffold = buildSampleScaffold({
      sourceCode: `
// Note: this component intentionally does NOT use React.HTMLAttributes<HTMLInputElement>.
export const Button = (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />;
`,
      componentName: 'Button',
      exportName: 'SampleDefault',
      propEntries: [['variant', 'primary']],
    });

    expect(scaffold).toContain('variant={"primary"}');
    // Known limitation: the comment's mention of HTMLAttributes<HTMLInputElement> falsely
    // suppresses children for this unrelated Button.
    expect(scaffold).not.toContain('Sample content');
    expect(scaffold).toContain('/>');
  });

  it('drops an explicit `children` entry for a void component instead of forcing a crash-prone children value onto it', () => {
    const scaffold = buildSampleScaffold({
      sourceCode: `
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ ...props }, ref) => <input ref={ref} {...props} />,
);
`,
      componentName: 'Input',
      exportName: 'SampleDefault',
      propEntries: [
        ['placeholder', 'Email'],
        ['children', 'not allowed on a void element'],
      ],
    });

    expect(scaffold).toContain('placeholder={"Email"}');
    expect(scaffold).not.toContain('not allowed on a void element');
    expect(scaffold).not.toContain('children={');
    expect(scaffold).toContain('/>');
  });

  it('emits both an explicit propEntries value AND the children entry together (combined attrs+children shape)', () => {
    const scaffold = buildSampleScaffold({
      sourceCode: ALERT_SOURCE,
      componentName: 'Alert',
      exportName: 'SampleDefault',
      propEntries: [
        ['variant', 'outline'],
        ['children', 'Save'],
      ],
    });

    expect(scaffold).toContain('variant={"outline"} >');
    expect(scaffold).toContain('{"Save"}');
    expect(scaffold).not.toContain('children={');
    expect(scaffold).not.toContain('Sample content');
    expect(() => parse(scaffold, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
  });

  it('does not synthesize children for a textarea component even with props (generic HTMLAttributes spelling)', () => {
    const scaffold = buildSampleScaffold({
      sourceCode: `
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.HTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={className} {...props} />,
);
`,
      componentName: 'Textarea',
      exportName: 'SampleDefault',
      propEntries: [['rows', 4]],
    });

    expect(scaffold).toContain('<Textarea');
    expect(scaffold).toContain('rows={4}');
    expect(scaffold).toContain('/>');
    expect(scaffold).not.toContain('Sample content');
  });

  it('does not synthesize children for a <col> or <wbr> component even with props (HYP-1399 F1 regression)', () => {
    const colScaffold = buildSampleScaffold({
      sourceCode: `
export const TableColumn = React.forwardRef<HTMLTableColElement, React.HTMLAttributes<HTMLTableColElement>>(
  ({ span, ...props }, ref) => <col ref={ref} span={span} {...props} />,
);
`,
      componentName: 'TableColumn',
      exportName: 'SampleDefault',
      propEntries: [['span', 2]],
    });
    expect(colScaffold).toContain('span={2}');
    expect(colScaffold).toContain('/>');
    expect(colScaffold).not.toContain('Sample content');

    const wbrScaffold = buildSampleScaffold({
      sourceCode: `
export const Break = React.forwardRef<HTMLWBRElement, React.HTMLAttributes<HTMLWBRElement>>(
  (props, ref) => <wbr ref={ref} {...props} />,
);
`,
      componentName: 'Break',
      exportName: 'SampleDefault',
      propEntries: [['id', 'x']],
    });
    expect(wbrScaffold).toContain('id={"x"}');
    expect(wbrScaffold).toContain('/>');
    expect(wbrScaffold).not.toContain('Sample content');
  });

  it('documents a known limitation: a void/textarea/select sibling in the same file can suppress an unrelated component\'s children (HYP-1373, not fixed here)', () => {
    // componentAcceptsChildren scans the WHOLE file, not just componentName's own
    // declaration -- this predates this fix (the positive HTMLAttributes check has always
    // scanned whole-file) and two attempted precise-scoping heuristics were rejected during
    // review of this fix for being order-dependent and introducing worse false negatives of
    // their own (see the doc comment on NON_TEXT_CHILDREN_GENERIC_DOM_ELEMENTS). This test
    // pins the CURRENT, accepted-as-residual-risk behavior so a future change to it is
    // deliberate, not an accidental regression -- a real fix needs AST parsing (HYP-1373).
    const sourceCode = `
export const TextField = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ label, ...props }, ref) => <div ref={ref} {...props} />,
);
export const TextArea = React.forwardRef<HTMLTextAreaElement, React.HTMLAttributes<HTMLTextAreaElement>>(
  ({ ...props }, ref) => <textarea ref={ref} {...props} />,
);
`;

    const fieldScaffold = buildSampleScaffold({
      sourceCode,
      componentName: 'TextField',
      exportName: 'SampleDefault',
      propEntries: [['label', 'Email']],
    });
    expect(fieldScaffold).toContain('label={"Email"}');
    // Known limitation: TextArea's generic HTMLAttributes<HTMLTextAreaElement> spelling
    // elsewhere in the file suppresses TextField's own (otherwise-correct) children.
    expect(fieldScaffold).not.toContain('Sample content');

    // TextArea itself still correctly gets no children -- unaffected by the limitation.
    const textAreaScaffold = buildSampleScaffold({
      sourceCode,
      componentName: 'TextArea',
      exportName: 'SampleDefault',
      propEntries: [['rows', 3]],
    });
    expect(textAreaScaffold).toContain('rows={3}');
    expect(textAreaScaffold).not.toContain('Sample content');
  });

  it('uses an explicit `children` propEntry as the JSX children instead of duplicating it as an attribute (HYP-1399 F3 regression)', () => {
    const scaffold = buildSampleScaffold({
      sourceCode: `
export const Button = (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />;
`,
      componentName: 'Button',
      exportName: 'SampleDefault',
      propEntries: [['children', 'Save']],
    });

    // Must render as JSX children, not a `children={...}` attribute -- and must not
    // ALSO get separately synthesized "Sample content" (the duplicate-children bug).
    expect(scaffold).not.toContain('children={');
    expect(scaffold).toContain('{"Save"}');
    expect(scaffold).not.toContain('Sample content');
    expect(scaffold).toContain('</Button>');
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

  // Regression: a bare filename with no directory prefix that starts with an
  // uppercase letter (e.g. a top-level `ConlocaLogo.tsx`) used to early-return
  // verbatim, because `isValidJsxComponentName` treats `Foo.tsx` as a valid
  // dotted member expression. That leaked the `.tsx` extension into the JSX
  // tag name → `<ConlocaLogo.tsx />`. The extension must be stripped first.
  it('strips a trailing source-file extension from a bare uppercase filename', () => {
    expect(normalizeSampleComponentName('ConlocaLogo.tsx')).toBe('ConlocaLogo');
  });

  it('strips every supported source-file extension', () => {
    expect(normalizeSampleComponentName('index.tsx')).toBe('Index');
    expect(normalizeSampleComponentName('foo.jsx')).toBe('Foo');
    expect(normalizeSampleComponentName('Foo.ts')).toBe('Foo');
    expect(normalizeSampleComponentName('Foo.mjs')).toBe('Foo');
    expect(normalizeSampleComponentName('Foo.cjs')).toBe('Foo');
  });

  it('preserves a legit member expression that is not a filename', () => {
    expect(normalizeSampleComponentName('Accordion.Item')).toBe('Accordion.Item');
  });

  it('still normalizes a path-prefixed component file to its basename identifier', () => {
    expect(normalizeSampleComponentName('components/Sidebar.tsx')).toBe('Sidebar');
  });

  // Adversarial (HYP-460 audit): a Windows backslash path must still resolve to
  // the basename identifier, not leak separators / extension into the JSX tag.
  it('handles Windows backslash paths', () => {
    expect(normalizeSampleComponentName('components\\Sidebar.tsx')).toBe('Sidebar');
    expect(normalizeSampleComponentName('src\\ui\\user-card.tsx')).toBe('UserCard');
  });

  // Adversarial (HYP-460 audit): a multi-segment member expression with no
  // file-extension suffix is preserved verbatim — the extension strip only
  // targets a trailing source-file ext, not arbitrary dotted segments.
  it('preserves deep member expressions without a file extension', () => {
    expect(normalizeSampleComponentName('Foo.Bar.Baz')).toBe('Foo.Bar.Baz');
  });

  // Documented residual (HYP-460 audit): a member expression whose FINAL
  // segment is literally one of the stripped extensions (case-insensitive:
  // `.Ts`, `.Js`, …) gets that segment stripped. This is acceptable — no real
  // React member component is named `<Foo.Ts/>` / `<Foo.Js/>`; collisions with
  // the source-file ext list are not legitimate compound-component shapes.
  // Captured here so the behavior is INTENTIONAL, not an unnoticed regression.
  it('strips a trailing segment that collides with a source-file extension (documented residual)', () => {
    expect(normalizeSampleComponentName('Foo.ts')).toBe('Foo');
    expect(normalizeSampleComponentName('Foo.Ts')).toBe('Foo');
    expect(normalizeSampleComponentName('Chart.js')).toBe('Chart');
  });

  // A lowercase-leading bare name (not a component) is Pascalized, not kept.
  it('pascalizes a lowercase-leading bare identifier', () => {
    expect(normalizeSampleComponentName('button')).toBe('Button');
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
