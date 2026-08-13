import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OverlayCSSVarName, OverlayCSSVars, OverlayStyle } from '../theme';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const SAAS_CSS = join(REPO_ROOT, 'client', 'global.css');
const EXT_CSS = join(REPO_ROOT, 'vscode-extension', 'hypercanvas-preview', 'src', 'webview', 'styles.css');

const REQUIRED_VARS: readonly OverlayCSSVarName[] = [
  '--overlay-bg',
  '--overlay-fg',
  '--overlay-muted',
  '--overlay-border',
  '--overlay-accent',
  '--overlay-accent-fg',
  '--overlay-destructive',
  '--overlay-link',
  '--overlay-input-bg',
  '--overlay-input-fg',
  '--overlay-input-border',
  '--overlay-surface',
  '--overlay-warning',
  '--overlay-font',
  '--overlay-font-mono',
  '--overlay-backdrop',
  '--overlay-codeframe-bg',
  '--overlay-badge-supported',
  '--overlay-badge-planned',
];

describe('overlay theme', () => {
  it('OverlayStyle type accepts overlay vars and standard CSSProperties', () => {
    // Compile-time check: this would fail typecheck if the types were wrong.
    const style: OverlayStyle = {
      '--overlay-bg': 'red',
      background: 'blue',
      color: 'white',
    };
    // Sanity runtime assertion
    expect(style['--overlay-bg']).toBe('red');
    // OverlayCSSVars as a subtype
    const vars: OverlayCSSVars = { '--overlay-fg': 'black' };
    expect(vars['--overlay-fg']).toBe('black');
  });

  it('SaaS global.css defines every overlay CSS var', () => {
    const css = readFileSync(SAAS_CSS, 'utf8');
    for (const name of REQUIRED_VARS) {
      expect(css).toContain(`${name}:`);
    }
  });

  it('extension webview styles.css defines every overlay CSS var', () => {
    const css = readFileSync(EXT_CSS, 'utf8');
    for (const name of REQUIRED_VARS) {
      expect(css).toContain(`${name}:`);
    }
  });
});
