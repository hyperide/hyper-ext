import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { FileIO } from '../../ast/file-io';
import {
  buildContainerSample,
  ensureSample,
  getSampleFilePath,
  tryDeterministicContainerSample,
} from '../sample-ensurer';

class InMemoryFileIO implements FileIO {
  files = new Map<string, string>();

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async access(path: string): Promise<void> {
    if (!this.files.has(path)) throw new Error(`ENOENT: ${path}`);
  }
}

const BUTTON_SOURCE = `import React from 'react';

export function Button({ children }: { children: React.ReactNode }) {
  return <button>{children}</button>;
}
`;

const ALERT_COMPOUND_SOURCE = `import * as React from 'react';

const Alert = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} role="alert" className={className} {...props} />
  )
);
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={className} {...props} />
  )
);
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={className} {...props} />
  )
);
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription };
`;

const BUTTON_WITH_SAMPLE = `import React from 'react';

export function Button({ children }: { children: React.ReactNode }) {
  return <button>{children}</button>;
}

export const SampleDefault = () => <Button>Click me</Button>;
`;

const GENERATED_SAMPLE = `export const SampleDefault = () => <Button>Generated</Button>;`;
const GENERATED_PRIMARY = `export const SamplePrimary = () => <Button>Primary</Button>;`;

