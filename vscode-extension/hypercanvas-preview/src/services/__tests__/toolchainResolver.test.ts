import { describe, expect, it, mock } from 'bun:test';
import { resolveToolBinary, TOOLCHAIN_CACHE_MAX_AGE_DAYS } from '../toolchainResolver';

/**
 * HYP-1169 round 4 — the tool RESOLUTION chain: given a required tool, find
 * the absolute path to a working binary, trying in order:
 *   1. manual settings override (hypercanvas.tools.<tool>)
 *   2. cached path from <project>/.hyperide/toolchain.json (re-probed)
 *   3. the process PATH
 *   4. the user's login-shell PATH (`$SHELL -ilc 'command -v <tool>'`)
 *   5. well-known install dirs (probeToolBinaryDirs)
 * Every candidate is live-verified (`<path> --version`) before acceptance; a
 * verified result is persisted to the cache file. All primitives (verify
 * spawn, shell capture, fs, clock) are injected — no real spawns in tests.
 */

const NOW = Date.parse('2026-08-05T12:00:00.000Z');
const DAY_MS = 86_400_000;

interface CacheWrite {
  path: string;
  content: string;
}

/** Deps factory: every primitive fakeable, sensible "nothing found" defaults. */
function makeDeps(overrides: Record<string, unknown> = {}) {
  const writes: CacheWrite[] = [];
  const logs: string[] = [];
  const deps: Record<string, unknown> = {
    platform: 'darwin',
    env: { PATH: '/usr/bin:/bin' },
    homeDir: '/home/user',
    getOverride: () => undefined,
    fileExists: () => false,
    verify: mock(async () => false),
    resolveViaShellProfile: mock(async () => null),
    probeWellKnownDirs: mock(async () => [] as string[]),
    readFile: mock(async () => {
      throw new Error('ENOENT');
    }),
    writeFile: mock(async (path: string, content: string) => {
      writes.push({ path, content });
    }),
    mkdir: mock(async () => {}),
    now: () => NOW,
    onLog: (msg: string) => logs.push(msg),
    ...overrides,
  };
  return { deps, writes, logs };
}

const cacheJson = (tool: string, path: string, verifiedAt: string, source = 'path') =>
  JSON.stringify({ version: 1, tools: { [tool]: { path, source, verifiedAt } } });

describe('resolveToolBinary — override (source 1)', () => {
  it('a verifying override wins even when the tool is also on PATH', async () => {
    const { deps } = makeDeps({
      getOverride: () => '/opt/custom/bun',
      fileExists: (p: string) => p === '/usr/bin/bun', // PATH has bun too
      verify: async (p: string) => p === '/opt/custom/bun' || p === '/usr/bin/bun',
    });
    const res = await resolveToolBinary('bun', '/proj', deps);
    expect(res).toEqual({ tool: 'bun', path: '/opt/custom/bun', source: 'override' });
  });

  it('a non-verifying override falls through to the next source', async () => {
    const { deps, logs } = makeDeps({
      getOverride: () => '/opt/custom/bun',
      fileExists: (p: string) => p === '/usr/bin/bun',
      verify: async (p: string) => p === '/usr/bin/bun',
    });
    const res = await resolveToolBinary('bun', '/proj', deps);
    expect(res?.source).toBe('path');
    expect(res?.path).toBe('/usr/bin/bun');
    expect(logs.some((l) => l.includes('override') && l.includes('failed'))).toBe(true);
  });

  it('an empty/whitespace override is ignored', async () => {
    const { deps } = makeDeps({
      getOverride: () => '   ',
      fileExists: (p: string) => p === '/usr/bin/bun',
      verify: async () => true,
    });
    const res = await resolveToolBinary('bun', '/proj', deps);
    expect(res?.source).toBe('path');
  });
});

