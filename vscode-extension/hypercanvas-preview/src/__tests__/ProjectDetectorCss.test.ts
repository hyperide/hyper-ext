import { describe, expect, it } from 'bun:test';

// detectCssSystem and detectUIKit accept an optional pre-parsed packageJson — no fs mocking needed
const { detectCssSystem, detectUIKit } = await import('../services/ProjectDetector');

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
