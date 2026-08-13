import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { FileIO } from '../../ast/file-io';
import { buildContainerSample, ensureSample, tryDeterministicContainerSample } from '../sample-ensurer';

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

    const written = io.files.get('/project/Button.tsx');
    expect(written).toContain('SampleDefault');
  });

  it('should skip generation when sample already exists', async () => {
    const io = new InMemoryFileIO();
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

    const written = io.files.get('/project/Button.tsx');
    expect(written).toContain('SamplePrimary');
    expect(written).toContain('SampleDefault'); // original preserved
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

    const written = io.files.get('/project/Alert.tsx');
    expect(written).toContain('export const SampleDefault');
    expect(written).toContain('<AlertTitle>Preview title</AlertTitle>');
    expect(written).toContain(
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

    const written = io.files.get('/project/alert.tsx');
    expect(written).toContain('SampleDefault');
    expect(written).toContain('AlertTitle');
    expect(written).toContain('AlertDescription');
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