describe('resolveToolBinary — cache (source 2)', () => {
  it('a fresh cache entry that re-probes OK is used without touching PATH/shell resolvers', async () => {
    const shellProbe = mock(async () => '/shell/bun');
    const { deps } = makeDeps({
      readFile: async () => cacheJson('bun', '/cached/bun', new Date(NOW - DAY_MS).toISOString()),
      fileExists: (p: string) => p === '/cached/bun' || p === '/usr/bin/bun',
      verify: async (p: string) => p === '/cached/bun' || p === '/usr/bin/bun',
      resolveViaShellProfile: shellProbe,
    });
    const res = await resolveToolBinary('bun', '/proj', deps);
    expect(res).toEqual({ tool: 'bun', path: '/cached/bun', source: 'cache' });
    expect(shellProbe).not.toHaveBeenCalled();
  });

  it('an entry older than the max age is discarded and re-resolved', async () => {
    const { deps, writes } = makeDeps({
      readFile: async (p: string) => {
        // The cache file answers; the git-exclude probe (`.git/info/exclude`)
        // misses like it would on a fresh repo.
        if (p.includes('.git')) throw new Error('ENOENT');
        return cacheJson(
          'bun',
          '/cached/bun',
          new Date(NOW - (TOOLCHAIN_CACHE_MAX_AGE_DAYS + 1) * DAY_MS).toISOString(),
        );
      },
      fileExists: (p: string) => p === '/cached/bun' || p === '/usr/bin/bun',
      verify: async () => true,
    });
    const res = await resolveToolBinary('bun', '/proj', deps);
    expect(res?.source).toBe('path');
    expect(res?.path).toBe('/usr/bin/bun');
    // The re-resolved path replaces the stale entry.
    expect(writes).toHaveLength(1);
    const written = JSON.parse(writes[0].content);
    expect(written.tools.bun.path).toBe('/usr/bin/bun');
  });

  it('an entry whose path fails the live re-probe is discarded and re-resolved', async () => {
    const { deps } = makeDeps({
      readFile: async () => cacheJson('bun', '/cached/bun', new Date(NOW - DAY_MS).toISOString()),
      fileExists: (p: string) => p === '/cached/bun' || p === '/usr/bin/bun',
      verify: async (p: string) => p === '/usr/bin/bun', // cached path is dead
    });
    const res = await resolveToolBinary('bun', '/proj', deps);
    expect(res?.source).toBe('path');
    expect(res?.path).toBe('/usr/bin/bun');
  });

  it('an entry pointing at a deleted file is discarded without even probing', async () => {
    const verify = mock(async () => true);
    const { deps } = makeDeps({
      readFile: async () => cacheJson('bun', '/gone/bun', new Date(NOW - DAY_MS).toISOString()),
      fileExists: (p: string) => p === '/usr/bin/bun',
      verify,
    });
    const res = await resolveToolBinary('bun', '/proj', deps);
    expect(res?.source).toBe('path');
    expect(verify).not.toHaveBeenCalledWith('/gone/bun');
  });

  it('a corrupt cache file is treated as a miss', async () => {
    const { deps } = makeDeps({
      readFile: async () => '{not json',
      fileExists: (p: string) => p === '/usr/bin/bun',
      verify: async () => true,
    });
    const res = await resolveToolBinary('bun', '/proj', deps);
    expect(res?.source).toBe('path');
  });
});

