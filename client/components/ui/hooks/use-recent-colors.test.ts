import { describe, expect, test } from 'bun:test';
import { addColor, getSnapshot, MAX_RECENT, STORAGE_KEY } from './use-recent-colors';

describe('useRecentColors store', () => {
  test('stores a color and retrieves it via getSnapshot', () => {
    addColor('#ff0000', 'red-500');

    const colors = getSnapshot();
    expect(colors).toHaveLength(1);
    expect(colors[0]).toEqual({ hex: '#ff0000', token: 'red-500' });
  });

  test('normalizes hex to lowercase', () => {
    addColor('#FF00AA', 'pink');

    const colors = getSnapshot();
    expect(colors[0].hex).toBe('#ff00aa');
  });

  test('stores color without token', () => {
    addColor('#abcdef');

    const colors = getSnapshot();
    expect(colors[0]).toEqual({ hex: '#abcdef', token: undefined });
  });

  test('deduplicates by hex (case-insensitive), moves to front', () => {
    addColor('#ff0000', 'red-500');
    addColor('#00ff00', 'green-500');
    addColor('#0000ff', 'blue-500');

    addColor('#FF0000', 'red-updated');

    const colors = getSnapshot();
    expect(colors).toHaveLength(3);
    expect(colors[0].hex).toBe('#ff0000');
    expect(colors[0].token).toBe('red-updated');
    expect(colors[1].hex).toBe('#0000ff');
    expect(colors[2].hex).toBe('#00ff00');
  });

  test('caps at MAX_RECENT colors', () => {
    for (let i = 0; i < MAX_RECENT + 3; i++) {
      addColor(`#${i.toString(16).padStart(6, '0')}`);
    }

    const colors = getSnapshot();
    expect(colors).toHaveLength(MAX_RECENT);
    expect(colors[0].hex).toBe(`#${(MAX_RECENT + 2).toString(16).padStart(6, '0')}`);
  });

  test('returns empty array when localStorage has no data', () => {
    const colors = getSnapshot();
    expect(colors).toHaveLength(0);
  });

  test('returns empty array for corrupted JSON in localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'not-valid-json');

    const colors = getSnapshot();
    expect(colors).toHaveLength(0);
  });

  test('persists to localStorage under the correct key', () => {
    addColor('#cafe00');

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? '[]');
    expect(parsed).toEqual([{ hex: '#cafe00', token: undefined }]);
  });

  test('most recent color is first in the list', () => {
    addColor('#111111');
    addColor('#222222');
    addColor('#333333');

    const colors = getSnapshot();
    expect(colors[0].hex).toBe('#333333');
    expect(colors[1].hex).toBe('#222222');
    expect(colors[2].hex).toBe('#111111');
  });
});
