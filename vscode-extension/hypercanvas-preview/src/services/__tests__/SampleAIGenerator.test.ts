import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, mock } from 'bun:test';
import { NodeFileIO } from '../../../../../lib/ast/node-file-io';
// buildExtensionSamplePrompt is the shared detect → buildFrameworkInstructions → buildSamplePrompt
// flow the extension's sample generator delegates to (HYP-795). It imports vscode + VSCodeFileIO,
// both resolved by the test/mock-vscode.ts preload; the helper itself touches neither.
import { buildExtensionSamplePrompt } from '../SampleAIGenerator';

// vscode is already mocked globally by test/mock-vscode.ts preload.
// DO NOT call mock.module('vscode', ...) here — it replaces the global
// mock for ALL subsequent test files and causes flaky failures.

// Mock @lib/ai-client
mock.module('@lib/ai-client', () => ({
  callAI: mock(() => Promise.resolve('')),
  resolveAIConfig: () => null,
}));

// Import shared functions directly — they're pure, no mocking needed.
// buildSamplePrompt and extractCodeFromAIResponse moved from SampleAIGenerator to lib/preview-generator.
const { buildSamplePrompt, extractCodeFromAIResponse } =
  await import('../../../../../lib/preview-generator/sample-prompt');

describe('extractCodeFromAIResponse', () => {
  it('should return code starting with export', () => {
    expect(extractCodeFromAIResponse('export const SampleDefault = () => <div />')).toBe(
      'export const SampleDefault = () => <div />',
    );
  });

  it('should return code starting with import', () => {
    const code = "import { useState } from 'react';\n\nexport const SampleDefault = () => <div />";
    expect(extractCodeFromAIResponse(code)).toBe(code);
  });

  it('should strip markdown code fences', () => {
    const raw = '```tsx\nexport const SampleDefault = () => <div />\n```';
    expect(extractCodeFromAIResponse(raw)).toBe('export const SampleDefault = () => <div />');
  });

  it('should strip typescript code fences', () => {
    const raw = '```typescript\nexport const SampleDefault = () => <div />\n```';
    expect(extractCodeFromAIResponse(raw)).toBe('export const SampleDefault = () => <div />');
  });

  it('should return null for non-code response', () => {
    expect(extractCodeFromAIResponse('Here is the component you requested:')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(extractCodeFromAIResponse('')).toBeNull();
  });

  it('should trim whitespace', () => {
    expect(extractCodeFromAIResponse('  export const Foo = () => null  ')).toBe('export const Foo = () => null');
  });

  it('should extract from fences with extra text around', () => {
    const raw = 'Sure, here you go:\n\n```tsx\nexport const SampleDefault = () => <div>Test</div>\n```\n\nLet me know!';
    expect(extractCodeFromAIResponse(raw)).toBe('export const SampleDefault = () => <div>Test</div>');
  });
});

describe('buildSamplePrompt', () => {
  const sourceCode = 'export function Button({ label }: { label: string }) { return <button>{label}</button>; }';

  it('should include the component source code in the prompt', () => {
    const prompt = buildSamplePrompt(sourceCode, 'SampleDefault');
    expect(prompt).toContain(sourceCode);
  });

  it('should include the sample name in the prompt', () => {
    const prompt = buildSamplePrompt(sourceCode, 'SamplePrimary');
    expect(prompt).toContain('SamplePrimary');
  });

  it('should include critical structure rules', () => {
    const prompt = buildSamplePrompt(sourceCode, 'SampleDefault');
    expect(prompt).toContain('DO NOT import the component itself');
  });

  it('should mention forbidden test utilities', () => {
    const prompt = buildSamplePrompt(sourceCode, 'SampleDefault');
    expect(prompt).toContain('jest.mock');
    expect(prompt).toContain('vitest.mock');
  });

  it('should instruct PascalCase naming for HMR', () => {
    const prompt = buildSamplePrompt(sourceCode, 'SampleDefault');
    expect(prompt).toContain('PascalCase');
    expect(prompt).toContain('React Fast Refresh');
  });

  it('should include framework instructions when provided', () => {
    const prompt = buildSamplePrompt(sourceCode, 'SampleDefault', '**PROJECT FRAMEWORK**: Next.js App Router');
    expect(prompt).toContain('Next.js App Router');
  });
});

describe('buildExtensionSamplePrompt (HYP-795: extension runs the shared framework detector)', () => {
  const sourceCode = 'export function Page() { return <div>page</div>; }';
  const io = new NodeFileIO();
  let fixtureRoot: string;

  const makeFixture = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), 'hyp795-'));
    fixtureRoot = root;
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, content);
    }
    return root;
  };

  afterEach(() => {
    if (fixtureRoot) {
      rmSync(fixtureRoot, { recursive: true, force: true });
      fixtureRoot = '';
    }
  });

  it('produces Next.js App Router instructions for a Next.js fixture', async () => {
    const root = makeFixture({
      'package.json': JSON.stringify({ dependencies: { next: '14.0.0' } }),
      'app/layout.tsx': 'export default function L() { return null; }',
    });
    const prompt = await buildExtensionSamplePrompt(io, root, sourceCode, 'SampleDefault');
    expect(prompt).toContain('**PROJECT FRAMEWORK**: Next.js App Router');
    expect(prompt).toContain('searchParams');
    // sanity: base prompt is still there
    expect(prompt).toContain('DO NOT import the component itself');
  });

  it('produces Remix instructions for a Remix fixture', async () => {
    const root = makeFixture({
      'package.json': JSON.stringify({ dependencies: { '@remix-run/react': '2.0.0' } }),
    });
    const prompt = await buildExtensionSamplePrompt(io, root, sourceCode, 'SampleDefault');
    expect(prompt).toContain('**PROJECT FRAMEWORK**: Remix');
  });

  it('falls back to the base prompt (no framework block) when projectRoot is undefined', async () => {
    const prompt = await buildExtensionSamplePrompt(io, undefined, sourceCode, 'SampleDefault');
    expect(prompt).not.toContain('**PROJECT FRAMEWORK**');
    expect(prompt).toContain('DO NOT import the component itself');
  });

  it('passes deterministic prop baseline context into the extension prompt', async () => {
    const prompt = await buildExtensionSamplePrompt(io, undefined, sourceCode, 'SampleDefault', {
      deterministicProps: {
        values: { title: 'Sample title' },
        unsatisfied: ['data'],
      },
    });

    expect(prompt).toContain('DETERMINISTIC PROP BASELINE');
    expect(prompt).toContain('"title": "Sample title"');
    expect(prompt).toContain('"data"');
  });

  it('falls back to the base prompt when the project has no detectable framework', async () => {
    const root = makeFixture({ 'package.json': JSON.stringify({ dependencies: { lodash: '4' } }) });
    const prompt = await buildExtensionSamplePrompt(io, root, sourceCode, 'SampleDefault');
    // 'unknown' framework → the default branch ("No routing framework detected").
    expect(prompt).toContain('No routing framework detected');
  });
});
