import { describe, expect, it } from 'bun:test';
import type { CssSystem, ProjectType, SupportDimension } from '../../types';
import {
  classifySupportDimensions,
  overallSupportStatus,
  selectDimensionTabs,
  type SupportFacts,
} from '../support-dimensions';

function facts(over: Partial<SupportFacts> = {}): SupportFacts {
  return {
    frameworkGate: { kind: 'react' },
    bundler: 'vite' as ProjectType,
    cssSystems: ['tailwind'] as CssSystem[],
    packageManager: 'npm',
    ...over,
  };
}

function dim(dims: SupportDimension[], id: SupportDimension['id']): SupportDimension {
  const d = dims.find((x) => x.id === id);
  if (!d) throw new Error(`no dimension ${id}`);
  return d;
}

describe('classifySupportDimensions — always returns all five dimensions', () => {
  it('produces framework, bundler, styleSystem, router, packageManager', () => {
    const dims = classifySupportDimensions(facts());
    expect(dims.map((d) => d.id).sort()).toEqual(
      ['bundler', 'framework', 'packageManager', 'router', 'styleSystem'].sort(),
    );
  });
});

describe('framework dimension (render gate)', () => {
  it('Vue → unsupported with the exact spec reason', () => {
    const d = dim(classifySupportDimensions(facts({ frameworkGate: { kind: 'vue' } })), 'framework');
    expect(d.status).toBe('unsupported');
    expect(d.reason).toBe('Vue.js projects not supported');
    expect(d.evidence.length).toBeGreaterThan(0);
  });

  it('Svelte and Angular use their exact reasons', () => {
    expect(dim(classifySupportDimensions(facts({ frameworkGate: { kind: 'svelte' } })), 'framework').reason).toBe(
      'Svelte projects not supported',
    );
    expect(dim(classifySupportDimensions(facts({ frameworkGate: { kind: 'angular' } })), 'framework').reason).toBe(
      'Angular projects not supported',
    );
  });

  it('no React → unsupported "No React components found"', () => {
    const d = dim(classifySupportDimensions(facts({ frameworkGate: { kind: 'none' } })), 'framework');
    expect(d.status).toBe('unsupported');
    expect(d.reason).toBe('No React components found');
  });

  it('react-native without react-native-web → needs-setup with fix label', () => {
    const d = dim(
      classifySupportDimensions(
        facts({
          frameworkGate: {
            kind: 'react-native',
            message: 'React Native projects need react-native-web and a Vite config to render in a browser.',
            fixLabel: 'Fix: Add react-native-web + Vite config',
          },
        }),
      ),
      'framework',
    );
    expect(d.status).toBe('needs-setup');
    expect(d.fixLabel).toBe('Fix: Add react-native-web + Vite config');
  });

  it('plain react → supported', () => {
    expect(dim(classifySupportDimensions(facts()), 'framework').status).toBe('supported');
  });
});

describe('bundler dimension', () => {
  it.each(['vite', 'cra', 'webpack', 'nextjs', 'bun', 'remix'] as ProjectType[])('%s → supported', (bundler) => {
    expect(dim(classifySupportDimensions(facts({ bundler })), 'bundler').status).toBe('supported');
  });

  it('unknown bundler → unsupported with the exact spec reason', () => {
    const d = dim(classifySupportDimensions(facts({ bundler: 'unknown' })), 'bundler');
    expect(d.status).toBe('unsupported');
    expect(d.reason).toBe('HyperIDE could not detect a supported framework in this project.');
  });
});

describe('styleSystem dimension (EDIT gate, never a hard unsupported)', () => {
  it('pure editable set (tailwind only) → supported', () => {
    expect(dim(classifySupportDimensions(facts({ cssSystems: ['tailwind'] })), 'styleSystem').status).toBe('supported');
  });

  it('emotion (CSS-in-JS, no write adapter post-HYP-796) → inspect-only, NOT supported', () => {
    // emotion was formerly in WRITABLE_CSS_SYSTEMS but has no native write adapter (HYP-796).
    // Per standing product directive CSS-in-JS must be inspect-only, never unsupported.
    expect(dim(classifySupportDimensions(facts({ cssSystems: ['emotion'] })), 'styleSystem').status).toBe(
      'inspect-only',
    );
  });

  it('tailwind + emotion → inspect-only (inspect-only wins when mixed with editable)', () => {
    // Any inspect-only system in the set makes the whole dimension inspect-only.
    expect(dim(classifySupportDimensions(facts({ cssSystems: ['tailwind', 'emotion'] })), 'styleSystem').status).toBe(
      'inspect-only',
    );
  });

  it('CSS-in-JS (chakra) → inspect-only, NOT unsupported', () => {
    const d = dim(classifySupportDimensions(facts({ cssSystems: ['chakra'] })), 'styleSystem');
    expect(d.status).toBe('inspect-only');
  });

  it('mixed editable + inspect-only (tailwind + chakra) → inspect-only (never unsupported)', () => {
    const d = dim(classifySupportDimensions(facts({ cssSystems: ['tailwind', 'chakra'] })), 'styleSystem');
    expect(d.status).toBe('inspect-only');
  });

  it('no css system → unknown (not a hard block)', () => {
    expect(dim(classifySupportDimensions(facts({ cssSystems: [] })), 'styleSystem').status).toBe('unknown');
  });
});

describe('selectDimensionTabs — only blocking dimensions become tabs', () => {
  it('a fully-supported project yields zero tabs', () => {
    expect(selectDimensionTabs(classifySupportDimensions(facts()))).toEqual([]);
  });

  it('inspect-only style system does NOT create a tab', () => {
    const tabs = selectDimensionTabs(classifySupportDimensions(facts({ cssSystems: ['chakra'] })));
    expect(tabs.find((t) => t.id === 'styleSystem')).toBeUndefined();
  });

  it('a Vue + unknown-bundler project yields exactly the framework and bundler tabs', () => {
    const tabs = selectDimensionTabs(
      classifySupportDimensions(facts({ frameworkGate: { kind: 'vue' }, bundler: 'unknown' })),
    );
    expect(tabs.map((t) => t.id).sort()).toEqual(['bundler', 'framework']);
  });
});

describe('overallSupportStatus — worst wins', () => {
  it('all supported → supported', () => {
    expect(overallSupportStatus(classifySupportDimensions(facts()))).toBe('supported');
  });

  it('one unsupported dimension → unsupported overall', () => {
    expect(overallSupportStatus(classifySupportDimensions(facts({ frameworkGate: { kind: 'vue' } })))).toBe(
      'unsupported',
    );
  });

  it('inspect-only (no hard block) → inspect-only overall', () => {
    expect(overallSupportStatus(classifySupportDimensions(facts({ cssSystems: ['chakra'] })))).toBe('inspect-only');
  });
});
