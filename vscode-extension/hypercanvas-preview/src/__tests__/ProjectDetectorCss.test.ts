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

describe('computeCapabilities — chakra is readonly', () => {
  it('chakra → not writable → readonly when renderable', () => {
    const caps = computeCapabilities('chakra', 'none', null, 'vite', 'simple');
    expect(caps.canWriteStyles).toBe(false);
    expect(caps.canRender).toBe(true);
    expect(caps.readonly).toBe(true);
  });

  it('emotion → writable → not readonly (guard)', () => {
    const caps = computeCapabilities('emotion', 'none', null, 'vite', 'simple');
    expect(caps.canWriteStyles).toBe(true);
    expect(caps.readonly).toBe(false);
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
