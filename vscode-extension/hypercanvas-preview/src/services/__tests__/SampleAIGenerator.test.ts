import { describe, expect, it, mock } from 'bun:test';

// Mock vscode (not used by the pure functions we test)
mock.module('vscode', () => ({
  workspace: { getConfiguration: () => ({ get: () => '' }) },
  ExtensionContext: class {},
}));

// Mock @lib/ai-client
mock.module('@lib/ai-client', () => ({
  callAI: mock(() => Promise.resolve('')),
  resolveAIConfig: () => null,
}));

// Import shared functions directly — they're pure, no mocking needed.
// buildSamplePrompt and extractCodeFromAIResponse moved from SampleAIGenerator to lib/preview-generator.
const { buildSamplePrompt, extractCodeFromAIResponse } = await import(
  '../../../../../lib/preview-generator/sample-prompt'
);

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
