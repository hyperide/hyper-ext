import { describe, expect, it } from 'bun:test';

// detectCssSystem and detectUIKit accept an optional pre-parsed packageJson — no fs mocking needed
const { detectCssSystem, detectUIKit, computeCapabilities } = await import('../services/ProjectDetector');

describe('detectCssSystem — Astro Tailwind', () => {
  const DIR = '/irrelevant';

  it('detects @astrojs/tailwind as tailwind', async () => {
    expect(await detectCssSystem(DIR, { devDependencies: { '@astrojs/tailwind': '^5.0.0' } })).toBe('tailwind');
  });

  it('detects @tailwindcss/vite as tailwind', async () => {
    expect(await detectCssSystem(DIR, { devDependencies: { '@tailwindcss/vite': '^4.0.0' } })).toBe('tailwind');
  });

  it('both astro integrations together still return tailwind', async () => {
    expect(
      await detectCssSystem(DIR, {
        devDependencies: { '@astrojs/tailwind': '^5.0.0', '@tailwindcss/vite': '^4.0.0' },
      }),
    ).toBe('tailwind');
  });

  it('bare tailwindcss still works', async () => {
    expect(await detectCssSystem(DIR, { devDependencies: { tailwindcss: '^3.0.0' } })).toBe('tailwind');
  });

  it('shadcn wins over @astrojs/tailwind', async () => {
    expect(
      await detectCssSystem(DIR, {
        devDependencies: { '@astrojs/tailwind': '^5.0.0', 'class-variance-authority': '^0.7.0' },
      }),
    ).toBe('shadcn');
  });
});

describe('detectCssSystem — Chakra UI vs emotion', () => {
  const DIR = '/irrelevant';

  it('detects @chakra-ui/react as chakra even when @emotion/react is present (chakra v3 brings emotion internally)', async () => {
    // Regression: chakra v3 declares @emotion/react + @emotion/styled as deps.
    // Without an explicit chakra-before-emotion check, the bare emotion branch
    // shadows it and the project is misclassified as writable 'emotion'.
    expect(
      await detectCssSystem(DIR, {
        dependencies: {
          '@chakra-ui/react': '^3.34.0',
          '@emotion/react': '^11.14.0',
          '@emotion/styled': '^11.14.0',
        },
      }),
    ).toBe('chakra');
  });

  it('detects @chakra-ui/react as chakra with no emotion dep listed', async () => {
    expect(await detectCssSystem(DIR, { dependencies: { '@chakra-ui/react': '^3.34.0' } })).toBe('chakra');
  });

  it('pure emotion (no chakra) still detects as emotion', async () => {
    // Guard: the chakra precedence must NOT swallow genuine emotion projects.
    expect(await detectCssSystem(DIR, { dependencies: { '@emotion/react': '^11.14.0' } })).toBe('emotion');
    expect(await detectCssSystem(DIR, { dependencies: { '@emotion/styled': '^11.14.0' } })).toBe('emotion');
  });

  it('MUI keeps its current classification (unchanged by the chakra fix)', async () => {
    // MUI alone → 'mui'. MUI + emotion → 'emotion' (emotion check precedes the
    // mui branch; this is pre-existing behavior the fix must not disturb).
    expect(await detectCssSystem(DIR, { dependencies: { '@mui/material': '^5.0.0' } })).toBe('mui');
    expect(
      await detectCssSystem(DIR, { dependencies: { '@mui/material': '^5.0.0', '@emotion/react': '^11.14.0' } }),
    ).toBe('emotion');
  });
});

