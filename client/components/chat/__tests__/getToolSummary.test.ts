import { describe, expect, it } from 'bun:test';
import { getToolSummary } from '../ToolCallCard';

describe('getToolSummary', () => {
  it('returns path for read_file', () => {
    expect(getToolSummary('read_file', { path: 'src/utils/api.ts' })).toBe('src/utils/api.ts');
  });

  it('returns path for edit_file', () => {
    expect(getToolSummary('edit_file', { path: 'src/app.tsx', old_content: 'a', new_content: 'b' })).toBe(
      'src/app.tsx',
    );
  });

  it('returns path for write_file', () => {
    expect(getToolSummary('write_file', { path: 'new-file.ts', content: '...' })).toBe('new-file.ts');
  });

  it('returns path for delete_file', () => {
    expect(getToolSummary('delete_file', { path: 'old.ts' })).toBe('old.ts');
  });

  it('returns sourcePath → destPath for move_file (real schema)', () => {
    expect(getToolSummary('move_file', { sourcePath: 'old.ts', destPath: 'new.ts' })).toBe('old.ts → new.ts');
  });

  it('falls back to source/destination for move_file (plan keys)', () => {
    expect(getToolSummary('move_file', { source: 'old.ts', destination: 'new.ts' })).toBe('old.ts → new.ts');
  });

  it('returns pattern with path for grep_search', () => {
    expect(getToolSummary('grep_search', { pattern: 'TODO', path: 'src/' })).toBe('"TODO" in src/');
  });

  it('returns pattern without path for grep_search', () => {
    expect(getToolSummary('grep_search', { pattern: 'TODO' })).toBe('"TODO"');
  });

  it('returns pattern with path for glob_search', () => {
    expect(getToolSummary('glob_search', { pattern: '**/*.tsx', path: 'src/' })).toBe('**/*.tsx in src/');
  });

  it('returns pattern without path for glob_search', () => {
    expect(getToolSummary('glob_search', { pattern: '**/*.tsx' })).toBe('**/*.tsx');
  });

  it('truncates long bash commands at 80 chars', () => {
    const longCommand = 'a'.repeat(100);
    const result = getToolSummary('bash_exec', { command: longCommand });
    expect(result.length).toBe(81); // 80 chars + ellipsis
    expect(result.endsWith('…')).toBe(true);
  });

  it('does not truncate short bash commands', () => {
    expect(getToolSummary('bash_exec', { command: 'bun run test' })).toBe('bun run test');
  });

  it('returns command + args array for git_command (real schema)', () => {
    expect(getToolSummary('git_command', { command: 'diff', args: ['--staged'] })).toBe('diff --staged');
  });

  it('returns command + args string for git_command (fallback)', () => {
    expect(getToolSummary('git_command', { command: 'diff', args: '--staged' })).toBe('diff --staged');
  });

  it('returns command only when git_command has no args', () => {
    expect(getToolSummary('git_command', { command: 'status' })).toBe('status');
  });

  it('returns path for list_directory', () => {
    expect(getToolSummary('list_directory', { path: 'src/components/' })).toBe('src/components/');
  });

  it('returns path for tree', () => {
    expect(getToolSummary('tree', { path: 'src/' })).toBe('src/');
  });

  it('returns url for browser_navigate', () => {
    expect(getToolSummary('browser_navigate', { url: 'https://example.com' })).toBe('https://example.com');
  });

  it('returns selector for browser_click', () => {
    expect(getToolSummary('browser_click', { selector: '#submit-btn' })).toBe('#submit-btn');
  });

  it('returns ref when browser_click has no selector', () => {
    expect(getToolSummary('browser_click', { ref: 'button[0]' })).toBe('button[0]');
  });

  it('truncates long browser_type text at 60 chars', () => {
    const longText = 'x'.repeat(80);
    const result = getToolSummary('browser_type', { text: longText });
    expect(result.length).toBe(61); // 60 chars + ellipsis
  });

  it('returns query for brave_web_search', () => {
    expect(getToolSummary('brave_web_search', { query: 'react server components' })).toBe('react server components');
  });

  it('returns url for url_fetch', () => {
    expect(getToolSummary('url_fetch', { url: 'https://docs.example.com' })).toBe('https://docs.example.com');
  });

  it('returns empty string for ask_user', () => {
    expect(getToolSummary('ask_user', { question: 'What color?' })).toBe('');
  });

  it('returns componentId for canvas_* tools', () => {
    expect(getToolSummary('canvas_update', { componentId: 'btn-1' })).toBe('btn-1');
  });

  it('returns name for canvas_* tools when no componentId', () => {
    expect(getToolSummary('canvas_create', { name: 'Button' })).toBe('Button');
  });

  it('returns first string value for unknown tools', () => {
    expect(getToolSummary('unknown_tool', { foo: 42, bar: 'hello' })).toBe('hello');
  });

  it('returns empty string for unknown tools with no string values', () => {
    expect(getToolSummary('unknown_tool', { foo: 42, bar: true })).toBe('');
  });

  it('handles missing path gracefully', () => {
    expect(getToolSummary('read_file', {})).toBe('');
  });

  it('handles non-string path gracefully', () => {
    expect(getToolSummary('read_file', { path: 42 })).toBe('');
  });

  it('returns testPaths array for run_tests (real schema)', () => {
    expect(
      getToolSummary('run_tests', { testPaths: ['src/__tests__/api.test.ts', 'src/__tests__/auth.test.ts'] }),
    ).toBe('src/__tests__/api.test.ts, src/__tests__/auth.test.ts');
  });

  it('returns testPaths string for run_tests (fallback)', () => {
    expect(getToolSummary('run_tests', { testPaths: 'src/__tests__/api.test.ts' })).toBe('src/__tests__/api.test.ts');
  });
});
