import { describe, expect, it } from 'bun:test';
import { parse } from '@babel/parser';
import { buildSampleScaffold, normalizeSampleComponentName } from '../sample-scaffold';

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