// HYP-796 (Phase A2): the writable gate is REGISTRY-DERIVED — a CssSystem is writable iff it maps to
// a CssSystemId with a real native (non-fallback) writer in the adapter registry (spec §3.3 / D31).
// Before this, emotion + styled-components were hand-listed writable with NO adapter: an emotion edit
// silently polluted the file with a foreign inline `style={{}}` write, and a styled-components edit
// dead-ended at the executor's `unsupported()` no-op. The gate now reports them honest-readonly.
describe('computeCapabilities — registry-derived writable gate (HYP-796)', () => {
  // Systems with NO native writer adapter → readonly (no inline pollution, no unsupported() throw).
  const READONLY_SYSTEMS = [
    'emotion', // was the silent-inline-pollution bug
    'styled-components', // was the unsupported() dead-click bug
    'chakra',
    'mantine',
    'mui',
    'vanilla-extract',
    'sass', // plain-css: no writer adapter
    'pandacss',
    'unocss',
    'stylex',
    'antd',
    'fluentui',
    'nextui',
  ] as const;

  for (const css of READONLY_SYSTEMS) {
    it(`${css} → no native writer → readonly when renderable`, () => {
      const caps = computeCapabilities(css, 'none', null, 'vite', 'simple');
      expect(caps.canWriteStyles).toBe(false);
      expect(caps.canRender).toBe(true);
      expect(caps.readonly).toBe(true);
    });
  }

  it('emotion specifically: NOT writable (the silent-inline-pollution lie is gone)', () => {
    const caps = computeCapabilities('emotion', 'none', null, 'vite', 'simple');
    expect(caps.canWriteStyles).toBe(false);
    expect(caps.readonly).toBe(true);
  });

  it('styled-components specifically: NOT writable (the unsupported() dead-click is gone)', () => {
    const caps = computeCapabilities('styled-components', 'none', null, 'vite', 'simple');
    expect(caps.canWriteStyles).toBe(false);
    expect(caps.readonly).toBe(true);
  });

  // Systems genuinely backed by a registered writer stay writable (no regression).
  const WRITABLE_SYSTEMS = [
    'tailwind', // tailwind-v4 writer
    'cssmodules', // css-modules writer
    'tamagui', // tamagui writer
    'shadcn', // built on Tailwind → tailwind-v4 writer
    'daisyui', // built on Tailwind → tailwind-v4 writer
  ] as const;

  for (const css of WRITABLE_SYSTEMS) {
    it(`${css} → backed by a registered writer → writable, not readonly`, () => {
      const caps = computeCapabilities(css, 'none', null, 'vite', 'simple');
      expect(caps.canWriteStyles).toBe(true);
      expect(caps.readonly).toBe(false);
    });
  }
});

// HYP-1171: the readonly stub copy must name the gate that actually failed —
// css (no native writer) vs bundler (not full-edit capable) vs both. Before this
// field the stub always blamed the bundler, telling vite+emotion users "Vite does
// not support... use Vite"; a copy fix that always blamed the CSS system was
// equally wrong for remix+tailwind (review P2). readonlyReason makes the stub
// honest for every combination.
describe('computeCapabilities — readonlyReason names the failing gate (HYP-1171)', () => {
  it('emotion + vite → css (the CSS system has no writer; bundler is full-edit)', () => {
    const caps = computeCapabilities('emotion', 'none', null, 'vite', 'simple');
    expect(caps.readonly).toBe(true);
    expect(caps.readonlyReason).toBe('css');
  });

  it('tailwind + remix → bundler (CSS is writable; remix is not full-edit)', () => {
    const caps = computeCapabilities('tailwind', 'none', null, 'remix', 'simple');
    expect(caps.readonly).toBe(true);
    expect(caps.readonlyReason).toBe('bundler');
  });

  it('emotion + remix → both (neither gate passes)', () => {
    const caps = computeCapabilities('emotion', 'none', null, 'remix', 'simple');
    expect(caps.readonly).toBe(true);
    expect(caps.readonlyReason).toBe('both');
  });

  it('writable project → no readonlyReason', () => {
    const caps = computeCapabilities('tailwind', 'none', null, 'vite', 'simple');
    expect(caps.readonly).toBe(false);
    expect(caps.readonlyReason).toBeUndefined();
  });

  it('project that cannot render → not readonly, no readonlyReason', () => {
    const caps = computeCapabilities('emotion', 'none', { type: 'react-native', message: 'rn' }, 'vite', 'simple');
    expect(caps.readonly).toBe(false);
    expect(caps.readonlyReason).toBeUndefined();
  });
});

describe('detectUIKit — Astro Tailwind', () => {
  const DIR = '/irrelevant';

  it('detects @astrojs/tailwind as tailwind', async () => {
    expect(await detectUIKit(DIR, { devDependencies: { '@astrojs/tailwind': '^5.0.0' } })).toBe('tailwind');
  });

  it('detects @tailwindcss/vite as tailwind', async () => {
    expect(await detectUIKit(DIR, { devDependencies: { '@tailwindcss/vite': '^4.0.0' } })).toBe('tailwind');
  });

  it('bare tailwindcss still works', async () => {
    expect(await detectUIKit(DIR, { devDependencies: { tailwindcss: '^3.0.0' } })).toBe('tailwind');
  });

  it('tamagui takes precedence', async () => {
    expect(await detectUIKit(DIR, { devDependencies: { '@astrojs/tailwind': '^5.0.0', tamagui: '^1.0.0' } })).toBe(
      'tamagui',
    );
  });

  it('returns none when no tailwind or tamagui', async () => {
    expect(await detectUIKit(DIR, { devDependencies: { react: '^19.0.0' } })).toBe('none');
  });
});
