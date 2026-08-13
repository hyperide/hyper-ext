import { describe, expect, it } from 'bun:test';

// detectCssSystem accepts an optional pre-parsed packageJson — no fs mocking needed
const { detectCssSystem } = await import('../services/ProjectDetector');

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