describe('resolveToolBinary — PATH / shell profile / well-known (sources 3-5)', () => {
  it('finds the tool on the process PATH (all PATH entries scanned)', async () => {
    const { deps } = makeDeps({
      env: { PATH: '/usr/bin:/opt/tools' },
      fileExists: (p: string) => p === '/opt/tools/bun',
      verify: async () => true,
    });
    const res = await resolveToolBinary('bun', '/proj', deps);
    expect(res).toEqual({ tool: 'bun', path: '/opt/tools/bun', source: 'path' });
  });

  it('captures the tool from the login shell when the process PATH lacks it', async () => {
    const { deps } = makeDeps({
      env: { PATH: '/usr/bin' },
      resolveViaShellProfile: async () => '/home/user/.bun/bin/bun',
      fileExists: (p: string) => p === '/home/user/.bun/bin/bun',
      verify: async () => true,
    });
    const res = await resolveToolBinary('bun', '/proj', deps);
    expect(res?.source).toBe('shellProfile');
    expect(res?.path).toBe('/home/user/.bun/bin/bun');
  });

  it('skips the shell-profile step entirely on win32 (registry is covered by well-known dirs)', async () => {
    const shellProbe = mock(async () => 'C:\\shell\\bun.exe');
    const { deps } = makeDeps({
      platform: 'win32',
      env: { PATH: 'C:\\Windows' },
      resolveViaShellProfile: shellProbe,
      probeWellKnownDirs: async () => ['C:\\Users\\x\\.bun\\bin'],
      fileExists: (p: string) => p.toLowerCase() === 'c:\\users\\x\\.bun\\bin\\bun.exe',
      verify: async () => true,
    });
    const res = await resolveToolBinary('bun', 'C:\\proj', deps);
    expect(shellProbe).not.toHaveBeenCalled();
    expect(res?.source).toBe('wellKnown');
  });

  it('falls back to well-known dirs when PATH and shell profile both miss', async () => {
    const { deps } = makeDeps({
      probeWellKnownDirs: async () => ['/home/user/.bun/bin'],
      fileExists: (p: string) => p === '/home/user/.bun/bin/bun',
      verify: async () => true,
    });
    const res = await resolveToolBinary('bun', '/proj', deps);
    expect(res).toEqual({ tool: 'bun', path: '/home/user/.bun/bin/bun', source: 'wellKnown' });
  });

  it('a well-known candidate that fails verification does not shadow a later one', async () => {
    const { deps } = makeDeps({
      probeWellKnownDirs: async () => ['/stale/bin', '/good/bin'],
      fileExists: (p: string) => p === '/stale/bin/bun' || p === '/good/bin/bun',
      verify: async (p: string) => p === '/good/bin/bun',
    });
    const res = await resolveToolBinary('bun', '/proj', deps);
    expect(res?.path).toBe('/good/bin/bun');
  });

  it('a shell-profile result that fails verification falls through to well-known dirs', async () => {
    const { deps } = makeDeps({
      resolveViaShellProfile: async () => '/home/user/.bun/bin/bun',
      probeWellKnownDirs: async () => ['/usr/local/bin'],
      fileExists: (p: string) => p === '/home/user/.bun/bin/bun' || p === '/usr/local/bin/bun',
      verify: async (p: string) => p === '/usr/local/bin/bun',
    });
    const res = await resolveToolBinary('bun', '/proj', deps);
    expect(res?.source).toBe('wellKnown');
  });

  it('returns null when no source yields a verifiable binary', async () => {
    const { deps } = makeDeps();
    const res = await resolveToolBinary('bun', '/proj', deps);
    expect(res).toBeNull();
  });
});

describe('resolveToolBinary — cache persistence', () => {
  it('writes the verified path to <project>/.hyperide/toolchain.json after resolution', async () => {
    const { deps, writes } = makeDeps({
      fileExists: (p: string) => p === '/usr/bin/bun',
      verify: async () => true,
    });
    await resolveToolBinary('bun', '/proj', deps);
    expect(writes).toHaveLength(1);
    expect(writes[0].path.replace(/\\/g, '/')).toBe('/proj/.hyperide/toolchain.json');
    const written = JSON.parse(writes[0].content);
    expect(written.tools.bun.path).toBe('/usr/bin/bun');
    expect(written.tools.bun.source).toBe('path');
    expect(Date.parse(written.tools.bun.verifiedAt)).toBe(NOW);
  });

  it('does NOT rewrite the cache on a cache hit (verifiedAt would never age out)', async () => {
    const { deps, writes } = makeDeps({
      readFile: async () => cacheJson('bun', '/cached/bun', new Date(NOW - DAY_MS).toISOString()),
      fileExists: (p: string) => p === '/cached/bun',
      verify: async () => true,
    });
    await resolveToolBinary('bun', '/proj', deps);
    expect(writes).toHaveLength(0);
  });

  it('preserves other tools’ entries when writing', async () => {
    const { deps, writes } = makeDeps({
      readFile: async () => cacheJson('node', '/usr/bin/node', new Date(NOW - DAY_MS).toISOString()),
      fileExists: (p: string) => p === '/usr/bin/bun' || p === '/usr/bin/node',
      verify: async () => true,
    });
    await resolveToolBinary('bun', '/proj', deps);
    const written = JSON.parse(writes[0].content);
    expect(written.tools.node.path).toBe('/usr/bin/node');
    expect(written.tools.bun.path).toBe('/usr/bin/bun');
  });

  it('never throws when the cache write fails (read-only project dir)', async () => {
    const { deps } = makeDeps({
      fileExists: (p: string) => p === '/usr/bin/bun',
      verify: async () => true,
      writeFile: async () => {
        throw new Error('EACCES');
      },
    });
    const res = await resolveToolBinary('bun', '/proj', deps);
    expect(res?.source).toBe('path');
  });

  it('writes nothing when a stale entry exists but re-resolution fails entirely', async () => {
    // No successful verification → no write per the feature contract. The dead
    // entry persists (and is re-validated each start) — pruning is a known,
    // deliberate gap, not what this test pins.
    const { deps, writes } = makeDeps({
      readFile: async () => cacheJson('bun', '/gone/bun', new Date(NOW - 30 * DAY_MS).toISOString()),
    });
    const res = await resolveToolBinary('bun', '/proj', deps);
    expect(res).toBeNull();
    expect(writes).toHaveLength(0);
  });
});

