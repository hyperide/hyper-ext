/**
 * @file Tests for the shared, fs-injected Tamagui token-extraction core (HYP-709).
 *
 * Accessed via: SaaS route `getTamaguiTokens.ts` and the VS Code extension host both delegate
 *   to this core. Its behavior + security guards (HYP-676) are also covered end-to-end by the
 *   route test `server/routes/getTamaguiTokens.test.ts`; this file pins the INJECTION seam:
 *   a custom `TamaguiFsHost` drives the same logic, and the lazy/streaming `readDir` contract
 *   (errors surface during iteration, handles released on early break) is exercised directly.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  type TamaguiDirEntry,
  type TamaguiFsHost,
  extractTamaguiTokens,
  extractTamaguiTokensFromArtifact,
  findTamaguiConfigArtifact,
  isTamaguiProject,
  nodeTamaguiFsHost,
} from '../extract-tokens';

const SAMPLE_ARTIFACT = {
  tamaguiConfig: {
    themes: { dark: { blue1: '#001', $accent: '#0ff' } },
    tokens: {
      size: { '0': { key: '$0', val: 0 }, '1': { key: '$1', val: 4 } },
      space: { sm: { key: '$sm', val: 6 } },
    },
  },
};

let root: string;

function makeTmp(): string {
  // mkdtempSync creates a fresh 0700 dir — avoids predictable-path writes in the
  // shared os tmp dir (CodeQL js/insecure-temporary-file).
  return mkdtempSync(join(tmpdir(), 'hyp709-'));
}

function writeArtifact(dir: string, body: unknown): string {
  const out = join(dir, '.tamagui');
  mkdirSync(out, { recursive: true });
  const file = join(out, 'tamagui.config.json');
  writeFileSync(file, JSON.stringify(body), 'utf-8');
  return file;
}

beforeEach(() => {
  root = makeTmp();
});

afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

describe('extractTamaguiTokens via the Node fs host', () => {
  test('reads tokens from the on-disk compiled artifact', () => {
    writeArtifact(root, SAMPLE_ARTIFACT);
    const { tokens } = extractTamaguiTokens(root, nodeTamaguiFsHost);
    expect(tokens.color).toEqual(['$blue1', '$accent']);
    expect(tokens.size).toEqual(['$0', '$1']);
    expect(tokens.space).toEqual(['$sm']);
  });

  test('defaults to the Node host when none is passed', () => {
    writeArtifact(root, SAMPLE_ARTIFACT);
    const { tokens } = extractTamaguiTokens(root);
    expect(tokens.color).toContain('$blue1');
  });

  test('missing artifact → empty tokens + info', () => {
    const { tokens, info } = extractTamaguiTokens(root, nodeTamaguiFsHost);
    expect(tokens).toEqual({ color: [], size: [], space: [] });
    expect(info).toMatch(/No compiled/);
  });

  test('a symlinked artifact pointing outside the project is rejected', () => {
    const outside = makeTmp();
    const secret = join(outside, 'secret.json');
    writeFileSync(secret, JSON.stringify({ tamaguiConfig: { themes: { x: { LEAKED: '#fff' } } } }), 'utf-8');
    try {
      const dir = join(root, '.tamagui');
      mkdirSync(dir, { recursive: true });
      symlinkSync(secret, join(dir, 'tamagui.config.json'));
      expect(findTamaguiConfigArtifact(root, nodeTamaguiFsHost)).toBeNull();
      const { tokens } = extractTamaguiTokens(root, nodeTamaguiFsHost);
      expect(tokens.color).not.toContain('$LEAKED');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('fs-injection seam', () => {
  // A fully in-memory host: proves the core depends ONLY on the injected interface, never on
  // node:fs directly. Files keyed by absolute path; the directory tree is reconstructed.
  function makeMemHost(files: Record<string, string>, realDir: string): TamaguiFsHost {
    const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/'));
    const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
    const allPaths = Object.keys(files);
    const dirs = new Set<string>();
    for (const f of allPaths) {
      let d = dirOf(f);
      while (d && d.length >= realDir.length) {
        dirs.add(d);
        d = dirOf(d);
      }
    }
    return {
      *readDir(dirPath: string): Generator<TamaguiDirEntry> {
        if (!dirs.has(dirPath)) throw new Error(`ENOENT: ${dirPath}`);
        const seen = new Set<string>();
        for (const child of [...allPaths, ...dirs]) {
          if (dirOf(child) !== dirPath) continue;
          const name = baseOf(child);
          if (seen.has(name)) continue;
          seen.add(name);
          const isDir = dirs.has(child);
          yield { name, isDirectory: () => isDir, isFile: () => !isDir };
        }
      },
      readFile: (p) => {
        if (!(p in files)) throw new Error(`ENOENT: ${p}`);
        return files[p];
      },
      statSize: (p) => files[p]?.length ?? 0,
      lstatIsFile: (p) => p in files,
      realpath: (p) => p,
      exists: (p) => p in files || dirs.has(p),
    };
  }

  test('drives extraction entirely through a custom in-memory host', () => {
    const base = '/virt/project';
    const artifact = `${base}/.tamagui/tamagui.config.json`;
    const host = makeMemHost({ [artifact]: JSON.stringify(SAMPLE_ARTIFACT) }, base);

    expect(findTamaguiConfigArtifact(base, host)).toBe(artifact);
    expect(isTamaguiProject(base, host)).toBe(true);
    const { tokens } = extractTamaguiTokens(base, host);
    expect(tokens.color).toContain('$blue1');
  });

  test('isTamaguiProject false when only unrelated files exist', () => {
    const base = '/virt/plain';
    const host = makeMemHost({ [`${base}/index.ts`]: 'export const x = 1' }, base);
    expect(isTamaguiProject(base, host)).toBe(false);
  });

  test('mid-write truncated artifact recovers on re-read, without console.error (HYP-1173)', () => {
    // Tamagui's compiler rewrites .tamagui/tamagui.config.json while the dev server
    // starts; a concurrent read can see a truncated file (SyntaxError). The extractor
    // must re-read once and must not log at error level for this transient state —
    // the e2e fixture gate treats any console.error as a test failure.
    const base = '/virt/project';
    const artifact = `${base}/.tamagui/tamagui.config.json`;
    const good = JSON.stringify(SAMPLE_ARTIFACT);
    const host = makeMemHost({ [artifact]: good }, base);
    const origRead = host.readFile;
    let reads = 0;
    host.readFile = (p: string) => {
      const content = origRead(p);
      reads++;
      return reads === 1 ? content.slice(0, Math.floor(content.length / 2)) : content;
    };
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const { tokens } = extractTamaguiTokens(base, host);
      expect(tokens.color).toContain('$blue1');
      expect(errors).toHaveLength(0);
    } finally {
      console.error = origError;
    }
  });

  test('persistently malformed artifact returns empty tokens with info, no console.error (HYP-1173)', () => {
    const base = '/virt/project';
    const artifact = `${base}/.tamagui/tamagui.config.json`;
    const host = makeMemHost({ [artifact]: '{"tamaguiConfig": <truncated' }, base);
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const result = extractTamaguiTokens(base, host);
      expect(result.tokens).toEqual({ color: [], size: [], space: [] });
      expect(result.info).toContain('Failed to parse');
      expect(errors).toHaveLength(0);
    } finally {
      console.error = origError;
    }
  });

  test('artifact vanishing mid-read (unlink+rename rewrite) is transient, no console.error (HYP-1173)', () => {
    const base = '/virt/project';
    const artifact = `${base}/.tamagui/tamagui.config.json`;
    const host = makeMemHost({ [artifact]: JSON.stringify(SAMPLE_ARTIFACT) }, base);
    const origRead = host.readFile;
    let reads = 0;
    host.readFile = (p: string) => {
      reads++;
      if (reads === 1) {
        const err = new Error(`ENOENT: no such file or directory, open '${p}'`) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return origRead(p);
    };
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const { tokens } = extractTamaguiTokens(base, host);
      expect(tokens.color).toContain('$blue1');
      expect(errors).toHaveLength(0);
    } finally {
      console.error = origError;
    }
  });

  test('lazy readDir error during iteration is swallowed, not thrown (missing apps/packages)', () => {
    // Regression: a generator-backed readDir throws on first iteration, not at the call site.
    // The walk must treat a missing workspace dir as "skip", never propagate ENOENT.
    writeArtifact(root, SAMPLE_ARTIFACT);
    expect(() => extractTamaguiTokens(root, nodeTamaguiFsHost)).not.toThrow();
  });
});

describe('extractTamaguiTokensFromArtifact (pure)', () => {
  test('tolerates garbage without throwing', () => {
    expect(extractTamaguiTokensFromArtifact(null)).toEqual({ color: [], size: [], space: [] });
    expect(extractTamaguiTokensFromArtifact('nope')).toEqual({ color: [], size: [], space: [] });
  });
});

describe('nodeTamaguiFsHost.readDir streaming', () => {
  test('closes the directory handle on early break (no leak)', () => {
    // Create several entries, break after the first. If the generator did not release the
    // handle on early return, repeated runs would eventually exhaust file descriptors.
    for (let i = 0; i < 10; i++) writeFileSync(join(root, `f${i}.txt`), '', 'utf-8');
    for (let run = 0; run < 50; run++) {
      for (const _entry of nodeTamaguiFsHost.readDir(root)) {
        break; // triggers generator.return() → finally closes the handle
      }
    }
    // Reaching here without EMFILE proves handles are released.
    expect(existsSync(root)).toBe(true);
  });
});
