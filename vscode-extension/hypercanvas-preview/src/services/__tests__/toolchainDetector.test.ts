import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  _resetToolchainAvailabilityCacheForTests,
  detectAvailableTools,
  detectRequiredTool,
  markToolAvailable,
  parseLinuxDistro,
} from '../toolchainDetector';

/**
 * HYP-1169 — toolchain detection for the self-healing dev-server bring-up.
 *
 * No real installs, no real probing: availability probing goes through the
 * injected `probe` seam; the filesystem cases use real tmp dirs (cheap,
 * deterministic) but never spawn anything.
 */

const tmpDirs: string[] = [];

async function makeTmpDir(prefix: string): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

async function writePackageJson(dir: string, pkg: Record<string, unknown>): Promise<void> {
  await fsp.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg));
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await fsp.rm(dir, { recursive: true, force: true });
  }
});

describe('detectRequiredTool — precedence: packageManager field → engines → lockfile', () => {
  it('prefers the packageManager field over a lockfile', async () => {
    const dir = await makeTmpDir('hyp1169-req-');
    await writePackageJson(dir, { name: 'x', packageManager: 'pnpm@10.14.0' });
    await fsp.writeFile(path.join(dir, 'bun.lock'), '');
    expect(await detectRequiredTool(dir)).toBe('pnpm');
  });

  it('parses the packageManager field name before the @version', async () => {
    const dir = await makeTmpDir('hyp1169-req-');
    await writePackageJson(dir, { name: 'x', packageManager: 'yarn@4.1.1+sha224.abc' });
    expect(await detectRequiredTool(dir)).toBe('yarn');
  });

  it('falls back to engines when no packageManager field', async () => {
    const dir = await makeTmpDir('hyp1169-req-');
    await writePackageJson(dir, { name: 'x', engines: { bun: '>=1.2' } });
    expect(await detectRequiredTool(dir)).toBe('bun');
  });

  it('engines: explicit pm engines win over a bare node engine', async () => {
    const dir = await makeTmpDir('hyp1169-req-');
    await writePackageJson(dir, { name: 'x', engines: { node: '>=20', pnpm: '>=9' } });
    expect(await detectRequiredTool(dir)).toBe('pnpm');
  });

  it('engines: a bare node engine maps to the node tool', async () => {
    const dir = await makeTmpDir('hyp1169-req-');
    await writePackageJson(dir, { name: 'x', engines: { node: '>=20' } });
    expect(await detectRequiredTool(dir)).toBe('node');
  });

  it('falls back to the lockfile when package.json declares nothing', async () => {
    const dir = await makeTmpDir('hyp1169-req-');
    await writePackageJson(dir, { name: 'x' });
    await fsp.writeFile(path.join(dir, 'pnpm-lock.yaml'), '');
    expect(await detectRequiredTool(dir)).toBe('pnpm');
  });

  it('lockfile walk-up finds the workspace-root lockfile from a subpackage', async () => {
    const root = await makeTmpDir('hyp1169-req-root-');
    const app = path.join(root, 'packages', 'app');
    await fsp.mkdir(app, { recursive: true });
    await writePackageJson(app, { name: 'app' });
    await fsp.writeFile(path.join(root, 'bun.lock'), '');
    expect(await detectRequiredTool(app)).toBe('bun');
  });

  it('defaults to npm when there is no evidence at all', async () => {
    const dir = await makeTmpDir('hyp1169-req-');
    await writePackageJson(dir, { name: 'x' });
    expect(await detectRequiredTool(dir)).toBe('npm');
  });

  it('ignores an unknown packageManager field value', async () => {
    const dir = await makeTmpDir('hyp1169-req-');
    await writePackageJson(dir, { name: 'x', packageManager: 'deno@2.0.0' });
    expect(await detectRequiredTool(dir)).toBe('npm');
  });
});

describe('parseLinuxDistro', () => {
  it('parses ubuntu', () => {
    expect(parseLinuxDistro('NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\n')).toBe('ubuntu');
  });

  it('parses debian', () => {
    expect(parseLinuxDistro('NAME="Debian GNU/Linux"\nID=debian\n')).toBe('debian');
  });

  it('treats debian-derivative IDs via ID_LIKE as debian', () => {
    expect(parseLinuxDistro('NAME="Linux Mint"\nID=linuxmint\nID_LIKE="ubuntu debian"\n')).toBe('debian');
  });

  it('returns other for unrelated distros and garbage', () => {
    expect(parseLinuxDistro('NAME="Arch Linux"\nID=arch\n')).toBe('other');
    expect(parseLinuxDistro('')).toBe('other');
  });
});

describe('detectAvailableTools', () => {
  beforeEach(() => {
    _resetToolchainAvailabilityCacheForTests();
  });
  afterEach(() => {
    _resetToolchainAvailabilityCacheForTests();
  });

  /** A probe seam where only the listed commands succeed. */
  function probeAllowing(...okCommands: string[]) {
    return mock(async (command: string) => okCommands.includes(command));
  }

  it('probes every tool in parallel and reports presence per tool', async () => {
    const probe = probeAllowing('node --version', 'bun --version');
    const available = await detectAvailableTools({ platform: 'linux', probe, readFile: async () => 'ID=debian\n' });
    expect(available.node).toBe(true);
    expect(available.bun).toBe(true);
    expect(available.npm).toBe(false);
    expect(available.pnpm).toBe(false);
    expect(available.yarn).toBe(false);
  });

  it('probes winget only on win32', async () => {
    const probe = probeAllowing('winget --version', 'node --version');
    const available = await detectAvailableTools({ platform: 'win32', probe });
    expect(available.winget).toBe(true);
    expect(available.brew).toBeNull();
    expect(available.linuxDistro).toBeNull();
    expect(probe).not.toHaveBeenCalledWith('brew --version');
  });

  it('probes brew only on darwin', async () => {
    const probe = probeAllowing('brew --version');
    const available = await detectAvailableTools({ platform: 'darwin', probe });
    expect(available.brew).toBe(true);
    expect(available.winget).toBeNull();
    expect(probe).not.toHaveBeenCalledWith('winget --version');
  });

  it('reads the linux distro from /etc/os-release without probing winget or brew', async () => {
    const probe = probeAllowing();
    const available = await detectAvailableTools({
      platform: 'linux',
      probe,
      readFile: async (p) => (p === '/etc/os-release' ? 'ID=ubuntu\n' : ''),
    });
    expect(available.linuxDistro).toBe('ubuntu');
    expect(available.winget).toBeNull();
    expect(available.brew).toBeNull();
  });

  it('reports linuxDistro other when /etc/os-release is unreadable', async () => {
    const probe = probeAllowing();
    const available = await detectAvailableTools({
      platform: 'linux',
      probe,
      readFile: async () => {
        throw new Error('ENOENT');
      },
    });
    expect(available.linuxDistro).toBe('other');
  });

  it('caches the result per session when using default deps', async () => {
    // No dep overrides → the session cache applies and the second call returns
    // the SAME object without re-probing.
    const first = await detectAvailableTools();
    const second = await detectAvailableTools();
    expect(second).toBe(first);
  });

  it('markToolAvailable flips a cached entry after a successful install', async () => {
    _resetToolchainAvailabilityCacheForTests();
    await detectAvailableTools();
    markToolAvailable('bun');
    const after = await detectAvailableTools();
    expect(after.bun).toBe(true);
  });
});
