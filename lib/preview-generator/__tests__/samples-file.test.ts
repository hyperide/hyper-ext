/**
 * Tests for HYP-378 reading half: preview builder reads sample exports from .samples.tsx.
 *
 * Covers:
 *   - buildEntry reads samples from .samples.tsx when present
 *   - buildEntry backward compat: samples in component file still work
 *   - buildEntry merges samples from both sources (union, .samples.tsx wins on collision)
 *   - generatePreviewContent emits two import lines when samplesImportPath is set
 *   - generatePreviewContent: no duplicate bindings when same sample in both files
 *   - generatePreviewContent backward compat: single import line unchanged
 */

import { describe, expect, it } from 'bun:test';
import type { FileIO } from '../../ast/file-io';
import { buildEntry } from '../preview-build-entry';
import { generatePreviewContent } from '../generator';
import type { PreviewComponentEntry } from '../types';

const ROOT = '/project';
const PREVIEW_DIR = '/project/.preview';

/** Multi-file IO: returns content by exact path, throws ENOENT for unknown paths. */
function ioWithFiles(files: Record<string, string>): FileIO {
  return {
    async readFile(path: string): Promise<string> {
      const content = files[path];
      if (content === undefined) throw new Error(`ENOENT: no such file: ${path}`);
      return content;
    },
    async writeFile(): Promise<void> {},
    async access(): Promise<void> {},
  };
}

const BUTTON_SOURCE = `
import React from 'react';
export function Button({ children }: { children: React.ReactNode }) {
  return <button>{children}</button>;
}
`;

const BUTTON_WITH_COMPONENT_SAMPLE = `
import React from 'react';
export function Button({ children }: { children: React.ReactNode }) {
  return <button>{children}</button>;
}
export const SampleDefault = () => <Button>Click me</Button>;
`;

const BUTTON_WITH_TWO_COMPONENT_SAMPLES = `
import React from 'react';
export function Button({ children }: { children: React.ReactNode }) {
  return <button>{children}</button>;
}
export const SampleDefault = () => <Button>Click me</Button>;
export const SamplePrimary = () => <Button>Primary</Button>;
`;

const SAMPLES_FILE_DEFAULT = `
export const SampleDefault = () => <button>From samples file</button>;
`;

// ─── buildEntry: reading from .samples.tsx ────────────────────────────────────

describe('buildEntry — .samples.tsx reading (HYP-378)', () => {
  it('reads SampleDefault from .samples.tsx when component file has none', async () => {
    const entry = await buildEntry(
      ROOT,
      ioWithFiles({
        '/project/src/Button.tsx': BUTTON_SOURCE,
        '/project/src/Button.samples.tsx': SAMPLES_FILE_DEFAULT,
      }),
      undefined,
      'src/Button.tsx',
      PREVIEW_DIR,
    );

    expect(entry).not.toBeNull();
    expect(entry?.sampleExports).toContain('SampleDefault');
    expect(entry?.samplesFileExports).toEqual(['SampleDefault']);
    expect(entry?.samplesImportPath).toBeDefined();
    expect(entry?.samplesImportPath).toContain('Button.samples');
  });

  it('sets samplesImportPath relative to previewDir without extension', async () => {
    const entry = await buildEntry(
      ROOT,
      ioWithFiles({
        '/project/src/Button.tsx': BUTTON_SOURCE,
        '/project/src/Button.samples.tsx': SAMPLES_FILE_DEFAULT,
      }),
      undefined,
      'src/Button.tsx',
      PREVIEW_DIR,
    );

    // previewDir = /project/.preview, samplesAbsPath = /project/src/Button.samples.tsx
    // relative path = ../src/Button.samples (no .tsx extension)
    expect(entry?.samplesImportPath).toBe('../src/Button.samples');
  });

  it('does NOT set samplesImportPath when .samples.tsx is absent', async () => {
    const entry = await buildEntry(
      ROOT,
      ioWithFiles({ '/project/src/Button.tsx': BUTTON_SOURCE }),
      undefined,
      'src/Button.tsx',
      PREVIEW_DIR,
    );

    expect(entry).not.toBeNull();
    expect(entry?.samplesImportPath).toBeUndefined();
    expect(entry?.samplesFileExports).toBeUndefined();
  });

  it('does NOT set samplesImportPath when .samples.tsx has no Sample* exports', async () => {
    const entry = await buildEntry(
      ROOT,
      ioWithFiles({
        '/project/src/Button.tsx': BUTTON_SOURCE,
        '/project/src/Button.samples.tsx': 'export const helper = () => null;',
      }),
      undefined,
      'src/Button.tsx',
      PREVIEW_DIR,
    );

    expect(entry).not.toBeNull();
    expect(entry?.samplesImportPath).toBeUndefined();
    expect(entry?.sampleExports).toHaveLength(0);
  });
});

