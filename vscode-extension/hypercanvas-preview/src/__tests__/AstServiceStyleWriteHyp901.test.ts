/**
 * @file HYP-901 verify-and-retry integration tests — split into their OWN file, separate from
 * AstServiceStyleWrite.test.ts.
 *
 * Why a separate file: `bun test --isolate` isolates state BETWEEN files (see the root
 * `bunfig.toml` comment on `[test] preload` — happy-dom's selector parser is documented to leak
 * state across a shared context, which is exactly why `--isolate` exists). These 3 tests,
 * combined with the auto-wrap candidate's real AST reparse + `@babel/generator` print, were
 * observed to corrupt EACH OTHER's output — but only when run as `it()` siblings inside the same
 * file as other AstService integration tests, NEVER when run standalone via `bun run` (no test
 * framework, no happy-dom preload at all) or in true isolation. Root-caused to the happy-dom /
 * bun:test preload interaction (`test/setup.ts`'s `Object.assign(globalThis, {...})` — confirmed
 * by reproducing the exact same operations via a plain `bun run` script with NO corruption, which
 * rules out the actual `ast-update-utils.ts`/`style-wrap-retry.ts` logic as the cause). Splitting
 * into a dedicated file — the same remedy the project already applies at the file level via
 * `--isolate` — sidesteps it without touching shared test infrastructure (`test/setup.ts` is used
 * by the whole monorepo's test suite; a fix there is out of scope for this ticket and would need
 * its own investigation/review).
 *
 * Accessed via: VS Code inspector style updates routed through shared StyleWriteManager, same as
 * AstServiceStyleWrite.test.ts (see that file for the non-HYP-901 integration tests).
 */
import { describe, expect, it } from 'bun:test';
import { NodeMapService } from '@lib/element-tracing/node-map-service';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import { AstService } from '../services/AstService';

function syntheticRefFor(source: string, relativePath: string): string {
  const helper = new NodeMapService();
  const entries = helper.parseAndBuild(source, relativePath);
  const entry = entries[0];
  return `${relativePath}:${entry.loc.line}:${entry.loc.column}`;
}

/**
 * HYP-901 — reproduces the conloca-app OrgSettingsPage/HostRoutePage repro end-to-end through
 * the real AstService. The Explorer tree lets the user select a composite component
 * (HostRoutePage); HostRoutePage's props destructure has no `style`/`className` and no
 * `...rest` spread, so a direct write would be dead code. Per Alex's correction (tg#6243) the
 * fix is NOT warn-then-give-up — it's auto-wrap-and-retry.
 */
function hostRoutePageFixture() {
  const orgSettingsPath = '/workspace/src/app/org-settings/OrgSettingsPage.tsx';
  const hostRoutePagePath = '/workspace/src/app/ui/HostRoutePage.tsx';

  const hostRoutePageSource = `interface HostRoutePageProps {
  onBack: () => void;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export default function HostRoutePage({ onBack, title, subtitle, children }: HostRoutePageProps) {
  return (
    <div className="host-route-page">
      <h1>{title}</h1>
      {children}
    </div>
  );
}
`;
  const orgSettingsSource = `import HostRoutePage from '../ui/HostRoutePage';

export function OrgSettingsPage() {
  return (
    <HostRoutePage onBack={() => {}} title="Org settings">
      <p>body</p>
    </HostRoutePage>
  );
}
`;
  const fileIO = new InMemoryFileIO({
    [orgSettingsPath]: orgSettingsSource,
    [hostRoutePagePath]: hostRoutePageSource,
  });
  return { orgSettingsPath, orgSettingsSource, fileIO };
}

