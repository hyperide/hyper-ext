import { describe, expect, it } from 'bun:test';
import { buildFrameworkInstructions } from '../framework-instructions';
import type { DetectionResult } from '../framework-routing';

// buildFrameworkInstructions was moved out of server/routes/parseComponent.ts so BOTH the server
// and the VS Code extension (HYP-795) share one source of framework-specific sample instructions.
// These tests pin the framework -> instruction mapping independent of filesystem detection.
describe('buildFrameworkInstructions', () => {
  const make = (framework: DetectionResult['framework']): DetectionResult => ({ framework });

  it('emits Next.js App Router params guidance', () => {
    const out = buildFrameworkInstructions(make('nextjs-app-router'));
    expect(out).toContain('**PROJECT FRAMEWORK**: Next.js App Router');
    expect(out).toContain('searchParams');
    expect(out).toContain('DO NOT use react-router-dom');
  });

  it('emits Next.js Pages Router (incl. Solito RouterContext) guidance', () => {
    const out = buildFrameworkInstructions(make('nextjs-pages-router'));
    expect(out).toContain('**PROJECT FRAMEWORK**: Next.js Pages Router');
    expect(out).toContain('Solito');
    expect(out).toContain('RouterContext');
  });

  it('emits Remix loader-params guidance', () => {
    const out = buildFrameworkInstructions(make('remix'));
    expect(out).toContain('**PROJECT FRAMEWORK**: Remix');
    expect(out).toContain('params');
  });

  it('emits React Router (MemoryRouter) guidance for vite SPA variants', () => {
    for (const fw of ['vite-spa-jsx-router', 'vite-spa-file-based'] as const) {
      const out = buildFrameworkInstructions(make(fw));
      expect(out).toContain('**PROJECT FRAMEWORK**: React Router');
      expect(out).toContain('MemoryRouter');
    }
  });

  it('emits the no-framework default for webpack/parcel/unknown', () => {
    for (const fw of ['webpack', 'parcel', 'unknown'] as const) {
      const out = buildFrameworkInstructions(make(fw));
      expect(out).toContain('No routing framework detected');
    }
  });

  it('always appends the routing examples (A-G), regardless of framework', () => {
    const out = buildFrameworkInstructions(make('unknown'));
    expect(out).toContain('**Example A - React Router');
    expect(out).toContain('**Example E - Toast/Notification component**');
    expect(out).toContain('**Example G - Provider component**');
  });
});