// ─── buildEntry: backward compat (samples in component file) ─────────────────

describe('buildEntry — backward compat: samples in component file', () => {
  it('reads samples from component file when no .samples.tsx exists', async () => {
    const entry = await buildEntry(
      ROOT,
      ioWithFiles({ '/project/src/Button.tsx': BUTTON_WITH_COMPONENT_SAMPLE }),
      undefined,
      'src/Button.tsx',
      PREVIEW_DIR,
    );

    expect(entry).not.toBeNull();
    expect(entry?.sampleExports).toContain('SampleDefault');
    expect(entry?.samplesFileExports).toBeUndefined();
    expect(entry?.samplesImportPath).toBeUndefined();
  });

  it('reads multiple samples from component file', async () => {
    const entry = await buildEntry(
      ROOT,
      ioWithFiles({ '/project/src/Button.tsx': BUTTON_WITH_TWO_COMPONENT_SAMPLES }),
      undefined,
      'src/Button.tsx',
      PREVIEW_DIR,
    );

    expect(entry?.sampleExports).toContain('SampleDefault');
    expect(entry?.sampleExports).toContain('SamplePrimary');
  });
});

// ─── buildEntry: merging from both sources ────────────────────────────────────

describe('buildEntry — merging samples from both sources', () => {
  it('merges samples from component file and .samples.tsx (union)', async () => {
    const entry = await buildEntry(
      ROOT,
      ioWithFiles({
        '/project/src/Button.tsx': BUTTON_WITH_TWO_COMPONENT_SAMPLES, // SampleDefault, SamplePrimary
        '/project/src/Button.samples.tsx': 'export const SampleDark = () => <button>Dark</button>;',
      }),
      undefined,
      'src/Button.tsx',
      PREVIEW_DIR,
    );

    expect(entry?.sampleExports).toContain('SampleDefault');
    expect(entry?.sampleExports).toContain('SamplePrimary');
    expect(entry?.sampleExports).toContain('SampleDark');
    expect(entry?.samplesFileExports).toEqual(['SampleDark']);
  });

  it('deduplicates when same sample name exists in both files (.samples.tsx wins)', async () => {
    const entry = await buildEntry(
      ROOT,
      ioWithFiles({
        '/project/src/Button.tsx': BUTTON_WITH_COMPONENT_SAMPLE, // has SampleDefault
        '/project/src/Button.samples.tsx': SAMPLES_FILE_DEFAULT, // also has SampleDefault
      }),
      undefined,
      'src/Button.tsx',
      PREVIEW_DIR,
    );

    // SampleDefault appears exactly once in sampleExports
    const defaultCount = entry?.sampleExports.filter((e) => e === 'SampleDefault').length;
    expect(defaultCount).toBe(1);
    // It is attributed to .samples.tsx
    expect(entry?.samplesFileExports).toContain('SampleDefault');
  });
});

