import { describe, expect, it } from 'bun:test';
import { mergePathEntries, parseWindowsRegistryPath, probeToolBinaryDirs, refreshPathForChild } from '../toolchainPath';

/**
 * HYP-1169 — PATH refresh for the dev-server child after a fresh tool install.
 * The extension host process snapshots PATH at launch; a tool installed
 * mid-session (winget/brew/install script) is invisible to `process.env.PATH`
 * until the child env is rebuilt from fresh sources. All platform primitives
 * are injected — no real registry reads or spawns in tests.
 */

describe('parseWindowsRegistryPath', () => {
  it('parses a REG_SZ value', () => {
    const out = '\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_SZ    C:\\Users\\x\\bin;C:\\tools\r\n';
    expect(parseWindowsRegistryPath(out)).toBe('C:\\Users\\x\\bin;C:\\tools');
  });

  it('parses a REG_EXPAND_SZ value (the common case for user Path)', () => {
    const out =
      '\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\.bun\\bin;C:\\tools\r\n';
    expect(parseWindowsRegistryPath(out)).toBe('%USERPROFILE%\\.bun\\bin;C:\\tools');
  });

  it('returns null when the value is absent (reg error output)', () => {
    expect(parseWindowsRegistryPath('ERROR: The system was unable to find the specified registry key or value.')).toBe(
      null,
    );
  });
});

describe('mergePathEntries', () => {
  it('appends new entries and drops duplicates, keeping order', () => {
    expect(mergePathEntries('/a:/b', ['/b', '/c'], false)).toBe('/a:/b:/c');
  });

  it('dedupes case-insensitively on win32', () => {
    expect(mergePathEntries('C:\\Tools;C:\\Bin', ['c:\\tools', 'D:\\x'], true)).toBe('C:\\Tools;C:\\Bin;D:\\x');
  });

  it('ignores empty entries', () => {
    expect(mergePathEntries('/a', ['', '/b'], false)).toBe('/a:/b');
  });
});

