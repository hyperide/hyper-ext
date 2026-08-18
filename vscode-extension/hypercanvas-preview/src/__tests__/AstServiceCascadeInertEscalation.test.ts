/**
 * @file HYP-1162 cascade-inert utility escalation — regression tests.
 *
 * Root cause (live-verified on conloca, 2026-08-01): a dev server whose stylesheets wrap the
 * Tailwind preflight inside a nested cascade layer that OUTRANKS the top-level `utilities`
 * layer (conloca's cms-spa main.css declares `@layer …, utilities, cms-admin, …` then nests
 * the whole Tailwind stack — preflight included — inside `@layer cms-admin`) makes every
 * NEWLY WRITTEN utility class cascade-inert: `* { padding: 0 }` in `cms-admin.base` beats
 * `.px-\[28px\]` in the top-level `utilities` layer. The full HMR round-trip works (vite
 * pushes the css-update, the iframe swaps the stylesheet, the DOM class appears) — the rule
 * just never wins the cascade, so the computed style never changes and the write looks dead.
 *
 * The product must cope on real-world configs: after a direct class write, when the live
 * preview verify PROVES the computed style did not change, escalate the same edit to an
 * inline `style={{…}}` override on the element (inline beats all cascade layers), exactly the
 * redirect style-write-executor already applies for inline/var/module-driven color writes.
 *
 * Separate file for the same reason as AstServiceStyleWriteHyp901.test.ts (happy-dom/bun:test
 * state leakage between siblings; see that file's header).
 *
 * Accessed via: VS Code inspector style write on a native element in a Tailwind project,
 * routed through AstService.updateStyles → writeDirectCandidate.
 */
import { describe, expect, it } from 'bun:test';
import { NodeMapService } from '@lib/element-tracing/node-map-service';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import { AstService } from '../services/AstService';

function h2RefFor(source: string, relativePath: string): string {
  const helper = new NodeMapService();
  const entries = helper.parseAndBuild(source, relativePath);
  const h2Line = source.split('\n').findIndex((l) => l.includes('<h2')) + 1;
  const entry = entries.find((e) => e.loc.line === h2Line) ?? entries[0];
  return `${relativePath}:${entry.loc.line}:${entry.loc.column}`;
}

const PAGE_PATH = '/workspace/src/app/org-settings/OrgSettingsPage.tsx';
const PAGE_SOURCE = `export function SettingsSection() {
  return (
    <section>
      <h2 className="text-base font-semibold">Git identity</h2>
    </section>
  );
}
`;

function tailwindService(fileIO: InMemoryFileIO): AstService {
  const service = new AstService('/workspace', fileIO);
  service.setProjectDefaultCssSystem('tailwind');
  // Real poll budget (4 × 300ms per verify) makes the multi-updateStyles tests
  // exceed the 5s default test timeout on CI — shrink it, keep the polling.
  service.setVerifyPollBudget({ delayMs: 1, maxAttempts: 4 });
  return service;
}