describe('resolveToolBinary — fallthrough order', () => {
  it('walks override → cache → PATH → shell → well-known in order', async () => {
    const seen: string[] = [];
    const { deps } = makeDeps({
      getOverride: () => {
        seen.push('override');
        return '/nope/bun';
      },
      readFile: async () => {
        seen.push('cache');
        throw new Error('ENOENT');
      },
      env: { PATH: '/usr/bin' },
      resolveViaShellProfile: async () => {
        seen.push('shell');
        return null;
      },
      probeWellKnownDirs: async () => {
        seen.push('wellKnown');
        return ['/wk/bin'];
      },
      fileExists: (p: string) => p === '/wk/bin/bun',
      verify: async (p: string) => p === '/wk/bin/bun',
    });
    const res = await resolveToolBinary('bun', '/proj', deps);
    expect(res?.source).toBe('wellKnown');
    // The resolution-relevant prefix (a successful resolve then re-reads the
    // cache file once to merge the write — persistence, not resolution).
    expect(seen.slice(0, 4)).toEqual(['override', 'cache', 'shell', 'wellKnown']);
  });

  it('reads the win32 capital-P `Path` variable when `PATH` is absent', async () => {
    const { deps } = makeDeps({
      platform: 'win32',
      env: { Path: 'C:\\tools' },
      fileExists: (p: string) => p.toLowerCase() === 'c:\\tools\\bun.exe',
      verify: async () => true,
    });
    const res = await resolveToolBinary('bun', 'C:\\proj', deps);
    expect(res).toEqual({ tool: 'bun', path: 'C:\\tools\\bun.exe', source: 'path' });
  });
});

describe('resolveToolBinary — never throws (documented invariant)', () => {
  it('a throwing override reader degrades to null instead of aborting start()', async () => {
    const { deps, logs } = makeDeps({
      getOverride: () => {
        throw new Error('config host exploded');
      },
    });
    const res = await resolveToolBinary('bun', '/proj', deps);
    expect(res).toBeNull();
    expect(logs.some((l) => l.includes('falling back to installer'))).toBe(true);
  });

  it('a rejecting well-known-dirs probe degrades to null instead of aborting start()', async () => {
    const { deps } = makeDeps({
      probeWellKnownDirs: async () => {
        throw new Error('registry read failed');
      },
    });
    const res = await resolveToolBinary('bun', '/proj', deps);
    expect(res).toBeNull();
  });
});

describe('resolveToolBinary — cache git-exclude', () => {
  it('appends the cache file to .git/info/exclude after a cache write', async () => {
    const { deps, writes } = makeDeps({
      readFile: async (p: string) => {
        if (p.replace(/\\/g, '/').endsWith('.git/info/exclude')) return 'node_modules/\n';
        throw new Error('ENOENT');
      },
      fileExists: (p: string) => p === '/usr/bin/bun',
      verify: async () => true,
    });
    await resolveToolBinary('bun', '/proj', deps);
    const excludeWrite = writes.find((w) => w.path.replace(/\\/g, '/').endsWith('.git/info/exclude'));
    expect(excludeWrite?.content).toBe('node_modules/\n.hyperide/toolchain.json\n');
  });

  it('does not rewrite .git/info/exclude when the line is already present', async () => {
    const { deps, writes } = makeDeps({
      readFile: async (p: string) => {
        if (p.replace(/\\/g, '/').endsWith('.git/info/exclude')) return 'node_modules/\n.hyperide/toolchain.json\n';
        throw new Error('ENOENT');
      },
      fileExists: (p: string) => p === '/usr/bin/bun',
      verify: async () => true,
    });
    await resolveToolBinary('bun', '/proj', deps);
    expect(writes.some((w) => w.path.replace(/\\/g, '/').endsWith('.git/info/exclude'))).toBe(false);
  });

  it('skips the exclude write silently when the project is not a git repo', async () => {
    const { deps, writes } = makeDeps({
      fileExists: (p: string) => p === '/usr/bin/bun',
      verify: async () => true,
    });
    const res = await resolveToolBinary('bun', '/proj', deps);
    expect(res?.source).toBe('path');
    expect(writes.map((w) => w.path.replace(/\\/g, '/'))).toEqual(['/proj/.hyperide/toolchain.json']);
  });
});
