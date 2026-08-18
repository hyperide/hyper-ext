/**
 * @file HYP-990 (M2) integration tests — the atomic-saga follow-up to HYP-987 M1. Exercises, through
 * the real AstService auto-wrap path:
 *  - C3: a `backgroundColor` wrap whose read element reports an opaque background-image FAILS CLOSED
 *    (rolled back + warned), because the `effectiveBackgroundColor` color-walk is blind to the image.
 *  - C1: two overlapping style edits to the same file are SERIALIZED (no interleave, no nested
 *    wrappers, no corrupted output) and the surgical rollback stays marker-precise.
 *
 * In its OWN file for the same `bun test --isolate` reason documented in
 * AstServiceStyleWriteHyp901.test.ts (the reparse + @babel/generator print corrupts sibling tests
 * under the shared happy-dom preload).
 */
import { describe, expect, it } from 'bun:test';
import { NodeMapService } from '@lib/element-tracing/node-map-service';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import { parseCode } from '@lib/ast/parser';
import { AstService } from '../services/AstService';

function syntheticRefFor(source: string, relativePath: string): string {
  const helper = new NodeMapService();
  const entries = helper.parseAndBuild(source, relativePath);
  return `${relativePath}:${entries[0].loc.line}:${entries[0].loc.column}`;
}

/** nodeRef (path:line:col, 1-based line / 0-based col of the `<`) for a specific JSX tag. */
function refForTag(source: string, relativePath: string, tag: string): string {
  const idx = source.indexOf(`<${tag}`);
  if (idx < 0) throw new Error(`tag <${tag}> not in fixture`);
  const before = source.slice(0, idx);
  const line = before.split('\n').length;
  const col = idx - (before.lastIndexOf('\n') + 1);
  return `${relativePath}:${line}:${col}`;
}

function hostRoutePageFixture() {
  const orgSettingsPath = '/workspace/src/app/org-settings/OrgSettingsPage.tsx';
  const hostRoutePagePath = '/workspace/src/app/ui/HostRoutePage.tsx';
  const hostRoutePageSource = `interface HostRoutePageProps {
  title: string;
  children?: React.ReactNode;
}

export default function HostRoutePage({ title, children }: HostRoutePageProps) {
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
    <HostRoutePage title="Org settings">
      <p>body</p>
    </HostRoutePage>
  );
}
`;
  const fileIO = new InMemoryFileIO({
    [orgSettingsPath]: orgSettingsSource,
    [hostRoutePagePath]: hostRoutePageSource,
  });
  return { orgSettingsPath, fileIO };
}

const REL = 'src/app/org-settings/OrgSettingsPage.tsx';