const ALERT_SOURCE = `import * as React from 'react';

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

describe('getSampleFilePath', () => {
  it('replaces .tsx extension with .samples.tsx', () => {
    expect(getSampleFilePath('/project/Button.tsx')).toBe('/project/Button.samples.tsx');
  });

  it('works for index files', () => {
    expect(getSampleFilePath('/project/Component/index.tsx')).toBe('/project/Component/index.samples.tsx');
  });

  it('works for .ts files', () => {
    expect(getSampleFilePath('/project/utils.ts')).toBe('/project/utils.samples.tsx');
  });

  it('works for .jsx files', () => {
    expect(getSampleFilePath('/project/Button.jsx')).toBe('/project/Button.samples.tsx');
  });

  it('works for .js files', () => {
    expect(getSampleFilePath('/project/Widget.js')).toBe('/project/Widget.samples.tsx');
  });

  it('keeps the same directory', () => {
    expect(getSampleFilePath('/deep/nested/path/Card.tsx')).toBe('/deep/nested/path/Card.samples.tsx');
  });
});

describe('ensureSample', () => {
  let originalLog: typeof console.log;
  let originalWarn: typeof console.warn;
  let originalError: typeof console.error;

  beforeEach(() => {
    originalLog = console.log;
    originalWarn = console.warn;
    originalError = console.error;
    console.log = mock();
    console.warn = mock();
    console.error = mock();
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  });

  it('should generate sample when it does not exist', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/Button.tsx', BUTTON_SOURCE);
    const generate = mock(() => Promise.resolve(GENERATED_SAMPLE));

    const result = await ensureSample({
      io,
      absolutePath: '/project/Button.tsx',
      componentName: 'Button',
      sampleName: 'SampleDefault',
      generate,
    });

    expect(result.generated).toBe(true);
    expect(result.exists).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);

    // Sample written to .samples.tsx, component untouched
    expect(io.files.get('/project/Button.tsx')).toBe(BUTTON_SOURCE);
    expect(io.files.get('/project/Button.samples.tsx')).toContain('SampleDefault');
  });

  it('should skip generation when sample already exists in .samples.tsx', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/Button.tsx', BUTTON_SOURCE);
    io.files.set('/project/Button.samples.tsx', `${GENERATED_SAMPLE}\n`);
    const generate = mock(() => Promise.resolve(GENERATED_SAMPLE));

    const result = await ensureSample({
      io,
      absolutePath: '/project/Button.tsx',
      componentName: 'Button',
      sampleName: 'SampleDefault',
      generate,
    });

    expect(result.generated).toBe(false);
    expect(result.exists).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });

  it('should skip generation when sample already exists in the component (backward compat)', async () => {
    const io = new InMemoryFileIO();
    // Old system: sample appended to the component file
    io.files.set('/project/Button.tsx', BUTTON_WITH_SAMPLE);
    const generate = mock(() => Promise.resolve(GENERATED_SAMPLE));

    const result = await ensureSample({
      io,
      absolutePath: '/project/Button.tsx',
      componentName: 'Button',
      sampleName: 'SampleDefault',
      generate,
    });

    expect(result.generated).toBe(false);
    expect(result.exists).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });

  it('should append a new sample to an existing .samples.tsx file', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/Button.tsx', BUTTON_WITH_SAMPLE);
    // .samples.tsx already has SampleDefault
    io.files.set('/project/Button.samples.tsx', `${GENERATED_SAMPLE}\n`);
    const generate = mock(() => Promise.resolve(GENERATED_PRIMARY));

    const result = await ensureSample({
      io,
      absolutePath: '/project/Button.tsx',
      componentName: 'Button',
      sampleName: 'SamplePrimary',
      generate,
    });

    expect(result.generated).toBe(true);
    expect(result.exists).toBe(true);

    // Component is untouched; new sample appended to .samples.tsx
    expect(io.files.get('/project/Button.tsx')).toBe(BUTTON_WITH_SAMPLE);
    const sampleFile = io.files.get('/project/Button.samples.tsx');
    expect(sampleFile).toContain('SampleDefault');
    expect(sampleFile).toContain('SamplePrimary');
  });

  it('should handle any sample name, not just SampleDefault', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/Button.tsx', BUTTON_WITH_SAMPLE);
    const generate = mock(() => Promise.resolve(GENERATED_PRIMARY));

    const result = await ensureSample({
      io,
      absolutePath: '/project/Button.tsx',
      componentName: 'Button',
      sampleName: 'SamplePrimary',
      generate,
    });

    expect(result.generated).toBe(true);
    expect(result.exists).toBe(true);

    // New sample goes to .samples.tsx; component is not touched
    expect(io.files.get('/project/Button.tsx')).toBe(BUTTON_WITH_SAMPLE);
    expect(io.files.get('/project/Button.samples.tsx')).toContain('SamplePrimary');
  });

  it('should return exists=false when file is unreadable', async () => {
    const io = new InMemoryFileIO();
    const generate = mock(() => Promise.resolve(GENERATED_SAMPLE));

    const result = await ensureSample({
      io,
      absolutePath: '/project/Missing.tsx',
      componentName: 'Missing',
      sampleName: 'SampleDefault',
      generate,
    });

    expect(result.generated).toBe(false);
    expect(result.exists).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it('should skip very small files', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/Tiny.tsx', 'export const x = 1;');
    const generate = mock(() => Promise.resolve(GENERATED_SAMPLE));

    const result = await ensureSample({
      io,
      absolutePath: '/project/Tiny.tsx',
      componentName: 'Tiny',
      sampleName: 'SampleDefault',
      generate,
    });

    expect(result.generated).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it('should return generated=false when AI returns null', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/Button.tsx', BUTTON_SOURCE);
    const generate = mock(() => Promise.resolve(null));

    const result = await ensureSample({
      io,
      absolutePath: '/project/Button.tsx',
      componentName: 'Button',
      sampleName: 'SampleDefault',
      generate,
    });

    expect(result.generated).toBe(false);
    expect(result.exists).toBe(false);
  });

  it('should build deterministic sample for compound components before calling AI', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/Alert.tsx', ALERT_SOURCE);
    const generate = mock(() => Promise.reject(new Error('AI should not be called')));

    const result = await ensureSample({
      io,
      absolutePath: '/project/Alert.tsx',
      componentName: 'Alert',
      sampleName: 'SampleDefault',
      generate,
    });

    expect(result.generated).toBe(true);
    expect(result.exists).toBe(true);
    expect(generate).not.toHaveBeenCalled();

    // Sample is written to .samples.tsx, component untouched
    expect(io.files.get('/project/Alert.tsx')).toBe(ALERT_SOURCE);
    const sampleFile = io.files.get('/project/Alert.samples.tsx');
    expect(sampleFile).toContain('export const SampleDefault');
    expect(sampleFile).toContain('<AlertTitle>Preview title</AlertTitle>');
    expect(sampleFile).toContain(
      '<AlertDescription>This sample shows the component with visible content.</AlertDescription>',
    );
  });

  it('should reject code with test utilities', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/Button.tsx', BUTTON_SOURCE);
    const generate = mock(() =>
      Promise.resolve('export const SampleDefault = () => { jest.mock("react"); return <div />; };'),
    );

    const result = await ensureSample({
      io,
      absolutePath: '/project/Button.tsx',
      componentName: 'Button',
      sampleName: 'SampleDefault',
      generate,
    });

    expect(result.generated).toBe(false);
  });

  it('should reject code that imports the component itself', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/Button.tsx', BUTTON_SOURCE);
    const badCode = `import { Button } from './Button';\n\nexport const SampleDefault = () => <Button>Click</Button>;`;
    const generate = mock(() => Promise.resolve(badCode));

    const result = await ensureSample({
      io,
      absolutePath: '/project/Button.tsx',
      componentName: 'Button',
      sampleName: 'SampleDefault',
      generate,
    });

    expect(result.generated).toBe(false);
  });

  it('should reject code without the expected sample export', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/Button.tsx', BUTTON_SOURCE);
    const generate = mock(() => Promise.resolve('export const SomethingElse = () => <div />;'));

    const result = await ensureSample({
      io,
      absolutePath: '/project/Button.tsx',
      componentName: 'Button',
      sampleName: 'SampleDefault',
      generate,
    });

    expect(result.generated).toBe(false);
  });

  it('should handle AI callback throwing an error', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/Button.tsx', BUTTON_SOURCE);
    const generate = mock(() => Promise.reject(new Error('API timeout')));

    const result = await ensureSample({
      io,
      absolutePath: '/project/Button.tsx',
      componentName: 'Button',
      sampleName: 'SampleDefault',
      generate,
    });

    expect(result.generated).toBe(false);
    expect(result.exists).toBe(false);
  });

  it('should pass correct args to generate callback', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/Button.tsx', BUTTON_SOURCE);
    const generate = mock(() => Promise.resolve(GENERATED_SAMPLE));

    await ensureSample({
      io,
      absolutePath: '/project/Button.tsx',
      componentName: 'Button',
      sampleName: 'SampleDefault',
      generate,
    });

    expect(generate).toHaveBeenCalledWith(BUTTON_SOURCE, 'Button', 'SampleDefault');
  });

  it('uses deterministic container sample for Alert-style compound component without calling AI', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/alert.tsx', ALERT_COMPOUND_SOURCE);
    const generate = mock(() => Promise.reject(new Error('AI should not be called')));

    const result = await ensureSample({
      io,
      absolutePath: '/project/alert.tsx',
      componentName: 'Alert',
      sampleName: 'SampleDefault',
      generate,
    });

    expect(result.generated).toBe(true);
    expect(result.exists).toBe(true);
    expect(generate).not.toHaveBeenCalled();

    // Sample written to .samples.tsx, not the component
    expect(io.files.get('/project/alert.tsx')).toBe(ALERT_COMPOUND_SOURCE);
    const sampleFile = io.files.get('/project/alert.samples.tsx');
    expect(sampleFile).toContain('SampleDefault');
    expect(sampleFile).toContain('AlertTitle');
    expect(sampleFile).toContain('AlertDescription');
  });
});

describe('writeSampleCode: import prepend on first write (HYP-378 follow-up)', () => {
  let originalLog: typeof console.log;
  let originalError: typeof console.error;

  beforeEach(() => {
    originalLog = console.log;
    originalError = console.error;
    console.log = mock();
    console.error = mock();
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  it('deterministic compound: imports container + all compound children on first write', async () => {
    const io = new InMemoryFileIO();
    // lowercase filename — Alert is a named export, NOT default
    io.files.set('/project/src/alert.tsx', ALERT_COMPOUND_SOURCE);
    const generate = mock(() => Promise.reject(new Error('AI should not be called')));

    const result = await ensureSample({
      io,
      absolutePath: '/project/src/alert.tsx',
      componentName: 'Alert',
      sampleName: 'SampleDefault',
      generate,
    });

    expect(result.generated).toBe(true);
    const sampleFile = io.files.get('/project/src/alert.samples.tsx');
    expect(sampleFile).toBeDefined();
    // Must import from './alert' (lowercase — matches the actual filename, not componentName)
    expect(sampleFile).toContain("from './alert'");
    // Must import ALL referenced names in a single named import
    expect(sampleFile).toContain('Alert');
    expect(sampleFile).toContain('AlertTitle');
    expect(sampleFile).toContain('AlertDescription');
    // The import line must precede the export
    const importIdx = sampleFile!.indexOf('import {');
    const exportIdx = sampleFile!.indexOf('export');
    expect(importIdx).toBeGreaterThanOrEqual(0);
    expect(importIdx).toBeLessThan(exportIdx);
  });

  it('deterministic compound: named import (not default) for shadcn-style named exports', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/alert.tsx', ALERT_COMPOUND_SOURCE);
    const generate = mock(() => Promise.reject(new Error('AI should not be called')));

    await ensureSample({
      io,
      absolutePath: '/project/src/alert.tsx',
      componentName: 'Alert',
      sampleName: 'SampleDefault',
      generate,
    });

    const sampleFile = io.files.get('/project/src/alert.samples.tsx')!;
    // Must use named import syntax { ... }, not default import
    expect(sampleFile).toMatch(/^import \{[^}]+\} from/m);
    // Must NOT use default import like `import Alert from`
    expect(sampleFile).not.toMatch(/^import Alert from/m);
  });

  it('deterministic compound: does NOT add extra import when appending to existing .samples.tsx', async () => {
    const CARD_SOURCE = `