describe('AstService HYP-901 style-write verify-and-retry', () => {
  it('auto-wraps a non-forwarding custom component instead of writing a dead prop, no verify wired (HYP-901)', async () => {
    const { orgSettingsPath, fileIO } = hostRoutePageFixture();
    const service = new AstService('/workspace', fileIO);
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), 'src/app/org-settings/OrgSettingsPage.tsx');

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { backgroundColor: '#ff00aa' },
      undefined,
      nodeRef,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    if (!result.success) throw new Error('expected success');
    // The value is NOT written as a dead `style` prop on <HostRoutePage> — it's wrapped in a
    // <div> that actually forwards to the DOM, and no warning fires (best-effort keep, since the
    // static check alone is already strictly better than the dead prop it replaces).
    const written = fileIO.content(orgSettingsPath);
    expect(written).toContain('backgroundColor: "#ff00aa"');
    expect(written).toContain('<HostRoutePage onBack={() => {}} title="Org settings">');
    expect(written.indexOf('<div')).toBeLessThan(written.indexOf('<HostRoutePage'));
    expect(result.warning).toBeUndefined();
  });

  it('keeps the auto-wrap silently when live-preview verify confirms it landed (HYP-901)', async () => {
    const { orgSettingsPath, fileIO } = hostRoutePageFixture();
    const service = new AstService('/workspace', fileIO);
    // Verify provider: first call (before-snapshot) reports the ORIGINAL value; every call after
    // the wrap write reports the INTENDED value — simulating a live preview that picked up HMR.
    let writesObserved = 0;
    service.setVerifyComputedStyleProvider(async (_elementId, cssProperties) => {
      writesObserved += 1;
      const landed = writesObserved > 1;
      return Object.fromEntries(cssProperties.map((prop) => [prop, landed ? 'rgb(255, 0, 170)' : 'rgba(0, 0, 0, 0)']));
    });
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), 'src/app/org-settings/OrgSettingsPage.tsx');

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { backgroundColor: '#ff00aa' },
      undefined,
      nodeRef,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    if (!result.success) throw new Error('expected success');
    const written = fileIO.content(orgSettingsPath);
    expect(written).toContain('<HostRoutePage onBack={() => {}} title="Org settings">');
    expect(written.indexOf('<div')).toBeLessThan(written.indexOf('<HostRoutePage'));
    expect(result.warning).toBeUndefined();
  });

  it('HYP-987 P1 #1 — warns when an opaque child root covers the wrapper (effectiveBackgroundColor unchanged)', async () => {
    // The real repro: HostRoutePage's rendered root is opaque (min-h-screen bg-*), so the injected
    // wrapper's background is COVERED. The element's OWN backgroundColor never changes (does not
    // inherit) AND its effectiveBackgroundColor (painted-through) stays the opaque root colour.
    // Reading the child's own backgroundColor would false-positive "landed"; effectiveBackgroundColor
    // correctly reports the wrap did NOT become visible → roll back + warn.
    const { orgSettingsPath, orgSettingsSource, fileIO } = hostRoutePageFixture();
    const service = new AstService('/workspace', fileIO);
    service.setVerifyComputedStyleProvider(async (_elementId, cssProperties) => {
      const snap: Record<string, string> = {};
      // The child's OWN backgroundColor is transparent before AND after (bg does not inherit).
      for (const prop of cssProperties) snap[prop] = 'rgba(0, 0, 0, 0)';
      // The painted-through background stays the opaque root's grey — the wrapper never shows.
      snap.effectiveBackgroundColor = 'rgb(30, 30, 30)';
      return snap;
    });
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), 'src/app/org-settings/OrgSettingsPage.tsx');

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { backgroundColor: '#ff00aa' },
      undefined,
      nodeRef,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    if (!result.success) throw new Error('expected success');
    // The wrap was rolled back (opaque root covered it) and the persistent warning fires.
    expect(fileIO.content(orgSettingsPath)).toBe(orgSettingsSource);
    expect(result.warning?.componentName).toBe('HostRoutePage');
  });

  it('HYP-987 P1 #1 — keeps the wrap when the wrapper paints through (effectiveBackgroundColor changes)', async () => {
    // A non-forwarding component with a TRANSPARENT root: the wrapper's background paints through.
    // The child's own backgroundColor still never changes, but effectiveBackgroundColor goes from
    // the page background to the wrapper's colour — proof the edit is visible → keep.
    const { orgSettingsPath, fileIO } = hostRoutePageFixture();
    const service = new AstService('/workspace', fileIO);
    let calls = 0;
    service.setVerifyComputedStyleProvider(async (_elementId, cssProperties) => {
      calls += 1;
      const snap: Record<string, string> = {};
      for (const prop of cssProperties) snap[prop] = 'rgba(0, 0, 0, 0)'; // own bg transparent throughout
      snap.effectiveBackgroundColor = calls > 1 ? 'rgb(255, 0, 170)' : 'rgb(255, 255, 255)';
      return snap;
    });
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), 'src/app/org-settings/OrgSettingsPage.tsx');

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { backgroundColor: '#ff00aa' },
      undefined,
      nodeRef,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    if (!result.success) throw new Error('expected success');
    const written = fileIO.content(orgSettingsPath);
    expect(written.indexOf('<div')).toBeLessThan(written.indexOf('<HostRoutePage'));
    expect(result.warning).toBeUndefined();
  });

  it('HYP-987 P1 #4 — a pseudo-state (:hover) edit warns without wrapping (inline is base-state only)', async () => {
    // A wrapper `<div>` carries only inline `style`, which cannot express `:hover` (master spec
    // §8.3). Wrapping a hover edit would make it a permanently-active base-state background. So a
    // non-base state must warn WITHOUT mutating the file — never a silent base-inline wrap.
    const { orgSettingsPath, orgSettingsSource, fileIO } = hostRoutePageFixture();
    const service = new AstService('/workspace', fileIO);
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), 'src/app/org-settings/OrgSettingsPage.tsx');

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { backgroundColor: '#ff00aa' },
      'hover',
      nodeRef,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    if (!result.success) throw new Error('expected success');
    // File is untouched (no wrapper `<div>` injected) and the warning fires.
    expect(fileIO.content(orgSettingsPath)).toBe(orgSettingsSource);
    expect(fileIO.content(orgSettingsPath)).not.toContain('<div style');
    expect(result.warning?.componentName).toBe('HostRoutePage');
  });

  it('HYP-987 P1 #5 — a concurrent edit during the verify poll is NOT clobbered by rollback', async () => {
    // The verify poll takes multiple seconds; a concurrent write (another edit / formatter / HMR
    // save) can land in that window. A blind restore-to-original would erase it. Rollback is a
    // content-CAS: restore ONLY when the file on disk is still our exact wrap output. Here a
    // concurrent write lands mid-poll, so the (not-landed) rollback must leave it untouched.
    const { orgSettingsPath, fileIO } = hostRoutePageFixture();
    const concurrentContent = '// a concurrent edit landed during the verify poll\nexport const X = 1;\n';
    const service = new AstService('/workspace', fileIO);
    let calls = 0;
    service.setVerifyComputedStyleProvider(async (_elementId, cssProperties) => {
      calls += 1;
      if (calls === 2) await fileIO.writeFile(orgSettingsPath, concurrentContent); // concurrent edit mid-poll
      const snap: Record<string, string> = {};
      for (const prop of cssProperties) snap[prop] = 'rgba(0, 0, 0, 0)';
      snap.effectiveBackgroundColor = 'rgb(30, 30, 30)'; // never lands → rollback attempted
      return snap;
    });
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), 'src/app/org-settings/OrgSettingsPage.tsx');

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { backgroundColor: '#ff00aa' },
      undefined,
      nodeRef,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    if (!result.success) throw new Error('expected success');
    // The concurrent edit survived — rollback did NOT overwrite it with the pre-edit content.
    expect(fileIO.content(orgSettingsPath)).toBe(concurrentContent);
    expect(result.warning?.componentName).toBe('HostRoutePage');
    // And this op must NOT claim the concurrent content as its own undo entry (P1 codex): the
    // warn/rollback path sets skipUndoTracking so _withUndoTracking records nothing.
    expect(result.skipUndoTracking).toBe(true);
  });

  it('HYP-987 P2 (codex) — a property the child cannot reflect (opacity) warns without wrapping', async () => {
    // `opacity` on the injected wrapper is visibly effective but the wrapped child's own computed
    // opacity never changes, so the wrap could never be runtime-verified. Rather than wrap-then-
    // false-rollback, such a property surfaces the warning WITHOUT mutating the file.
    const { orgSettingsPath, orgSettingsSource, fileIO } = hostRoutePageFixture();
    const service = new AstService('/workspace', fileIO);
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), 'src/app/org-settings/OrgSettingsPage.tsx');

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { opacity: '0.5' },
      undefined,
      nodeRef,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    if (!result.success) throw new Error('expected success');
    expect(fileIO.content(orgSettingsPath)).toBe(orgSettingsSource);
    expect(fileIO.content(orgSettingsPath)).not.toContain('<div style');
    expect(result.warning?.componentName).toBe('HostRoutePage');
    expect(result.skipUndoTracking).toBe(true);
  });

  it('HYP-987 P1 (codex) — a formatter reformatting the wrap mid-poll is surgically unwrapped, not left as debris', async () => {
    // A byte-for-byte content-CAS would misread a formatter reformatting our wrap output as a
    // foreign edit and leave the dead wrapper behind. Here the verify provider simulates a
    // formatter touching the file mid-poll; the (not-landed) rollback must SURGICALLY remove just
    // our `<div style>` wrapper while preserving the formatter's concurrent change.
    const { orgSettingsPath, fileIO } = hostRoutePageFixture();
    const service = new AstService('/workspace', fileIO);
    let calls = 0;
    service.setVerifyComputedStyleProvider(async (_elementId, cssProperties) => {
      calls += 1;
      if (calls === 2) {
        // Formatter reformats our wrap output (prepends a comment) — bytes now differ from ours.
        await fileIO.writeFile(orgSettingsPath, `// formatter touched this\n${fileIO.content(orgSettingsPath)}`);
      }
      const snap: Record<string, string> = {};
      for (const prop of cssProperties) snap[prop] = 'rgba(0, 0, 0, 0)';
      snap.effectiveBackgroundColor = 'rgb(30, 30, 30)'; // never lands → rollback attempted
      return snap;
    });
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), 'src/app/org-settings/OrgSettingsPage.tsx');

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { backgroundColor: '#ff00aa' },
      undefined,
      nodeRef,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    if (!result.success) throw new Error('expected success');
    const written = fileIO.content(orgSettingsPath);
    // Debris gone: no wrapper `<div style>` and none of its background value remains.
    expect(written).not.toContain('backgroundColor');
    expect(written).not.toContain('<div style');
    // The component is intact and the formatter's concurrent change survived (surgical, not restore).
    expect(written).toContain('HostRoutePage');
    expect(written).toContain('formatter touched this');
    expect(result.warning?.componentName).toBe('HostRoutePage');
  });

  it('HYP-987 P1 (codex) — a multi-property wrap needs EVERY property to land, not just one', async () => {
    // `{ color, backgroundColor }` on a component with an opaque root: the inherited `color`
    // changes but the covered `backgroundColor` (effectiveBackgroundColor) does not. A `some`
    // check would wrongly keep the wrap; `every` correctly rolls it back + warns.
    const { orgSettingsPath, orgSettingsSource, fileIO } = hostRoutePageFixture();
    const service = new AstService('/workspace', fileIO);
    let calls = 0;
    service.setVerifyComputedStyleProvider(async (_elementId, cssProperties) => {
      calls += 1;
      const snap: Record<string, string> = {};
      for (const prop of cssProperties) snap[prop] = 'rgba(0, 0, 0, 0)';
      // color DOES change after the wrap (inherited); effectiveBackgroundColor stays grey (covered).
      snap.color = calls > 1 ? 'rgb(255, 0, 0)' : 'rgb(0, 0, 0)';
      snap.effectiveBackgroundColor = 'rgb(30, 30, 30)';
      return snap;
    });
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), 'src/app/org-settings/OrgSettingsPage.tsx');

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { color: '#ff0000', backgroundColor: '#ff00aa' },
      undefined,
      nodeRef,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    if (!result.success) throw new Error('expected success');
    // backgroundColor never became visible → the whole wrap is rolled back and warned.
    expect(fileIO.content(orgSettingsPath)).toBe(orgSettingsSource);
    expect(result.warning?.componentName).toBe('HostRoutePage');
  });

  it('HYP-987 P2 (opus/codex) — a CSS custom-property edit wraps and verifies end-to-end', async () => {
    // `--brand` inherits and is read verbatim, so it is child-verifiable: the wrap must be
    // attempted and KEPT when the custom property lands (not bailed before the wrap).
    const { orgSettingsPath, fileIO } = hostRoutePageFixture();
    const service = new AstService('/workspace', fileIO);
    let calls = 0;
    service.setVerifyComputedStyleProvider(async (_elementId, cssProperties) => {
      calls += 1;
      const snap: Record<string, string> = {};
      for (const prop of cssProperties) snap[prop] = calls > 1 ? 'rgb(1, 2, 3)' : 'rgb(0, 0, 0)';
      return snap;
    });
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), 'src/app/org-settings/OrgSettingsPage.tsx');

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { '--brand': '#010203' },
      undefined,
      nodeRef,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    if (!result.success) throw new Error('expected success');
    const written = fileIO.content(orgSettingsPath);
    expect(written).toContain('"--brand": "#010203"');
    expect(written.indexOf('<div')).toBeLessThan(written.indexOf('<HostRoutePage'));
    expect(result.warning).toBeUndefined();
  });

  it('HYP-987 P3 (codex) — an empty style set warns without inserting an empty wrapper', async () => {
    const { orgSettingsPath, orgSettingsSource, fileIO } = hostRoutePageFixture();
    const service = new AstService('/workspace', fileIO);
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), 'src/app/org-settings/OrgSettingsPage.tsx');

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      {},
      undefined,
      nodeRef,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    if (!result.success) throw new Error('expected success');
    expect(fileIO.content(orgSettingsPath)).toBe(orgSettingsSource);
    expect(fileIO.content(orgSettingsPath)).not.toContain('<div style');
  });

  it('HYP-987 P1 (codex) — an unclean rollback (parse failure) still skips undo (never erases concurrent work)', async () => {
    // A partial/dirty concurrent save leaves the file unparseable during the verify window. The
    // warn/rollback path must ALWAYS skip undo tracking: the coarse whole-file undo tracker would
    // otherwise record the concurrent content as this op's edit, so Undo would DELETE that
    // concurrent work. The unparseable content is left untouched (never clobbered).
    const { orgSettingsPath, fileIO } = hostRoutePageFixture();
    const service = new AstService('/workspace', fileIO);
    const brokenContent = 'export const Broken = <<<';
    let calls = 0;
    service.setVerifyComputedStyleProvider(async (_elementId, cssProperties) => {
      calls += 1;
      if (calls === 2) await fileIO.writeFile(orgSettingsPath, brokenContent); // unparseable concurrent save
      const snap: Record<string, string> = {};
      for (const prop of cssProperties) snap[prop] = 'rgba(0, 0, 0, 0)';
      snap.effectiveBackgroundColor = 'rgb(30, 30, 30)';
      return snap;
    });
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), 'src/app/org-settings/OrgSettingsPage.tsx');

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { backgroundColor: '#ff00aa' },
      undefined,
      nodeRef,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    if (!result.success) throw new Error('expected success');
    expect(result.warning?.componentName).toBe('HostRoutePage');
    // Concurrent content left intact, and undo tracking skipped so Undo cannot erase it.
    expect(fileIO.content(orgSettingsPath)).toBe(brokenContent);
    expect(result.skipUndoTracking).toBe(true);
  });

  it('HYP-987 P1 #3 — the verify RPC is addressed by verifyElementId, not the re-rooted elementId', async () => {
    // In a monorepo the AST write uses the re-rooted id but the iframe's findElementsByRef only
    // knows the pre-re-root id, threaded as verifyElementId. Assert the provider receives THAT,
    // never the write-side elementId — else the verify resolves nothing and silently no-ops.
    const { orgSettingsPath, fileIO } = hostRoutePageFixture();
    const service = new AstService('/workspace', fileIO);
    const seenIds: string[] = [];
    service.setVerifyComputedStyleProvider(async (elementId, cssProperties) => {
      seenIds.push(elementId);
      const snap: Record<string, string> = {};
      for (const prop of cssProperties) snap[prop] = 'rgba(0, 0, 0, 0)';
      snap.effectiveBackgroundColor = 'rgb(30, 30, 30)';
      return snap;
    });
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), 'src/app/org-settings/OrgSettingsPage.tsx');
    const IFRAME_ID = 'iframe-relative/OrgSettingsPage.tsx:1:1';

    await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { backgroundColor: '#ff00aa' },
      undefined,
      nodeRef,
      undefined,
      undefined,
      undefined,
      IFRAME_ID,
    );

    expect(seenIds.length).toBeGreaterThan(0);
    expect(seenIds.every((id) => id === IFRAME_ID)).toBe(true);
    expect(seenIds).not.toContain(nodeRef);
  });

  it('falls back to the last-resort warning and restores the file when even the auto-wrap does not verify as landed (HYP-901)', async () => {
    const { orgSettingsPath, orgSettingsSource, fileIO } = hostRoutePageFixture();
    const service = new AstService('/workspace', fileIO);
    // Verify provider always reports the SAME (unchanged) value — nothing ever "lands".
    service.setVerifyComputedStyleProvider(async (_elementId, cssProperties) =>
      Object.fromEntries(cssProperties.map((prop) => [prop, 'rgba(0, 0, 0, 0)'])),
    );
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), 'src/app/org-settings/OrgSettingsPage.tsx');

    const result = await service.updateStyles(
      'src/app/org-settings/OrgSettingsPage.tsx',
      nodeRef,
      { backgroundColor: '#ff00aa' },
      undefined,
      nodeRef,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    if (!result.success) throw new Error('expected success');
    // Exhausted both candidates — the file is back to exactly what it was before the edit, and
    // the warning is the LAST thing surfaced, not the first.
    expect(fileIO.content(orgSettingsPath)).toBe(orgSettingsSource);
    expect(result.warning?.componentName).toBe('HostRoutePage');
    expect(result.warning?.message).toContain("doesn't forward");
  });
});
