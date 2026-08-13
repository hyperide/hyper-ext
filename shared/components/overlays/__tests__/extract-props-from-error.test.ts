import { describe, expect, it } from 'bun:test';
import { extractPropsFromError, shouldAutoCreateEmptySampleFromError } from '../extract-props-from-error';

describe('extractPropsFromError', () => {
  it('extracts from "reading \'propName\'" pattern', () => {
    expect(extractPropsFromError("Cannot read properties of undefined (reading 'likes')")).toEqual(['likes']);
  });

  it('extracts multiple reading patterns', () => {
    const msg = "Cannot read properties (reading 'a'), Cannot read properties (reading 'b')";
    expect(extractPropsFromError(msg)).toEqual(['a', 'b']);
  });

  it('deduplicates same prop name', () => {
    const msg = "reading 'x' and reading 'x' again";
    expect(extractPropsFromError(msg)).toEqual(['x']);
  });

  it('extracts from "is not defined" pattern', () => {
    expect(extractPropsFromError('tweet is not defined')).toEqual(['tweet']);
  });

  it('extracts from "is undefined" pattern', () => {
    expect(extractPropsFromError('user is undefined')).toEqual(['user']);
  });

  it('extracts from "props.X" pattern', () => {
    expect(extractPropsFromError('props.title is not a function')).toEqual(['title']);
  });

  it('returns empty array for unrecognized errors', () => {
    expect(extractPropsFromError('Something went wrong')).toEqual([]);
  });
});

describe('shouldAutoCreateEmptySampleFromError', () => {
  it('returns false when propsSchema is undefined (loading)', () => {
    expect(shouldAutoCreateEmptySampleFromError(undefined, 'Error: missing sample')).toBe(false);
  });

  it('returns true when propsSchema is empty and error has no prop hints', () => {
    expect(shouldAutoCreateEmptySampleFromError([], 'Error: missing sample')).toBe(true);
  });

  it('returns false when error mentions a prop name even with empty schema', () => {
    expect(shouldAutoCreateEmptySampleFromError([], "Cannot read properties of undefined (reading 'author')")).toBe(
      false,
    );
  });

  it('returns false when propsSchema has entries', () => {
    expect(shouldAutoCreateEmptySampleFromError([{ name: 'x', type: 'string', required: true }], 'err')).toBe(false);
  });

  // HYP-876 — a missing provider cannot be fixed by a sample; auto-writing one
  // pollutes the user's source file and re-fires the same crash in a loop.
  it('returns false for a provider-context error even with empty schema', () => {
    expect(shouldAutoCreateEmptySampleFromError([], 'useWorkspace must be used inside <WorkspaceProvider>')).toBe(
      false,
    );
    expect(shouldAutoCreateEmptySampleFromError([], 'No QueryClient set, use QueryClientProvider to set one')).toBe(
      false,
    );
    expect(
      shouldAutoCreateEmptySampleFromError(
        [],
        'could not find react-redux context value; please ensure the component is wrapped in a <Provider>',
      ),
    ).toBe(false);
  });
});
