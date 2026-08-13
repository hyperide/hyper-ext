import { describe, expect, it } from 'bun:test';
import type { PropInfo } from '../../types';
import { generateSamplePropValues } from '../sample-values';

function prop(partial: Partial<PropInfo> & { name: string }): PropInfo {
  return { type: 'string', required: true, ...partial };
}

describe('generateSamplePropValues', () => {
  it('returns empty result for no props', () => {
    const result = generateSamplePropValues([]);
    expect(result.values).toEqual({});
    expect(result.unsatisfied).toEqual([]);
  });

  it('generates a string value', () => {
    const result = generateSamplePropValues([prop({ name: 'title', type: 'string' })]);
    expect(typeof result.values.title).toBe('string');
    expect((result.values.title as string).length).toBeGreaterThan(0);
    expect(result.unsatisfied).toEqual([]);
  });

  it('generates a number value', () => {
    const result = generateSamplePropValues([prop({ name: 'count', type: 'number' })]);
    expect(typeof result.values.count).toBe('number');
    expect(result.unsatisfied).toEqual([]);
  });

  it('generates a boolean value', () => {
    const result = generateSamplePropValues([prop({ name: 'active', type: 'boolean' })]);
    expect(typeof result.values.active).toBe('boolean');
    expect(result.unsatisfied).toEqual([]);
  });

  it('picks the first member of a string-literal union (enum)', () => {
    const result = generateSamplePropValues([prop({ name: 'size', type: '"small" | "medium" | "large"' })]);
    expect(result.values.size).toBe('small');
    expect(result.unsatisfied).toEqual([]);
  });

  it('generates a single-element array for array types', () => {
    const result = generateSamplePropValues([prop({ name: 'tags', type: 'string[]' })]);
    expect(Array.isArray(result.values.tags)).toBe(true);
    expect((result.values.tags as unknown[]).length).toBe(1);
    expect(result.unsatisfied).toEqual([]);
  });

  it('recurses into nested objectFields to build a deep object', () => {
    const tweetProp = prop({
      name: 'tweet',
      type: 'Tweet',
      objectFields: [
        prop({ name: 'likes', type: 'number' }),
        prop({ name: 'text', type: 'string' }),
        prop({
          name: 'user',
          type: 'User',
          objectFields: [
            prop({ name: 'name', type: 'string' }),
            prop({ name: 'verified', type: 'boolean' }),
            prop({ name: 'avatar', type: 'string' }),
          ],
        }),
      ],
    });

    const result = generateSamplePropValues([tweetProp]);
    const tweet = result.values.tweet as Record<string, unknown>;
    expect(typeof tweet).toBe('object');
    expect(typeof tweet.likes).toBe('number');
    expect(typeof tweet.text).toBe('string');
    const user = tweet.user as Record<string, unknown>;
    expect(typeof user.name).toBe('string');
    expect(typeof user.verified).toBe('boolean');
    expect(typeof user.avatar).toBe('string');
    // Everything was satisfiable from the schema → nothing flagged.
    expect(result.unsatisfied).toEqual([]);
  });

  it('treats `number | null` as a number, not an enum string', () => {
    const result = generateSamplePropValues([prop({ name: 'count', type: 'number | null' })]);
    expect(result.values.count).toBe(1);
    expect(result.unsatisfied).toEqual([]);
  });

  it('treats `boolean | undefined` as a boolean, not an enum string', () => {
    const result = generateSamplePropValues([prop({ name: 'enabled', type: 'boolean | undefined' })]);
    expect(typeof result.values.enabled).toBe('boolean');
    expect(result.unsatisfied).toEqual([]);
  });

  it('treats `string | null` as a string', () => {
    const result = generateSamplePropValues([prop({ name: 'label', type: 'string | null' })]);
    expect(typeof result.values.label).toBe('string');
    expect(result.unsatisfied).toEqual([]);
  });

  it('still picks the first literal of a literal-or-null union', () => {
    const result = generateSamplePropValues([prop({ name: 'size', type: '"sm" | "lg" | null' })]);
    expect(result.values.size).toBe('sm');
  });

  it('generates a no-op function for function-typed props', () => {
    const result = generateSamplePropValues([prop({ name: 'onClick', type: '() => void' })]);
    expect(typeof result.values.onClick).toBe('function');
    expect(result.unsatisfied).toEqual([]);
  });

  it('flags a named-type object prop with no objectFields as unsatisfied', () => {
    // A required named type we could not resolve to a field schema — we cannot
    // confidently fabricate its shape, so it must be surfaced to the user.
    const result = generateSamplePropValues([prop({ name: 'config', type: 'AppConfig' })]);
    expect(result.unsatisfied).toContain('config');
    // It must NOT silently emit an empty object that would crash on property access.
    expect(result.values.config).toBeUndefined();
  });

  it('flags an unknown/any prop as unsatisfied', () => {
    const result = generateSamplePropValues([prop({ name: 'data', type: 'unknown' })]);
    expect(result.unsatisfied).toContain('data');
    expect(result.values.data).toBeUndefined();
  });

  it('skips optional props that cannot be satisfied (no value, not flagged)', () => {
    // Optional unresolvable prop: omitting it is fine, the component handles undefined.
    const result = generateSamplePropValues([prop({ name: 'extra', type: 'AppConfig', required: false })]);
    expect(result.values.extra).toBeUndefined();
    expect(result.unsatisfied).not.toContain('extra');
  });

  it('dedupes a prop that appears twice, preferring the richer entry', () => {
    // ComponentService can emit the same prop twice: once from the TS type
    // annotation (rich, with objectFields) and once from destructuring (unknown).
    // The richer entry must win and the prop must NOT be flagged unsatisfied.
    const tweetRich = prop({
      name: 'tweet',
      type: 'Tweet',
      objectFields: [prop({ name: 'likes', type: 'number' })],
    });
    const tweetBare = prop({ name: 'tweet', type: 'unknown' });

    const result = generateSamplePropValues([tweetRich, tweetBare]);
    const tweet = result.values.tweet as Record<string, unknown> | undefined;
    expect(tweet?.likes).toBe(1);
    expect(result.unsatisfied).not.toContain('tweet');
  });

  it('dedupes regardless of entry order (bare first, rich second)', () => {
    const tweetBare = prop({ name: 'tweet', type: 'unknown' });
    const tweetRich = prop({
      name: 'tweet',
      type: 'Tweet',
      objectFields: [prop({ name: 'likes', type: 'number' })],
    });

    const result = generateSamplePropValues([tweetBare, tweetRich]);
    const tweet = result.values.tweet as Record<string, unknown> | undefined;
    expect(tweet?.likes).toBe(1);
    expect(result.unsatisfied).not.toContain('tweet');
  });

  it('does not flag children / ReactNode props', () => {
    const result = generateSamplePropValues([prop({ name: 'children', type: 'ReactNode' })]);
    expect(result.unsatisfied).not.toContain('children');
  });

  it('gives a REQUIRED ReactNode children prop a visible text placeholder', () => {
    // A required `children: ReactNode` must render SOMETHING — otherwise buttons /
    // containers render empty. We fabricate a placeholder string so the component
    // has visible content. (Still never flagged as unsatisfied.)
    const result = generateSamplePropValues([prop({ name: 'children', type: 'ReactNode', required: true })]);
    expect(typeof result.values.children).toBe('string');
    expect((result.values.children as string).length).toBeGreaterThan(0);
    expect(result.unsatisfied).not.toContain('children');
  });

  it('gives a required ReactNode prop named other than `children` a placeholder too', () => {
    const result = generateSamplePropValues([prop({ name: 'icon', type: 'ReactNode', required: true })]);
    expect(typeof result.values.icon).toBe('string');
    expect((result.values.icon as string).length).toBeGreaterThan(0);
  });

  it('does NOT fabricate a string for element-only React types (ReactElement / JSX.Element)', () => {
    // A string is the wrong shape for code that does React.cloneElement(icon) or
    // reads icon.props — only broad ReactNode safely accepts a text child.
    for (const type of ['ReactElement', 'React.ReactElement', 'JSX.Element']) {
      const result = generateSamplePropValues([prop({ name: 'icon', type, required: true })]);
      expect(result.values.icon).toBeUndefined();
      // Still ReactNode-ish, so still never flagged unsatisfied.
      expect(result.unsatisfied).not.toContain('icon');
    }
  });

  it('leaves an OPTIONAL ReactNode children prop unset (no placeholder)', () => {
    // Optional children: keep as-is — undefined is renderable and the component
    // is expected to handle its absence.
    const result = generateSamplePropValues([prop({ name: 'children', type: 'ReactNode', required: false })]);
    expect(result.values.children).toBeUndefined();
    expect(result.unsatisfied).not.toContain('children');
  });

  it('gives a REQUIRED React.ReactNode children prop a text placeholder (qualified name)', () => {
    // Regression guard: _getTypeString previously returned 'unknown' for
    // TSQualifiedName nodes (React.ReactNode), so acceptsTextPlaceholder never
    // fired. After the fix, 'React.ReactNode' is produced and lowercased to
    // 'react.reactnode' which matches in acceptsTextPlaceholder.
    const result = generateSamplePropValues([prop({ name: 'children', type: 'React.ReactNode', required: true })]);
    expect(typeof result.values.children).toBe('string');
    expect((result.values.children as string).length).toBeGreaterThan(0);
    expect(result.unsatisfied).not.toContain('children');
  });
});