describe('AstService HYP-990 M2 — atomic saga', () => {
  it('C3 — a backgroundColor wrap over an opaque background-image FAILS CLOSED (rolled back + warned)', async () => {
    const { orgSettingsPath, fileIO } = hostRoutePageFixture();
    const original = fileIO.content(orgSettingsPath);
    const service = new AstService('/workspace', fileIO);

    // The color-walk WOULD see a change (effectiveBackgroundColor differs pre/post), but the read
    // element carries an opaque gradient the color proof cannot see — so the wrap must NOT be kept.
    let call = 0;
    service.setVerifyComputedStyleProvider(async (_elementId, cssProperties) => {
      call += 1;
      const snap: Record<string, string> = {};
      for (const prop of cssProperties) snap[prop] = call === 1 ? 'rgba(0, 0, 0, 0)' : 'rgb(255, 0, 170)';
      // Before-snapshot (call 1) is the pre-wrap child; after reads report a covering gradient.
      snap.backgroundImage = call === 1 ? 'none' : 'linear-gradient(rgb(1, 2, 3), rgb(4, 5, 6))';
      return snap;
    });

    const nodeRef = syntheticRefFor(original, REL);
    const result = await service.updateStyles(REL, nodeRef, { backgroundColor: '#ff00aa' }, undefined, nodeRef);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    // Fail-closed: warned, file restored to pre-edit content (no debris wrapper), undo skipped.
    expect(result.warning?.componentName).toBe('HostRoutePage');
    expect(fileIO.content(orgSettingsPath)).toBe(original);
    expect(result.skipUndoTracking).toBe(true);
    // Part 1 — the warning carries the STRUCTURED diagnosis the AI-fix flow leads with.
    const diagnosis = result.warning?.diagnosis;
    expect(diagnosis?.reason).toBe('wrap-not-visible');
    expect(diagnosis?.editedProperties).toEqual(['backgroundColor']);
    // The component-definition location (HostRoutePage's file) is pinpointed for the AI to fix.
    expect(diagnosis?.componentDefinition?.filePath).toContain('HostRoutePage.tsx');
    expect(diagnosis?.callSite?.filePath).toContain('OrgSettingsPage.tsx');
  });

  it('C3 — a backgroundColor wrap with NO covering image is kept when the color proof changes', async () => {
    const { orgSettingsPath, fileIO } = hostRoutePageFixture();
    const service = new AstService('/workspace', fileIO);
    let call = 0;
    service.setVerifyComputedStyleProvider(async (_elementId, cssProperties) => {
      call += 1;
      const snap: Record<string, string> = {};
      for (const prop of cssProperties) snap[prop] = call === 1 ? 'rgba(0, 0, 0, 0)' : 'rgb(255, 0, 170)';
      snap.backgroundImage = 'none';
      return snap;
    });
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), REL);
    const result = await service.updateStyles(REL, nodeRef, { backgroundColor: '#ff00aa' }, undefined, nodeRef);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.warning).toBeUndefined();
    const written = fileIO.content(orgSettingsPath);
    expect(written).toContain('backgroundColor: "#ff00aa"');
    // Kept wrap: the transient marker must have been stripped from committed source.
    expect(written).not.toContain('data-hc-writeid');
    // P1#1 (codex) — a kept wrap returns the lock-captured undo snapshot (before = pre-edit content,
    // after = the committed wrapped content), so `_withUndoTracking` records a race-free entry.
    expect(result.undoSnapshot?.path).toBe(orgSettingsPath);
    expect(result.undoSnapshot?.after).toBe(written);
    expect(result.undoSnapshot?.before).not.toBe(written);
    expect(result.undoSnapshot?.before).toContain('<HostRoutePage');
  });

  it('keep-report — preview live but no element root: KEPT + surfaced kept-unverified warning (Opus #4)', async () => {
    const { orgSettingsPath, fileIO } = hostRoutePageFixture();
    const service = new AstService('/workspace', fileIO);
    // Before-snapshot succeeds (preview is live), but every AFTER read returns the no-element-root
    // SENTINEL (the marker wrapper IS in the DOM but has no element child — text/fragment/portal).
    // This is the genuine "can't verify THIS component" case → keep + a surfaced keep-report (NOT
    // silent — that is reserved for an ABSENT wrapper / no preview, NOT rollback).
    let call = 0;
    service.setVerifyComputedStyleProvider(async (_id, cssProperties) => {
      call += 1;
      if (call === 1) {
        const snap: Record<string, string> = {};
        for (const prop of cssProperties) snap[prop] = 'rgba(0, 0, 0, 0)';
        snap.backgroundImage = 'none';
        return snap; // before-snapshot (preview live)
      }
      return { hcNoElementRoot: '1' }; // after reads: wrapper present, no element root
    });
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), REL);
    const result = await service.updateStyles(REL, nodeRef, { backgroundColor: '#ff00aa' }, undefined, nodeRef);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    // KEPT (applied), surfaced as a keep-report.
    expect(fileIO.content(orgSettingsPath)).toContain('backgroundColor: "#ff00aa"');
    expect(result.warning?.kept).toBe(true);
    expect(result.warning?.diagnosis?.reason).toBe('kept-unverified');
  });

  it('§9.4 exact+unverifiable — wrapper never renders (slow HMR): KEPT + surfaced report, never silent', async () => {
    const { orgSettingsPath, fileIO } = hostRoutePageFixture();
    const service = new AstService('/workspace', fileIO);
    // Before succeeds, but every AFTER read is null (the marked wrapper never appears — HMR slower
    // than the poll budget) — a genuine `unverifiable` B1 outcome. §9.4's `exact + unverifiable =
    // keep + report` cell: the write target was already trusted (exact — no itemIndex threaded, the
    // default), so it is kept, but the keep is NEVER silent (superseding the earlier "keep silently
    // for §9.3 slow-build" reading, which conflated the settle-classification rule with this
    // separate keep/rollback decision).
    let call = 0;
    service.setVerifyComputedStyleProvider(async (_id, cssProperties) => {
      call += 1;
      if (call === 1) {
        const snap: Record<string, string> = {};
        for (const prop of cssProperties) snap[prop] = 'rgba(0, 0, 0, 0)';
        snap.backgroundImage = 'none';
        return snap;
      }
      return null; // wrapper absent (HMR pending)
    });
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), REL);
    const result = await service.updateStyles(REL, nodeRef, { backgroundColor: '#ff00aa' }, undefined, nodeRef);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(fileIO.content(orgSettingsPath)).toContain('backgroundColor: "#ff00aa"');
    expect(result.warning?.kept).toBe(true);
    expect(result.warning?.diagnosis?.reason).toBe('kept-unverified');
  });

  it('§9.4 exact+unverifiable — snapshot omits backgroundImage entirely: KEPT + surfaced report (not rolled back)', async () => {
    const { orgSettingsPath, fileIO } = hostRoutePageFixture();
    const service = new AstService('/workspace', fileIO);
    // effectiveBackgroundColor "changes", but the provider never reports backgroundImage — C3 cannot
    // confirm no covering image, so `proof-unavailable` (an ABSENT signal, not a NEGATIVE one) maps
    // to the matrix's `unverifiable` column. At `exact` confidence (default — no itemIndex threaded)
    // that is `keep + report`, not a rollback: the write target was already trusted, and a merely
    // untrustworthy PROOF is not the same as a known opaque cover (that case is `covered`/`not-landed`,
    // tested separately above and still rolls back unconditionally).
    let call = 0;
    service.setVerifyComputedStyleProvider(async (_id, cssProperties) => {
      call += 1;
      const snap: Record<string, string> = {};
      for (const prop of cssProperties) snap[prop] = call === 1 ? 'rgba(0, 0, 0, 0)' : 'rgb(255, 0, 170)';
      return snap; // NOTE: no backgroundImage field
    });
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), REL);
    const result = await service.updateStyles(REL, nodeRef, { backgroundColor: '#ff00aa' }, undefined, nodeRef);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(fileIO.content(orgSettingsPath)).toContain('backgroundColor: "#ff00aa"');
    expect(result.warning?.kept).toBe(true);
    expect(result.warning?.diagnosis?.reason).toBe('kept-unverified');
  });

  it('§9.4 probable+unverifiable — a repeated .map() instance (nonzero itemIndex) ROLLS BACK, never silently kept', async () => {
    const { orgSettingsPath, fileIO } = hostRoutePageFixture();
    const original = fileIO.content(orgSettingsPath);
    const service = new AstService('/workspace', fileIO);
    // Same "wrapper never renders" unverifiable signal as the exact-confidence test above, but this
    // write targets occurrence 1 of a repeated site (itemIndex=1) — `verifyComputedStyle`'s DOM read
    // always queries occurrence 0 (HYP-1011), so the read cannot be trusted for THIS write. §9.4's
    // `probable + unverifiable = ROLLBACK — never silently keep` load-bearing cell must fire.
    let call = 0;
    service.setVerifyComputedStyleProvider(async (_id, cssProperties) => {
      call += 1;
      if (call === 1) {
        const snap: Record<string, string> = {};
        for (const prop of cssProperties) snap[prop] = 'rgba(0, 0, 0, 0)';
        snap.backgroundImage = 'none';
        return snap;
      }
      return null; // wrapper absent (HMR pending)
    });
    const nodeRef = syntheticRefFor(original, REL);
    const result = await service.updateStyles(
      REL,
      nodeRef,
      { backgroundColor: '#ff00aa' },
      undefined,
      nodeRef,
      undefined,
      undefined,
      undefined,
      undefined,
      1, // itemIndex — a non-zero repeated-list occurrence ⇒ `probable` confidence
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    // ROLLED BACK: file restored to pre-edit content, never silently kept on an untrustworthy read.
    expect(fileIO.content(orgSettingsPath)).toBe(original);
    expect(result.warning?.diagnosis?.reason).toBe('probable-unverifiable');
    expect(result.skipUndoTracking).toBe(true);
  });

  it('§9.4 probable+landed — a repeated .map() instance that DOES verify as landed is still kept (confidence only forks non-landed)', async () => {
    const { orgSettingsPath, fileIO } = hostRoutePageFixture();
    const service = new AstService('/workspace', fileIO);
    let call = 0;
    service.setVerifyComputedStyleProvider(async (_id, cssProperties) => {
      call += 1;
      const snap: Record<string, string> = {};
      for (const prop of cssProperties) snap[prop] = call === 1 ? 'rgba(0, 0, 0, 0)' : 'rgb(255, 0, 170)';
      snap.backgroundImage = 'none';
      return snap;
    });
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), REL);
    const result = await service.updateStyles(
      REL,
      nodeRef,
      { backgroundColor: '#ff00aa' },
      undefined,
      nodeRef,
      undefined,
      undefined,
      undefined,
      undefined,
      2, // itemIndex nonzero ⇒ `probable`, but the matrix's `landed` column is `commit` on every row
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.warning).toBeUndefined();
    expect(fileIO.content(orgSettingsPath)).toContain('backgroundColor: "#ff00aa"');
  });

  it('C1 — two overlapping edits to the same file are serialized: NEITHER is dropped, one merged wrapper', async () => {
    const { orgSettingsPath, fileIO } = hostRoutePageFixture();
    const service = new AstService('/workspace', fileIO);
    // MONOTONIC per-call values so every after-read differs from its before-snapshot → every wrap
    // verifies LANDED (kept). Using two DIFFERENT properties makes the assertion order-INDEPENDENT and
    // detects a DROPPED edit (codex full panel P1-4): a merged wrapper must carry BOTH, whichever edit
    // serializes first — the old "either backgroundColor value" assertion silently passed even if one
    // edit was lost.
    let call = 0;
    service.setVerifyComputedStyleProvider(async (_elementId, cssProperties) => {
      call += 1;
      const snap: Record<string, string> = {};
      for (const prop of cssProperties) snap[prop] = `rgb(${call}, ${call}, ${call})`;
      snap.backgroundImage = 'none';
      return snap;
    });
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), REL);

    const [a, b] = await Promise.all([
      service.updateStyles(REL, nodeRef, { backgroundColor: '#111111' }, undefined, nodeRef),
      service.updateStyles(REL, nodeRef, { color: '#222222' }, undefined, nodeRef),
    ]);

    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    const written = fileIO.content(orgSettingsPath);
    // Not corrupted — still valid TSX.
    expect(() => parseCode(written)).not.toThrow();
    // EXACTLY one owned wrapper (never two nested), no leftover transient marker.
    expect(written).not.toContain('data-hc-writeid');
    expect((written.match(/data-hc-autowrap/g) ?? []).length).toBe(1);
    expect(written).toContain('<HostRoutePage');
    // BOTH edits landed in the single merged wrapper — neither was dropped by the serialization.
    expect(written).toContain('backgroundColor: "#111111"');
    expect(written).toContain('color: "#222222"');
  });

  it('H1 — a user-authored bare style div is NEVER mutated; a new owned wrapper is created inside it', async () => {
    // <HostRoutePage> is already inside a user-authored `<div style={{ padding }}>` (no ownership
    // marker). The edit must NOT touch the user's div — it inserts our OWN `data-hc-autowrap` wrapper
    // around HostRoutePage instead (review, Opus: never mutate an element the user didn't select).
    const orgSettingsPath = '/workspace/src/app/org-settings/OrgSettingsPage.tsx';
    const hostRoutePagePath = '/workspace/src/app/ui/HostRoutePage.tsx';
    const orgSettingsSource = `import HostRoutePage from '../ui/HostRoutePage';

export function OrgSettingsPage() {
  return (
    <div style={{ padding: "8px" }}>
      <HostRoutePage title="Org settings">
        <p>body</p>
      </HostRoutePage>
    </div>
  );
}
`;
    const hostRoutePageSource = `export default function HostRoutePage({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="host-route-page"><h1>{title}</h1>{children}</div>;
}
`;
    const fileIO = new InMemoryFileIO({
      [orgSettingsPath]: orgSettingsSource,
      [hostRoutePagePath]: hostRoutePageSource,
    });
    const service = new AstService('/workspace', fileIO);
    // Report the change as LANDED (before ≠ after) so the wrap is KEPT (the merge-on-keep path).
    let call = 0;
    service.setVerifyComputedStyleProvider(async (_id, cssProperties) => {
      call += 1;
      const snap: Record<string, string> = {};
      for (const prop of cssProperties) snap[prop] = call === 1 ? 'rgba(0, 0, 0, 0)' : 'rgb(171, 205, 239)';
      snap.backgroundImage = 'none';
      return snap;
    });
    const ref = refForTag(orgSettingsSource, REL, 'HostRoutePage');
    const result = await service.updateStyles(REL, ref, { backgroundColor: '#abcdef' }, undefined, ref);

    expect(result.success).toBe(true);
    const written = fileIO.content(orgSettingsPath);
    // The user's padding div is untouched (padding intact, still no ownership marker on it).
    expect(written).toContain('padding: "8px"');
    // A NEW owned wrapper carries the edit and wraps HostRoutePage.
    expect(written).toContain('data-hc-autowrap');
    expect(written).toContain('backgroundColor: "#abcdef"');
    // The transient per-write marker is stripped after the keep.
    expect(written).not.toContain('data-hc-writeid');
    // Structure: user padding div → our autowrap div → <HostRoutePage>.
    expect(written.indexOf('padding: "8px"')).toBeLessThan(written.indexOf('data-hc-autowrap'));
    expect(written.indexOf('data-hc-autowrap')).toBeLessThan(written.indexOf('<HostRoutePage'));
  });

  it('H1b — a SECOND edit of our own auto-wrap updates it in place (merge), never nesting', async () => {
    // First edit creates our `data-hc-autowrap` wrapper; a second edit of a DIFFERENT property must
    // MERGE into that same wrapper (both properties survive), not nest a second wrapper.
    const orgSettingsPath = '/workspace/src/app/org-settings/OrgSettingsPage.tsx';
    const hostRoutePagePath = '/workspace/src/app/ui/HostRoutePage.tsx';
    // Start already-wrapped by our owned wrapper carrying a prior kept edit.
    const orgSettingsSource = `import HostRoutePage from '../ui/HostRoutePage';

export function OrgSettingsPage() {
  return (
    <div data-hc-autowrap style={{ backgroundColor: "#111111" }}>
      <HostRoutePage title="Org settings">
        <p>body</p>
      </HostRoutePage>
    </div>
  );
}
`;
    const hostRoutePageSource = `export default function HostRoutePage({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="host-route-page"><h1>{title}</h1>{children}</div>;
}
`;
    const fileIO = new InMemoryFileIO({
      [orgSettingsPath]: orgSettingsSource,
      [hostRoutePagePath]: hostRoutePageSource,
    });
    const service = new AstService('/workspace', fileIO);
    let call = 0;
    service.setVerifyComputedStyleProvider(async (_id, cssProperties) => {
      call += 1;
      const snap: Record<string, string> = {};
      for (const prop of cssProperties) snap[prop] = call === 1 ? 'rgb(17, 17, 17)' : 'rgb(1, 2, 3)';
      snap.backgroundImage = 'none';
      return snap;
    });
    const ref = refForTag(orgSettingsSource, REL, 'HostRoutePage');
    const result = await service.updateStyles(REL, ref, { color: '#020304' }, undefined, ref);

    expect(result.success).toBe(true);
    const written = fileIO.content(orgSettingsPath);
    // Merged: BOTH the prior backgroundColor and the new color are present…
    expect(written).toContain('backgroundColor: "#111111"');
    expect(written).toContain('color: "#020304"');
    // …in exactly ONE owned wrapper (no nesting), transient marker stripped.
    expect((written.match(/data-hc-autowrap/g) ?? []).length).toBe(1);
    expect(written).not.toContain('data-hc-writeid');
  });

  it('H2 — a null verify read (marker wrapper not yet rendered) retries instead of keeping unverified', async () => {
    const { orgSettingsPath, fileIO } = hostRoutePageFixture();
    const service = new AstService('/workspace', fileIO);
    // before-snapshot succeeds; the first two AFTER reads are null (HMR has not applied the wrap yet),
    // then a changed reading lands. The verify must poll through the nulls, not abort on the first.
    let call = 0;
    service.setVerifyComputedStyleProvider(async (_id, cssProperties) => {
      call += 1;
      if (call === 1) {
        const snap: Record<string, string> = {};
        for (const prop of cssProperties) snap[prop] = 'rgba(0, 0, 0, 0)';
        snap.backgroundImage = 'none';
        return snap; // before-snapshot
      }
      if (call <= 3) return null; // marker wrapper not in the DOM yet
      const snap: Record<string, string> = {};
      for (const prop of cssProperties) snap[prop] = 'rgb(255, 0, 170)';
      snap.backgroundImage = 'none';
      return snap; // now rendered + changed
    });
    const nodeRef = syntheticRefFor(fileIO.content(orgSettingsPath), REL);
    const result = await service.updateStyles(REL, nodeRef, { backgroundColor: '#ff00aa' }, undefined, nodeRef);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    // Verified-landed despite the transient nulls: kept, no warning, marker stripped.
    expect(result.warning).toBeUndefined();
    expect(fileIO.content(orgSettingsPath)).toContain('backgroundColor: "#ff00aa"');
    expect(fileIO.content(orgSettingsPath)).not.toContain('data-hc-writeid');
  });
});