describe('refreshPathForChild — win32', () => {
  it('merges the fresh registry user PATH (expanding %VARS%) with the process PATH', async () => {
    const env = { PATH: 'C:\\Windows;C:\\Users\\x\\.bun\\bin-old', USERPROFILE: 'C:\\Users\\x' };
    const merged = await refreshPathForChild({
      platform: 'win32',
      env,
      dirExists: () => false,
      queryWindowsUserPath: async () =>
        'HKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\.bun\\bin;C:\\Windows\r\n',
    });
    const entries = merged.split(';');
    expect(entries).toContain('C:\\Windows');
    expect(entries).toContain('C:\\Users\\x\\.bun\\bin'); // from registry, %USERPROFILE% expanded
    expect(entries).toContain('C:\\Users\\x\\.bun\\bin-old'); // from the process PATH
    // Registry's C:\\Windows must not duplicate the process one.
    expect(entries.filter((e) => e.toLowerCase() === 'c:\\windows')).toHaveLength(1);
  });

  it('appends well-known install dirs that exist (bun, winget links)', async () => {
    const env = { PATH: 'C:\\Windows', USERPROFILE: 'C:\\Users\\x', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' };
    const merged = await refreshPathForChild({
      platform: 'win32',
      env,
      dirExists: (p) => p === 'C:\\Users\\x\\.bun\\bin',
      queryWindowsUserPath: async () => null,
    });
    expect(merged.split(';')).toContain('C:\\Users\\x\\.bun\\bin');
    expect(merged).not.toContain('WinGet');
  });

  it('survives a missing registry value (first boot, no user Path)', async () => {
    const merged = await refreshPathForChild({
      platform: 'win32',
      env: { PATH: 'C:\\Windows', USERPROFILE: 'C:\\Users\\x' },
      dirExists: () => false,
      queryWindowsUserPath: async () => null,
    });
    expect(merged).toBe('C:\\Windows');
  });
});

describe('probeToolBinaryDirs — win32 (HYP-1169 round 2: resolve by PROBE, not assumption)', () => {
  const winEnv = {
    PATH: 'C:\\Windows',
    USERPROFILE: 'C:\\Users\\x',
    LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
  };

  it('finds bun in %USERPROFILE%\\.bun\\bin when bun.exe exists there', async () => {
    const dirs = await probeToolBinaryDirs('bun', {
      platform: 'win32',
      env: winEnv,
      fileExists: (p) => p === 'C:\\Users\\x\\.bun\\bin\\bun.exe',
      queryWindowsUserPath: async () => null,
    });
    expect(dirs).toContain('C:\\Users\\x\\.bun\\bin');
  });

  it('finds bun via the bunx.exe shim in WinGet\\Links when .bun\\bin is absent', async () => {
    const dirs = await probeToolBinaryDirs('bun', {
      platform: 'win32',
      env: winEnv,
      fileExists: (p) => p === 'C:\\Users\\x\\AppData\\Local\\Microsoft\\WinGet\\Links\\bunx.exe',
      queryWindowsUserPath: async () => null,
    });
    expect(dirs).toEqual(['C:\\Users\\x\\AppData\\Local\\Microsoft\\WinGet\\Links']);
  });

  it('returns EVERY dir that actually contains the binary (both .bun\\bin and WinGet\\Links)', async () => {
    const dirs = await probeToolBinaryDirs('bun', {
      platform: 'win32',
      env: winEnv,
      fileExists: (p) => p.endsWith('bun.exe') || p.endsWith('bunx.exe'),
      queryWindowsUserPath: async () => null,
    });
    expect(dirs).toContain('C:\\Users\\x\\.bun\\bin');
    expect(dirs).toContain('C:\\Users\\x\\AppData\\Local\\Microsoft\\WinGet\\Links');
  });

  it('includes registry user PATH entries that newly mention the tool and contain the binary', async () => {
    const dirs = await probeToolBinaryDirs('bun', {
      platform: 'win32',
      env: winEnv,
      fileExists: (p) => p === 'C:\\Users\\x\\scoop\\shims\\bun.exe',
      queryWindowsUserPath: async () =>
        'HKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    C:\\Users\\x\\scoop\\shims;C:\\tools\r\n',
    });
    // The scoop shim dir does not literally mention "bun" in its path — but a
    // registry entry is still a candidate only via the mention rule. This entry
    // does not mention bun, so it must NOT be picked up by the mention rule;
    // and no well-known dir has the binary either.
    expect(dirs).toEqual([]);

    const withMention = await probeToolBinaryDirs('bun', {
      platform: 'win32',
      env: winEnv,
      fileExists: (p) => p === 'C:\\tools\\bun-bin\\bun.exe',
      queryWindowsUserPath: async () =>
        'HKEY_CURRENT_USER\\Environment\r\n    Path    REG_SZ    C:\\tools\\bun-bin;C:\\tools\\other\r\n',
    });
    expect(withMention).toContain('C:\\tools\\bun-bin');
    expect(withMention).not.toContain('C:\\tools\\other');
  });

  it('probes node.exe for node and npm.cmd for npm in the winget nodejs dir', async () => {
    const env = { ...winEnv, ProgramFiles: 'C:\\Program Files' };
    const nodeDirs = await probeToolBinaryDirs('node', {
      platform: 'win32',
      env,
      fileExists: (p) => p === 'C:\\Program Files\\nodejs\\node.exe',
      queryWindowsUserPath: async () => null,
    });
    expect(nodeDirs).toContain('C:\\Program Files\\nodejs');
    const npmDirs = await probeToolBinaryDirs('npm', {
      platform: 'win32',
      env,
      fileExists: (p) => p === 'C:\\Program Files\\nodejs\\npm.cmd',
      queryWindowsUserPath: async () => null,
    });
    expect(npmDirs).toContain('C:\\Program Files\\nodejs');
  });

  it('a dir that exists but does NOT contain the binary is not returned (probe, not assumption)', async () => {
    const dirs = await probeToolBinaryDirs('bun', {
      platform: 'win32',
      env: winEnv,
      fileExists: () => false,
      queryWindowsUserPath: async () => null,
    });
    expect(dirs).toEqual([]);
  });
});

describe('probeToolBinaryDirs — unix', () => {
  it('finds bun in ~/.bun/bin when the binary exists there', async () => {
    const dirs = await probeToolBinaryDirs('bun', {
      platform: 'darwin',
      env: { PATH: '/usr/bin' },
      homeDir: '/home/u',
      fileExists: (p) => p === '/home/u/.bun/bin/bun',
    });
    expect(dirs).toContain('/home/u/.bun/bin');
  });

  it('returns nothing when no candidate dir contains the binary', async () => {
    const dirs = await probeToolBinaryDirs('bun', {
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      homeDir: '/home/u',
      fileExists: () => false,
    });
    expect(dirs).toEqual([]);
  });
});

describe('refreshPathForChild — unix', () => {
  it('appends ~/.bun/bin, ~/.local/bin, ~/bin and the nvm current bin when they exist', async () => {
    const merged = await refreshPathForChild({
      platform: 'darwin',
      env: { PATH: '/usr/bin:/bin' },
      homeDir: '/home/u',
      dirExists: (p) => ['/home/u/.bun/bin', '/home/u/.local/bin', '/home/u/.nvm/current/bin'].includes(p),
    });
    expect(merged).toBe('/usr/bin:/bin:/home/u/.bun/bin:/home/u/.local/bin:/home/u/.nvm/current/bin');
  });

  it('does not append entries already on PATH and skips dirs that do not exist', async () => {
    const merged = await refreshPathForChild({
      platform: 'linux',
      env: { PATH: '/usr/bin:/home/u/.bun/bin' },
      homeDir: '/home/u',
      dirExists: (p) => p === '/home/u/.bun/bin' || p === '/home/u/bin',
    });
    expect(merged).toBe('/usr/bin:/home/u/.bun/bin:/home/u/bin');
  });
});