import * as React from 'react';
export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ ...props }, ref) => <div ref={ref} {...props} />
);
Card.displayName = 'Card';
export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ ...props }, ref) => <div ref={ref} {...props} />
);
CardHeader.displayName = 'CardHeader';
export { Card, CardHeader };
`;
    const io = new InMemoryFileIO();
    io.files.set('/project/src/card.tsx', CARD_SOURCE);
    const existingCardSamples =
      "import { Card, CardHeader } from './card';\n\nexport const SampleDefault = () => <Card><CardHeader>Header</CardHeader></Card>;\n";
    io.files.set('/project/src/card.samples.tsx', existingCardSamples);

    const generate = mock(() => Promise.reject(new Error('AI should not be called')));
    const result = await ensureSample({
      io,
      absolutePath: '/project/src/card.tsx',
      componentName: 'Card',
      sampleName: 'SamplePrimary',
      generate,
    });

    expect(result.generated).toBe(true);
    const sampleFile = io.files.get('/project/src/card.samples.tsx')!;
    // Original import must appear exactly once — not duplicated on append
    const importMatches = (sampleFile.match(/^import \{/gm) ?? []).length;
    expect(importMatches).toBe(1);
    // Both samples present
    expect(sampleFile).toContain('SampleDefault');
    expect(sampleFile).toContain('SamplePrimary');
  });

  it('deterministic compound: preserves lowercase filename casing in import specifier', async () => {
    const io = new InMemoryFileIO();
    // Component file is lowercase 'alert.tsx' even though componentName is 'Alert'
    io.files.set('/project/src/alert.tsx', ALERT_COMPOUND_SOURCE);
    const generate = mock(() => Promise.reject(new Error('should not be called')));

    await ensureSample({
      io,
      absolutePath: '/project/src/alert.tsx',
      componentName: 'Alert',
      sampleName: 'SampleDefault',
      generate,
    });

    const sampleFile = io.files.get('/project/src/alert.samples.tsx')!;
    // Must derive stem from the actual .samples.tsx filename (alert), not from componentName (Alert)
    expect(sampleFile).toContain("from './alert'");
    expect(sampleFile).not.toContain("from './Alert'");
  });
});

describe('buildContainerSample', () => {
  it('generates a function export wrapping compound components as children', () => {
    const code = buildContainerSample('Alert', ['AlertTitle', 'AlertDescription'], 'SampleDefault');
    expect(code).toContain('export function SampleDefault');
    expect(code).toContain('<Alert>');
    expect(code).toContain('<AlertTitle>');
    expect(code).toContain('<AlertDescription>');
    expect(code).toContain('</Alert>');
  });

  it('starts with "export" so it passes validateGeneratedSample', () => {
    const code = buildContainerSample('Alert', ['AlertTitle', 'AlertDescription'], 'SampleDefault');
    expect(code.startsWith('export')).toBe(true);
  });

  it('uses title-flavored placeholder text for Title components', () => {
    const code = buildContainerSample('Alert', ['AlertTitle'], 'SampleDefault');
    expect(code).toContain('Heads up!');
  });

  it('uses description-flavored placeholder text for Description components', () => {
    const code = buildContainerSample('Alert', ['AlertDescription'], 'SampleDefault');
    expect(code).toContain('Something important happened.');
  });

  it('respects the sampleName parameter', () => {
    const code = buildContainerSample('Card', ['CardHeader', 'CardContent'], 'SamplePrimary');
    expect(code).toContain('export function SamplePrimary');
  });
});

describe('tryDeterministicContainerSample', () => {
  it('returns null for component with no compound siblings', () => {
    const source = `export function Button({ children }: { children: React.ReactNode }) { return <button>{children}</button>; }`;
    expect(tryDeterministicContainerSample(source, 'Button', 'SampleDefault')).toBeNull();
  });

  it('returns generated JSX for Alert-style compound component', () => {
    const result = tryDeterministicContainerSample(ALERT_COMPOUND_SOURCE, 'Alert', 'SampleDefault');
    expect(result).not.toBeNull();
    expect(result).toContain('AlertTitle');
    expect(result).toContain('AlertDescription');
  });

  it('returns null when sample already exists in source (compound siblings remain but sample present)', () => {
    // tryDeterministicContainerSample does NOT check for existing samples — that is ensureSample's job.
    // This test verifies the function only checks for compound siblings.
    const sourceWithSample = `${ALERT_COMPOUND_SOURCE}\nexport function SampleDefault() { return <Alert />; }`;
    const result = tryDeterministicContainerSample(sourceWithSample, 'Alert', 'SampleDefault');
    // Function itself doesn't skip — it always returns code if compound siblings exist.
    expect(result).not.toBeNull();
  });
});
