import { describe, expect, it } from 'bun:test';
import { buildSamplePrompt, extractCodeFromAIResponse } from '../sample-prompt';

describe('extractCodeFromAIResponse', () => {
  // --- Happy paths ---

  it('should extract code from tsx fence', () => {
    const raw = '```tsx\nexport const SampleDefault = () => <div/>;\n```';
    expect(extractCodeFromAIResponse(raw)).toBe('export const SampleDefault = () => <div/>;');
  });

  it('should extract code from ts fence', () => {
    const raw = '```ts\nexport const SampleDefault = () => <div/>;\n```';
    expect(extractCodeFromAIResponse(raw)).toBe('export const SampleDefault = () => <div/>;');
  });

  it('should extract code from fence without language tag', () => {
    const raw = '```\nexport const SampleDefault = () => <div/>;\n```';
    expect(extractCodeFromAIResponse(raw)).toBe('export const SampleDefault = () => <div/>;');
  });

  it('should return raw code when no fences (starts with export)', () => {
    const raw = 'export const SampleDefault = () => <div/>;';
    expect(extractCodeFromAIResponse(raw)).toBe('export const SampleDefault = () => <div/>;');
  });

  it('should return raw code when no fences (starts with import)', () => {
    const raw = "import { memo } from 'react';\nexport const SampleDefault = () => <div/>;";
    expect(extractCodeFromAIResponse(raw)).toBe(raw);
  });

  it('should return null for non-code response', () => {
    expect(extractCodeFromAIResponse('Here is what I think about this component...')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(extractCodeFromAIResponse('')).toBeNull();
  });

  // --- Edge cases that should work but may not ---

  it('should extract code from jsx fence', () => {
    const raw = '```jsx\nexport const SampleDefault = () => <div/>;\n```';
    expect(extractCodeFromAIResponse(raw)).toBe('export const SampleDefault = () => <div/>;');
  });

  it('should extract code from js fence', () => {
    const raw = '```js\nexport const SampleDefault = () => <div/>;\n```';
    expect(extractCodeFromAIResponse(raw)).toBe('export const SampleDefault = () => <div/>;');
  });

  it('should handle fence without trailing newline before closing', () => {
    // AI sometimes doesn't add newline before closing fence
    const raw = '```tsx\nexport const SampleDefault = () => <div/>;```';
    expect(extractCodeFromAIResponse(raw)).toBe('export const SampleDefault = () => <div/>;');
  });

  it('should skip non-code first fence and extract from tsx fence', () => {
    const raw = `Here's the code:

\`\`\`text
This is a description
\`\`\`

\`\`\`tsx
export const SampleDefault = () => <div/>;
\`\`\``;
    expect(extractCodeFromAIResponse(raw)).toBe('export const SampleDefault = () => <div/>;');
  });

  it('should handle surrounding whitespace and explanations', () => {
    const raw = `
Sure! Here is the sample:

\`\`\`tsx
export const SampleDefault = () => <div>Hello</div>;
\`\`\`

This renders a simple div.
`;
    expect(extractCodeFromAIResponse(raw)).toBe('export const SampleDefault = () => <div>Hello</div>;');
  });
});

describe('buildSamplePrompt', () => {
  it('should include source code in tsx fence', () => {
    const prompt = buildSamplePrompt('const x = 1;', 'SampleDefault');
    expect(prompt).toContain('```tsx\nconst x = 1;\n```');
  });

  it('should interpolate sampleName in task and signature', () => {
    const prompt = buildSamplePrompt('', 'SamplePrimary');
    expect(prompt).toContain('generate a SamplePrimary component');
    expect(prompt).toContain('export const SamplePrimary');
  });

  it('should include framework instructions when provided', () => {
    const instructions = 'Use Next.js App Router patterns.';
    const prompt = buildSamplePrompt('', 'SampleDefault', instructions);
    expect(prompt).toContain(instructions);
  });

  it('should not include framework block when not provided', () => {
    const prompt = buildSamplePrompt('', 'SampleDefault');
    // No double newlines from empty framework block
    expect(prompt).not.toContain('\n\n\n');
  });

  it('should include FORBIDDEN section', () => {
    const prompt = buildSamplePrompt('', 'SampleDefault');
    expect(prompt).toContain('FORBIDDEN');
    expect(prompt).toContain('jest.mock');
  });

  it('should include CRITICAL STRUCTURE RULES', () => {
    const prompt = buildSamplePrompt('', 'SampleDefault');
    expect(prompt).toContain('CRITICAL STRUCTURE RULES');
    expect(prompt).toContain('DO NOT import the component itself');
  });
});