describe('AstService HYP-1162 cascade-inert utility escalation', () => {
  it('escalates to an inline style override when the class write provably does not change the computed style', async () => {
    const fileIO = new InMemoryFileIO({ [PAGE_PATH]: PAGE_SOURCE });
    const service = tailwindService(fileIO);
    // Simulate the cascade-inert stylesheet: computed padding NEVER changes no matter what
    // lands on disk (the class loses to the nested-layer preflight).
    service.setVerifyComputedStyleProvider(async () => ({ paddingLeft: '0px', paddingRight: '0px' }));
    const nodeRef = h2RefFor(PAGE_SOURCE, 'src/app/org-settings/OrgSettingsPage.tsx');

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { paddingLeft: '28', paddingRight: '28' },
      undefined,
      nodeRef,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    const written = fileIO.content(PAGE_PATH);
    // The escalation must put an inline style on the element — the only write that beats an
    // arbitrarily hostile cascade-layer stack.
    expect(written).toContain('style={{');
    expect(written).toContain('paddingLeft: "28px"');
    expect(written).toContain('paddingRight: "28px"');
    // The escalation whole-file reprints (plain @babel/generator — recast corrupts this mutation
    // shape; see ast-update-utils.ts). The element structure must survive the reprint intact.
    expect(written).toContain('</section>');
    expect(written).toContain('</h2>');
  });

  it('does NOT escalate when the verify proves the class write landed', async () => {
    const fileIO = new InMemoryFileIO({ [PAGE_PATH]: PAGE_SOURCE });
    const service = tailwindService(fileIO);
    // Simulate a healthy stylesheet: before-snapshot 0px, after-write polls 28px.
    let calls = 0;
    service.setVerifyComputedStyleProvider(async () => {
      calls += 1;
      const landed = calls > 1;
      return { paddingLeft: landed ? '28px' : '0px', paddingRight: landed ? '28px' : '0px' };
    });
    const nodeRef = h2RefFor(PAGE_SOURCE, 'src/app/org-settings/OrgSettingsPage.tsx');

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { paddingLeft: '28', paddingRight: '28' },
      undefined,
      nodeRef,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    const written = fileIO.content(PAGE_PATH);
    expect(written).not.toContain('style={{');
  });

  it('does NOT escalate when no verify provider is wired (best-effort write, current behavior)', async () => {
    const fileIO = new InMemoryFileIO({ [PAGE_PATH]: PAGE_SOURCE });
    const service = tailwindService(fileIO);
    const nodeRef = h2RefFor(PAGE_SOURCE, 'src/app/org-settings/OrgSettingsPage.tsx');

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { paddingLeft: '28', paddingRight: '28' },
      undefined,
      nodeRef,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(fileIO.content(PAGE_PATH)).not.toContain('style={{');
  });

  it('does NOT escalate a pseudo-state edit (inline style is base-state only)', async () => {
    const fileIO = new InMemoryFileIO({ [PAGE_PATH]: PAGE_SOURCE });
    const service = tailwindService(fileIO);
    service.setVerifyComputedStyleProvider(async () => ({ backgroundColor: 'rgba(0, 0, 0, 0)' }));
    const nodeRef = h2RefFor(PAGE_SOURCE, 'src/app/org-settings/OrgSettingsPage.tsx');

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { backgroundColor: '#ff00aa' },
      'hover',
      nodeRef,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(fileIO.content(PAGE_PATH)).not.toContain('style={{');
  });

  it('is idempotent: repeating the same edit after an escalation does not write again', async () => {
    const fileIO = new InMemoryFileIO({ [PAGE_PATH]: PAGE_SOURCE });
    const service = tailwindService(fileIO);
    service.setVerifyComputedStyleProvider(async () => ({ paddingLeft: '0px', paddingRight: '0px' }));
    const nodeRef = h2RefFor(PAGE_SOURCE, 'src/app/org-settings/OrgSettingsPage.tsx');

    await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { paddingLeft: '28', paddingRight: '28' },
      undefined,
      nodeRef,
    );
    const afterFirst = fileIO.content(PAGE_PATH);
    expect(afterFirst).toContain('paddingLeft: "28px"');

    // Same edit again: the planner dedupes (no mutation) — the verify must not misread the
    // unchanged computed style as "didn't land" and pile on another write.
    const second = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { paddingLeft: '28', paddingRight: '28' },
      undefined,
      nodeRef,
    );
    expect(second).toEqual(expect.objectContaining({ success: true }));
    expect(fileIO.content(PAGE_PATH)).toBe(afterFirst);
  });

  it('aborts the escalation without clobbering a concurrent save that lands during the verify window (P1)', async () => {
    const fileIO = new InMemoryFileIO({ [PAGE_PATH]: PAGE_SOURCE });
    const service = tailwindService(fileIO);
    // The verify provider doubles as the user's editor: on the first poll AFTER the class write
    // (call 2 — call 1 is the pre-write snapshot) it saves a foreign edit to disk, exactly what a
    // user save / formatter does inside the ~1.2s verify window.
    let calls = 0;
    let foreignContent = '';
    service.setVerifyComputedStyleProvider(async () => {
      calls += 1;
      if (calls === 2) {
        foreignContent = `${fileIO.content(PAGE_PATH)}\n// concurrent user save\n`;
        await fileIO.writeFile(PAGE_PATH, foreignContent);
      }
      return { paddingLeft: '0px', paddingRight: '0px' };
    });
    const nodeRef = h2RefFor(PAGE_SOURCE, 'src/app/org-settings/OrgSettingsPage.tsx');

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { paddingLeft: '28', paddingRight: '28' },
      undefined,
      nodeRef,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    // The foreign save survives byte-for-byte: the escalation's whole-file reprint must NOT fold
    // it into this op's result (no inline style merged, no reformat).
    expect(fileIO.content(PAGE_PATH)).toBe(foreignContent);
    // Advisory warning tells the user to re-apply, and the op must NOT claim an undo entry over
    // content it does not own — the next Undo would have restored the pre-op snapshot and erased
    // the concurrent save.
    expect(result.warning).toBeDefined();
    expect(result.skipUndoTracking).toBe(true);
  });

  it('preserves a concurrent save that lands AFTER the escalation write and skips undo tracking (P1)', async () => {
    const fileIO = new InMemoryFileIO({ [PAGE_PATH]: PAGE_SOURCE });
    const service = tailwindService(fileIO);
    // Second window: the escalation's own post-write verify. The provider applies the foreign
    // edit only once the escalation's inline style is on disk (the write happens between the
    // pre-write snapshot and these polls), then the ownership check must see the divergence.
    let foreignApplied = false;
    service.setVerifyComputedStyleProvider(async () => {
      const current = fileIO.content(PAGE_PATH);
      if (!foreignApplied && current.includes('style={{')) {
        foreignApplied = true;
        await fileIO.writeFile(PAGE_PATH, `${current}\n// concurrent user save\n`);
      }
      return { paddingLeft: '0px', paddingRight: '0px' };
    });
    const nodeRef = h2RefFor(PAGE_SOURCE, 'src/app/org-settings/OrgSettingsPage.tsx');

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { paddingLeft: '28', paddingRight: '28' },
      undefined,
      nodeRef,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    const written = fileIO.content(PAGE_PATH);
    // The escalation write landed AND the later foreign save was not clobbered — but the op no
    // longer owns the final content, so the undo tracker must record nothing for it.
    expect(written).toContain('paddingLeft: "28px"');
    expect(written).toContain('// concurrent user save');
    expect(result.skipUndoTracking).toBe(true);
  });

  it('C3 shared with the auto-wrap path: a backgroundColor write on an element that ALREADY has its own background-image escalates too (self-cover, not just child-cover)', async () => {
    // HYP-990's C3 fail-closed guard (verifyLanded) treats a non-`none` backgroundImage on the
    // READ element as proof the effectiveBackgroundColor read is untrustworthy — originally
    // written for the auto-wrap path (an opaque image on the WRAPPED CHILD hides the WRAPPER's
    // color). `writeDirectCandidate` (HYP-1162, this file) shares the same `verifyLanded`, so
    // the same guard also fires here — and it is CORRECT to: `computeEffectiveBackgroundColor`
    // (shared/utils/effective-background.ts) reads the edited element's OWN backgroundColor
    // layer first and never accounts for that SAME element's own backgroundImage — so a
    // pre-existing image on h2 itself hides the new color exactly as the CSS spec says
    // (background-image paints over background-color on one element), even though the color
    // proof would otherwise report "changed". Escalating to an inline override is the right
    // outcome, and the class write is never rolled back (a false positive costs only a
    // redundant inline duplicate, never a lost edit — see the file header / HYP-1162 doc).
    const fileIO = new InMemoryFileIO({ [PAGE_PATH]: PAGE_SOURCE });
    const service = tailwindService(fileIO);
    service.setVerifyComputedStyleProvider(async () => ({
      // effectiveBackgroundColor DOES "change" (proves nothing about visibility)…
      effectiveBackgroundColor: 'rgb(255, 0, 170)',
      // …but the element's own background-image is present and opaque, so C3 refuses to trust it.
      backgroundImage: 'linear-gradient(rgb(1, 2, 3), rgb(4, 5, 6))',
    }));
    const nodeRef = h2RefFor(PAGE_SOURCE, 'src/app/org-settings/OrgSettingsPage.tsx');

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { backgroundColor: '#ff00aa' },
      undefined,
      nodeRef,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    const written = fileIO.content(PAGE_PATH);
    // The class write stays (never rolled back)…
    expect(written).toContain('backgroundColor: "#ff00aa"');
    // …AND the escalation adds the inline override, the only write that beats the covering image.
    expect(written).toContain('style={{');
  });

  it('re-applies the edit after an external revert (git checkout) instead of no-oping on a stale AST cache', async () => {
    const fileIO = new InMemoryFileIO({ [PAGE_PATH]: PAGE_SOURCE });
    const service = tailwindService(fileIO);
    service.setVerifyComputedStyleProvider(async () => ({ paddingLeft: '0px', paddingRight: '0px' }));
    const nodeRef = h2RefFor(PAGE_SOURCE, 'src/app/org-settings/OrgSettingsPage.tsx');

    await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { paddingLeft: '28', paddingRight: '28' },
      undefined,
      nodeRef,
    );
    expect(fileIO.content(PAGE_PATH)).not.toBe(PAGE_SOURCE);

    // External revert: the file goes back to the pre-edit content WITHOUT AstService knowing
    // (QA repro: `git checkout -- src` between two inspector writes). This pins the disk-first
    // contract of runStyleWriteTransaction: the second write must re-read disk, re-apply the
    // edit, and re-run the escalation — a cache-first regression here would no-op the write and
    // leave undo with nothing to undo (the HYP-1162 QA's vacuous-undo symptom).
    await fileIO.writeFile(PAGE_PATH, PAGE_SOURCE);

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { paddingLeft: '28', paddingRight: '28' },
      undefined,
      nodeRef,
    );
    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(fileIO.content(PAGE_PATH)).not.toBe(PAGE_SOURCE);
    expect(fileIO.content(PAGE_PATH)).toContain('paddingLeft: "28px"');
  });
});
