import { describe, expect, it, mock } from 'bun:test';
import type { SupportDimension } from '../../types';

const fsFiles = new Map<string, string>();

mock.module('node:fs/promises', () => ({
  readFile: async (p: string) => {
    const content = fsFiles.get(p);
    if (content === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return content;
  },
  access: async (p: string) => {
    if (!fsFiles.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  },
  readdir: async (p: string) => {
    const prefix = p.endsWith('/') ? p : `${p}/`;
    const entries = new Set<string>();
    for (const key of fsFiles.keys()) {
      if (key.startsWith(prefix)) {
        const segment = key.slice(prefix.length).split('/')[0];
        if (segment) entries.add(segment);
      }
    }
    return [...entries];
  },
}));

function setup(files: Record<string, string>) {
  fsFiles.clear();
  for (const [p, content] of Object.entries(files)) fsFiles.set(p, content);
}

const { gatherSupportDimensions, detectFrameworkRenderKind, computeSupportDimensionsForRoot } =
  await import('../support-dimensions-detect');

function dim(dims: SupportDimension[], id: SupportDimension['id']): SupportDimension {
  const d = dims.find((x) => x.id === id);
  if (!d) throw new Error(`no dimension ${id}`);
  return d;
}

const ROOT = '/ws';

describe('gatherSupportDimensions — active (sub-)repo facts', () => {
  it('Vue member → framework unsupported (render gate), per the member package.json', async () => {
    const pkg = { dependencies: { vue: '^3', vite: '^5' } };
    const dims = await gatherSupportDimensions(`${ROOT}/apps/vue`, pkg, {
      projectType: 'vite',
      projectError: null,
      packageManager: 'npm',
    });
    expect(dim(dims, 'framework').status).toBe('unsupported');
    expect(dim(dims, 'framework').reason).toBe('Vue.js projects not supported');
  });

  it('reuses the host react-native projectError for the needs-setup gate (no divergence)', async () => {
    const pkg = { dependencies: { 'react-native': '^0.74', react: '^19' } };
    const dims = await gatherSupportDimensions(`${ROOT}/apps/native`, pkg, {
      projectType: 'vite',
      projectError: {
        type: 'react-native',
        message: 'React Native projects need react-native-web and a Vite config to render in a browser.',
        fixLabel: 'Fix: Add react-native-web + Vite config',
      },
      packageManager: 'npm',
    });
    expect(dim(dims, 'framework').status).toBe('needs-setup');
    expect(dim(dims, 'framework').fixLabel).toBe('Fix: Add react-native-web + Vite config');
  });

  it('uses the per-member CSS set so a tailwind+emotion app is non-blocking (HYP-787)', async () => {
    // HYP-787: per-member CSS detection prevents a sibling package's emotion dep from
    // forcing a tailwind-only app into inspect-only. tailwind+emotion → inspect-only
    // (emotion has no write adapter per HYP-796), but inspect-only is NOT a blocking
    // tab — the preview and canvas still work. The test guards non-blocking, not
    // specifically 'supported' vs 'inspect-only'.
    const pkg = { dependencies: { react: '^19', tailwindcss: '^3', '@emotion/react': '^11' } };
    const dims = await gatherSupportDimensions(`${ROOT}/apps/web`, pkg, {
      projectType: 'vite',
      projectError: null,
      packageManager: 'pnpm',
    });
    // emotion is inspect-only (CSS-in-JS, no write adapter); non-blocking either way.
    expect(['supported', 'inspect-only']).toContain(dim(dims, 'styleSystem').status);
    // Must NOT produce a blocking tab (unsupported / needs-setup).
    expect(dim(dims, 'styleSystem').status).not.toBe('unsupported');
    expect(dim(dims, 'styleSystem').status).not.toBe('needs-setup');
  });

  it('detectFrameworkRenderKind falls back to source scan when no react dep (none vs react)', async () => {
    setup({ [`${ROOT}/lib/package.json`]: JSON.stringify({ dependencies: {} }) });
    expect(await detectFrameworkRenderKind(`${ROOT}/lib`, { dependencies: {} })).toBe('none');

    setup({ [`${ROOT}/lib/src/Widget.tsx`]: 'export const W = () => null;' });
    expect(await detectFrameworkRenderKind(`${ROOT}/lib`, { dependencies: {} })).toBe('react');
  });
});

describe('computeSupportDimensionsForRoot — detects primitives itself for a root', () => {
  it('a Vue project → framework unsupported (a blocking tab)', async () => {
    setup({ [`${ROOT}/app/package.json`]: JSON.stringify({ dependencies: { vue: '^3', vite: '^5' } }) });
    const dims = await computeSupportDimensionsForRoot(`${ROOT}/app`);
    expect(dim(dims, 'framework').status).toBe('unsupported');
    expect(dim(dims, 'framework').reason).toBe('Vue.js projects not supported');
  });

  // The codex P1 premise: once react-native-web is installed (detectUnsupportedProject
  // returns null), the framework dimension is SUPPORTED — so re-posting these after the
  // fix clears the stale needs-setup tab.
  it('react-native WITH react-native-web → framework supported (post-fix state, no tab)', async () => {
    setup({
      [`${ROOT}/native/package.json`]: JSON.stringify({
        dependencies: { react: '^19', 'react-native': '^0.74', 'react-native-web': '^0.19', vite: '^5' },
      }),
    });
    const dims = await computeSupportDimensionsForRoot(`${ROOT}/native`);
    expect(dim(dims, 'framework').status).toBe('supported');
    expect(dim(dims, 'bundler').status).toBe('supported');
  });
});