it('treats broken .samples.tsx (syntax error) as absent — falls back to component file', async () => {
  // If the .samples.tsx has a parse error, buildEntry must not fail or produce
  // broken state — it should degrade to component-only samples.
  const entry = await buildEntry(
    ROOT,
    ioWithFiles({
      '/project/src/Button.tsx': BUTTON_WITH_COMPONENT_SAMPLE,
      '/project/src/Button.samples.tsx': '<<< this is not valid typescript >>>',
    }),
    undefined,
    'src/Button.tsx',
    PREVIEW_DIR,
  );

  expect(entry).not.toBeNull();
  // Samples from component file still present
  expect(entry?.sampleExports).toContain('SampleDefault');
  // No samples file attributed — broken file treated as absent
  expect(entry?.samplesImportPath).toBeUndefined();
  expect(entry?.samplesFileExports).toBeUndefined();
});

// ─── generatePreviewContent: import line generation ──────────────────────────

describe('generatePreviewContent — samples file import lines (HYP-378)', () => {
  it('emits a separate import line for .samples.tsx when samplesImportPath is set', () => {
    const entry: PreviewComponentEntry = {
      componentPath: 'src/Button.tsx',
      componentName: 'Button',
      exportStyle: 'named',
      sampleExports: ['SampleDefault'],
      importPath: './Button',
      samplesImportPath: './Button.samples',
      samplesFileExports: ['SampleDefault'],
    };

    const content = generatePreviewContent([entry]);

    // Component import: no samples (all samples are in .samples.tsx)
    expect(content).toContain("import { Button } from './Button';");
    // Samples file import: separate line
    expect(content).toContain("import { SampleDefault as ButtonSampleDefault } from './Button.samples';");
  });

  it('does NOT include samples in the component import when they come from .samples.tsx', () => {
    const entry: PreviewComponentEntry = {
      componentPath: 'src/Button.tsx',
      componentName: 'Button',
      exportStyle: 'named',
      sampleExports: ['SampleDefault'],
      importPath: './Button',
      samplesImportPath: './Button.samples',
      samplesFileExports: ['SampleDefault'],
    };

    const content = generatePreviewContent([entry]);

    // Must NOT duplicate SampleDefault in the component import line
    expect(content).not.toContain('Button, { SampleDefault');
    expect(content).not.toContain("SampleDefault as ButtonSampleDefault } from './Button'");
  });

  it('splits samples correctly in the mixed case (some in component, some in .samples.tsx)', () => {
    const entry: PreviewComponentEntry = {
      componentPath: 'src/Button.tsx',
      componentName: 'Button',
      exportStyle: 'named',
      // SamplePrimary stays in component file; SampleDefault moved to .samples.tsx
      sampleExports: ['SampleDefault', 'SamplePrimary'],
      importPath: './Button',
      samplesImportPath: './Button.samples',
      samplesFileExports: ['SampleDefault'],
    };

    const content = generatePreviewContent([entry]);

    // Component import: includes SamplePrimary (which is still in the component file)
    expect(content).toContain('SamplePrimary as ButtonSamplePrimary');
    // Samples file: includes SampleDefault
    expect(content).toContain("import { SampleDefault as ButtonSampleDefault } from './Button.samples';");
    // SampleDefault must NOT appear in the component import line
    const componentImportLine = content
      .split('\n')
      .find((l) => l.includes("from './Button'") && !l.includes('.samples'));
    expect(componentImportLine).not.toContain('SampleDefault');
  });

  it('backward compat: single import line when no .samples.tsx (samplesImportPath absent)', () => {
    const entry: PreviewComponentEntry = {
      componentPath: 'src/Button.tsx',
      componentName: 'Button',
      exportStyle: 'named',
      sampleExports: ['SampleDefault', 'SamplePrimary'],
      importPath: './Button',
      // No samplesImportPath or samplesFileExports
    };

    const content = generatePreviewContent([entry]);

    // Single combined import line — original behavior preserved
    expect(content).toContain('SampleDefault as ButtonSampleDefault');
    expect(content).toContain('SamplePrimary as ButtonSamplePrimary');
    // All from the component path, no .samples import
    expect(content).not.toContain('.samples');
  });

  it('backward compat: default-exported component with samples in component file', () => {
    const entry: PreviewComponentEntry = {
      componentPath: 'src/Card.tsx',
      componentName: 'Card',
      exportStyle: 'default-named',
      sampleExports: ['SampleDefault'],
      importPath: './Card',
      // No samplesImportPath
    };

    const content = generatePreviewContent([entry]);

    // Default import + named sample from same line
    expect(content).toContain("import Card, { SampleDefault as CardSampleDefault } from './Card';");
    expect(content).not.toContain('.samples');
  });

  it('falls back to importing all samples from component when samplesImportPath is missing (invariant guard)', () => {
    // If samplesFileExports is set but samplesImportPath is absent (malformed entry),
    // the component file must still import all samples so bindings are not silently lost.
    const entry: PreviewComponentEntry = {
      componentPath: 'src/Button.tsx',
      componentName: 'Button',
      exportStyle: 'named',
      sampleExports: ['SampleDefault'],
      importPath: './Button',
      // samplesFileExports set but samplesImportPath missing — should not drop the import
      samplesFileExports: ['SampleDefault'],
      // samplesImportPath deliberately absent
    };

    const content = generatePreviewContent([entry]);

    // Sample must still be imported — from the component file (fallback)
    expect(content).toContain('SampleDefault as ButtonSampleDefault');
    expect(content).toContain("from './Button'");
    // No phantom second import from an undefined path
    expect(content).not.toContain("from 'undefined'");
  });

  it('default-exported component: samples from .samples.tsx → bare default import', () => {
    const entry: PreviewComponentEntry = {
      componentPath: 'src/Card.tsx',
      componentName: 'Card',
      exportStyle: 'default-named',
      sampleExports: ['SampleDefault'],
      importPath: './Card',
      samplesImportPath: './Card.samples',
      samplesFileExports: ['SampleDefault'],
    };

    const content = generatePreviewContent([entry]);

    // Component line: bare default import (sample moved out)
    expect(content).toContain("import Card from './Card';");
    // Samples line: separate
    expect(content).toContain("import { SampleDefault as CardSampleDefault } from './Card.samples';");
  });
});

