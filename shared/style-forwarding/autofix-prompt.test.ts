/**
 * @file HYP-990 M2 — unit tests for buildStyleAutoFixPrompt: the shared "Auto fix via AI" prompt
 * must lead with the STRUCTURED diagnosis (reason, component, definition/call-site, edited props) and
 * instruct the inspect → propose → ask/cancel flow, so the AI never silently auto-applies.
 */
import { describe, expect, it } from 'bun:test';
import type { StyleForwardingWarning } from '../types/style-forwarding-warning';
import { buildStyleAutoFixPrompt } from './autofix-prompt';

const fullWarning: StyleForwardingWarning = {
  componentName: 'HostRoutePage',
  shortMessage: "Style could not be applied — <HostRoutePage> doesn't forward this prop to the DOM.",
  message: 'generic fallback message',
  diagnosis: {
    reason: 'wrap-not-visible',
    componentName: 'HostRoutePage',
    editedProperties: ['backgroundColor'],
    componentDefinition: { filePath: 'src/ui/HostRoutePage.tsx', line: 12 },
    callSite: { filePath: 'src/app/OrgSettingsPage.tsx', line: 5 },
  },
};

describe('buildStyleAutoFixPrompt', () => {
  it('seeds the diagnosis facts and the two-step inspect/propose flow', () => {
    const prompt = buildStyleAutoFixPrompt(fullWarning, { componentPath: 'src/app/OrgSettingsPage.tsx' });
    expect(prompt).toContain('HostRoutePage');
    expect(prompt).toContain('used in src/app/OrgSettingsPage.tsx');
    // The wrap-not-visible reason summary (opaque cover), not the generic message.
    expect(prompt).toContain('opaque root or background-image');
    expect(prompt).toContain('Edited CSS properties: backgroundColor.');
    expect(prompt).toContain('src/ui/HostRoutePage.tsx:12');
    expect(prompt).toContain('src/app/OrgSettingsPage.tsx:5');
    // Structured flow: inspect, propose-and-ask, and an explicit no-auto-apply guard.
    expect(prompt).toContain('1. INSPECT');
    expect(prompt).toContain('2. PROPOSE');
    expect(prompt).toContain('ASK me to confirm');
    expect(prompt).toContain('offer to leave the edit reverted');
    expect(prompt).toContain('Do NOT apply any change until I confirm');
  });

  it('falls back to the human message when no structured diagnosis is present', () => {
    const prompt = buildStyleAutoFixPrompt({
      componentName: 'Widget',
      shortMessage: 'short',
      message: 'could not be applied',
    });
    expect(prompt).toContain('Widget');
    expect(prompt).toContain('Detected reason: could not be applied');
    // Still instructs the inspect → propose → confirm flow.
    expect(prompt).toContain('1. INSPECT');
    expect(prompt).toContain('Do NOT apply any change until I confirm');
  });

  it('summarizes each reason distinctly', () => {
    const base = { componentName: 'C', shortMessage: 's', message: 'm' };
    const forNotForward = buildStyleAutoFixPrompt({
      ...base,
      diagnosis: { reason: 'component-does-not-forward', componentName: 'C', editedProperties: [] },
    });
    const forPseudo = buildStyleAutoFixPrompt({
      ...base,
      diagnosis: { reason: 'pseudo-state-not-wrappable', componentName: 'C', editedProperties: [] },
    });
    expect(forNotForward).toContain('does not forward');
    expect(forPseudo).toContain('pseudo-state');
  });

  it('uses the structured call site (not the previewed componentPath) for "used in" on a cross-file edit', () => {
    // The nodeRef resolved the call site to Child.tsx, but the currently-previewed component is
    // App.tsx. The prompt must not say "used in App.tsx" then "attempted at Child.tsx" (codex).
    const prompt = buildStyleAutoFixPrompt(
      {
        componentName: 'Widget',
        shortMessage: 's',
        message: 'm',
        diagnosis: {
          reason: 'component-does-not-forward',
          componentName: 'Widget',
          editedProperties: [],
          callSite: { filePath: 'src/Child.tsx', line: 7 },
        },
      },
      { componentPath: 'src/App.tsx' },
    );
    expect(prompt).toContain('used in src/Child.tsx');
    expect(prompt).not.toContain('used in src/App.tsx');
    expect(prompt).toContain('attempted at: src/Child.tsx:7');
  });

  it('a kept-unverified warning does NOT claim the edit was reverted (codex full panel)', () => {
    const prompt = buildStyleAutoFixPrompt({
      componentName: 'Icon',
      kept: true,
      shortMessage: "Style applied to <Icon>, but could not verify it's visible.",
      message: 'applied but unverified',
      diagnosis: { reason: 'kept-unverified', componentName: 'Icon', editedProperties: ['color'] },
    });
    expect(prompt).toContain('was applied to `<Icon>`');
    expect(prompt).toContain("couldn't verify it's actually visible");
    expect(prompt).not.toContain('reverted it');
    // The closing offer is keep-or-remove, not "leave reverted".
    expect(prompt).toContain('leave the wrapper as-is or remove it');
    expect(prompt).not.toContain('leave the edit reverted');
  });
});
