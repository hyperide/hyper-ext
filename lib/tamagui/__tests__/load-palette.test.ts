import { describe, expect, it } from 'bun:test';
import type { FileIO } from '@lib/ast/file-io';
import { loadTamaguiPalette } from '../load-palette';

/** In-memory FileIO over a path → content map. access() throws for unknown paths. */
function fakeFileIO(files: Record<string, string>): FileIO {
  return {
    async access(p) {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
    },
    async readFile(p) {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p];
    },
    async writeFile() {},
  };
}

const CONFIG = `
  export const config = createTamagui({
    tokens: { color: { brand1: '#111111', brand9: '#222222' } },
  });
`;

describe('loadTamaguiPalette', () => {
  it('loads the palette from a root tamagui.config.ts', async () => {
    const io = fakeFileIO({ '/proj/tamagui.config.ts': CONFIG });
    const result = await loadTamaguiPalette('/proj', io);
    expect(result).toEqual({
      palette: { brand1: '#111111', brand9: '#222222' },
      configPath: '/proj/tamagui.config.ts',
    });
  });

  it('finds the config in a monorepo packages/config location', async () => {
    const io = fakeFileIO({ '/proj/packages/config/src/tamagui.config.ts': CONFIG });
    const result = await loadTamaguiPalette('/proj', io);
    expect(result?.configPath).toBe('/proj/packages/config/src/tamagui.config.ts');
    expect(result?.palette).toEqual({ brand1: '#111111', brand9: '#222222' });
  });

  it('skips a config whose colors are not statically parseable, returns null', async () => {
    const io = fakeFileIO({
      '/proj/tamagui.config.ts': `import { tokens } from '@tamagui/themes'; createTamagui({ tokens });`,
    });
    expect(await loadTamaguiPalette('/proj', io)).toBeNull();
  });

  it('returns null when no config file exists', async () => {
    expect(await loadTamaguiPalette('/proj', fakeFileIO({}))).toBeNull();
  });

  it('tolerates a trailing slash on workspaceRoot', async () => {
    const io = fakeFileIO({ '/proj/tamagui.config.ts': CONFIG });
    const result = await loadTamaguiPalette('/proj/', io);
    expect(result?.configPath).toBe('/proj/tamagui.config.ts');
  });
});