// ─── buildEntry: syntheticSampleDefault suppression ──────────────────────────

describe('buildEntry — syntheticSampleDefault suppressed when SampleDefault from .samples.tsx', () => {
  // A component without SampleDefault in its own file would normally get a synthetic sample
  // generated from its compound sub-exports. When .samples.tsx provides SampleDefault,
  // the merge happens BEFORE the synthesis check, so synthesis must NOT fire.
  const SHADCN_ALERT = `
import * as React from 'react';
export const Alert = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  (props, ref) => <div ref={ref} role="alert" {...props} />
);
Alert.displayName = 'Alert';
export const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  (props, ref) => <h5 ref={ref} {...props} />
);
AlertTitle.displayName = 'AlertTitle';
`;

  it('does not generate a synthetic SampleDefault when .samples.tsx provides it', async () => {
    const entry = await buildEntry(
      ROOT,
      ioWithFiles({
        '/project/src/Alert.tsx': SHADCN_ALERT,
        '/project/src/Alert.samples.tsx': 'export const SampleDefault = () => <div>Alert sample</div>;',
      }),
      undefined,
      'src/Alert.tsx',
      PREVIEW_DIR,
    );

    expect(entry).not.toBeNull();
    expect(entry?.sampleExports).toContain('SampleDefault');
    // Synthesis must NOT have fired — syntheticSampleDefault should be undefined
    expect(entry?.syntheticSampleDefault).toBeUndefined();
    // The sample is from the .samples.tsx file
    expect(entry?.samplesFileExports).toContain('SampleDefault');
  });
});
