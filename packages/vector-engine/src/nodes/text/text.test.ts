import { describe, expect, it } from 'bun:test';
import { textToPathNode } from './text-to-path';

describe('text to path', () => {
  it('should have correct node definition', () => {
    expect(textToPathNode.type).toBe('textToPath');
    expect(textToPathNode.category).toBe('generator');
    expect(textToPathNode.params.map((p) => p.name)).toContain('text');
    expect(textToPathNode.params.map((p) => p.name)).toContain('fontSize');
  });

  it('should output empty path when no font loaded', () => {
    const result = textToPathNode.execute(
      {},
      {
        text: 'Hello',
        fontSize: 24,
        fontUrl: '',
      },
    );
    const pathVal = (result.path as { value: { commands: { length: number } } }).value;
    expect(pathVal.commands.length).toBe(0);
  });

  it('should output empty path for empty text', () => {
    const result = textToPathNode.execute(
      {},
      {
        text: '',
        fontSize: 24,
        fontUrl: '',
      },
    );
    const pathVal = (result.path as { value: { commands: { length: number } } }).value;
    expect(pathVal.commands.length).toBe(0);
  });
});
