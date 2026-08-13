/**
 * @file AstService.moveElement unit tests — Task 4 of plan
 *       2026-05-06-drag-direction-flex-row.md.
 *
 *       User report regression: after the move-any-to-any merge, dragging
 *       `<p>{t("...")}</p>`, `<h3>...</h3>`, and `<span aria-hidden="true">🌀</span>`
 *       elements between flex-row siblings (or grid-cols-2 cards) misbehaved.
 *       Tasks 2 and 3 fixed the iframe-side root causes (orientation
 *       inference + native text-selection swallowing pointermove). This file
 *       covers the AST-side contract: moveElement must successfully relocate
 *       text-container and inline-decorative elements when their JSX siblings
 *       (or post-lift common-parent siblings) are <h3>, <p>, <span>, or other
 *       headings/text nodes.
 *
 * Accessed via: iframe drag-drop → hypercanvas:moveElement → ast:moveElement → AstService.moveElement
 *
 * Assumptions:
 *   - moveElement(source, target, position) takes resolved nodeRefs that are
 *     guaranteed to share a common JSX parent — the iframe-side resolver in
 *     `_dragPointerUp` walks up to a common ancestor before invoking the RPC,
 *     so AstService never sees source and target with disjoint JSX-parent
 *     chains in the same file (different-parent within the same file is
 *     supported via the cut-and-splice branch in moveElement);
 *   - moveElement throws on internal failure (no `success: false` branch);
 *   - text children (raw strings, JSXExpressionContainer with t("…") calls)
 *     and aria-hidden inline decoratives travel with their parent JSX
 *     element — we never split text out of its container.
 */
import { describe, expect, it } from 'bun:test';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import { AstService } from '../services/AstService';

// Two-card layout that mirrors the bulka-the-dog Index.tsx markup the user
// reported: a `grid grid-cols-2` of cards, each card has an `<h3>` heading,
// a `<p>` body, and a decorative `<span aria-hidden="true">…emoji…</span>`.
// Class names are unique so we can assert post-move ordering by indexOf.
const CARDS_FIXTURE = `export default function Habits() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4">
      <article className="card-tail">
        <h3 className="title-tail">Tail</h3>
        <p className="body-tail">Wag stuff</p>
        <span className="emoji-tail" aria-hidden="true">🌀</span>
      </article>
      <article className="card-bark">
        <h3 className="title-bark">Bark</h3>
        <p className="body-bark">Loud stuff</p>
        <span className="emoji-bark" aria-hidden="true">🐶</span>
      </article>
    </div>
  );
}
`;

// Single-card layout — same JSX parent for h3/p/span — covers the
// "sibling-reorder around a text container" path.
const CARD_FIXTURE = `export default function Card() {
  return (
    <article className="card">
      <h3 className="head">Heading</h3>
      <p className="body">Body text</p>
      <span className="emo" aria-hidden="true">🌀</span>
    </article>
  );
}
`;

// User-reported fixture variant: <p> child is a JSXExpressionContainer with
// a t("...") call, mirroring bulka-the-dog's `<p className="text-foreground/80">
// {t("habits.behavior")}</p>`. The AST contract under test: moveElement must
// preserve the JSXExpressionContainer child intact when the <p> is moved.
const CARD_I18N_FIXTURE = `import { useTranslation } from 'react-i18next';
export default function CardI18n() {
  const { t } = useTranslation();
  return (
    <article className="card">
      <h3 className="title">{t("habits.tail.title")}</h3>
      <p className="body">{t("habits.tail.body")}</p>
      <span className="emo" aria-hidden="true">🌀</span>
    </article>
  );
}
`;

interface NodeMapEntryLike {
  loc: { line: number; column: number };
  tag: string;
}

async function makeService(fixture: string, relPath = 'src/Cards.tsx') {
  const absPath = `/workspace/${relPath}`;
  const fileIO = new InMemoryFileIO({ [absPath]: fixture });
  const service = new AstService('/workspace', fileIO);
  await service.ensureInitialized();
  return { service, fileIO, absPath, relPath };
}

function refByClass(
  service: AstService,
  absPath: string,
  relPath: string,
  tag: string,
  className: string,
  source: string,
): string {
  const entries = (service.nodeMapService.getNodeMap(absPath) ?? []) as NodeMapEntryLike[];
  const candidates = entries.filter((e) => e.tag === tag);
  if (candidates.length === 0) {
    throw new Error(`No <${tag}> entries in node map for ${absPath}`);
  }
  const lines = source.split('\n');
  for (const cand of candidates) {
    const sourceLine = lines[cand.loc.line - 1] ?? '';
    if (sourceLine.includes(`className="${className}"`)) {
      return `${relPath}:${cand.loc.line}:${cand.loc.column}`;
    }
  }
  throw new Error(`No <${tag} className="${className}"> in ${absPath}`);
}

describe('AstService.moveElement — text-container & inline-emoji moves (Task 4)', () => {
  describe('same-card sibling reorder around <h3> / <p> / <span>', () => {
    it('moves <p> AFTER <span>: ordering changes, <p> lands last', async () => {
      const { service, fileIO, absPath, relPath } = await makeService(CARD_FIXTURE);
      const sourceRef = refByClass(service, absPath, relPath, 'p', 'body', CARD_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'span', 'emo', CARD_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'after');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);
      // Each source-bearing class must exist EXACTLY once: a duplicate-insert
      // bug (move that copies instead of cuts) would still pass indexOf-based
      // ordering checks because indexOf returns the FIRST occurrence.
      expect(content.match(/"head"/g)?.length).toBe(1);
      expect(content.match(/"body"/g)?.length).toBe(1);
      expect(content.match(/"emo"/g)?.length).toBe(1);
      // Pre-state was [h3, p, span]; after move post-state is [h3, span, p].
      // This ordering proves moveElement actually mutated the AST (not a no-op).
      const headIdx = content.indexOf('"head"');
      const bodyIdx = content.indexOf('"body"');
      const emoIdx = content.indexOf('"emo"');
      expect(headIdx).toBeLessThan(emoIdx);
      expect(emoIdx).toBeLessThan(bodyIdx);
      // <p> child text travelled with the moved element.
      expect(content.includes('Body text')).toBe(true);
    });

    it('moves <p> BEFORE <h3> sibling: order flips', async () => {
      const { service, fileIO, absPath, relPath } = await makeService(CARD_FIXTURE);
      const sourceRef = refByClass(service, absPath, relPath, 'p', 'body', CARD_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'h3', 'head', CARD_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'before');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);
      // No duplicate-insertion: each source class once.
      expect(content.match(/"head"/g)?.length).toBe(1);
      expect(content.match(/"body"/g)?.length).toBe(1);
      expect(content.match(/"emo"/g)?.length).toBe(1);
      // <p> now precedes <h3>; <span> stays last.
      const headIdx = content.indexOf('"head"');
      const bodyIdx = content.indexOf('"body"');
      const emoIdx = content.indexOf('"emo"');
      expect(bodyIdx).toBeLessThan(headIdx);
      expect(headIdx).toBeLessThan(emoIdx);
    });

    it('moves <span> emoji BEFORE <h3>: emoji leads the card', async () => {
      const { service, fileIO, absPath, relPath } = await makeService(CARD_FIXTURE);
      const sourceRef = refByClass(service, absPath, relPath, 'span', 'emo', CARD_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'h3', 'head', CARD_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'before');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);
      // No duplicate-insertion: each source class + emoji once.
      expect(content.match(/"head"/g)?.length).toBe(1);
      expect(content.match(/"body"/g)?.length).toBe(1);
      expect(content.match(/"emo"/g)?.length).toBe(1);
      expect(content.match(/🌀/g)?.length).toBe(1);
      const headIdx = content.indexOf('"head"');
      const bodyIdx = content.indexOf('"body"');
      const emoIdx = content.indexOf('"emo"');
      expect(emoIdx).toBeLessThan(headIdx);
      expect(headIdx).toBeLessThan(bodyIdx);
      // Emoji text node still attached to <span>.
      expect(content.includes('🌀')).toBe(true);
      // aria-hidden attribute survives the move.
      expect(content.includes('aria-hidden="true"')).toBe(true);
    });

    it('moves <h3> AFTER <span>: heading lands at the bottom of the card', async () => {
      const { service, fileIO, absPath, relPath } = await makeService(CARD_FIXTURE);
      const sourceRef = refByClass(service, absPath, relPath, 'h3', 'head', CARD_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'span', 'emo', CARD_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'after');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);
      // No duplicate-insertion.
      expect(content.match(/"head"/g)?.length).toBe(1);
      expect(content.match(/"body"/g)?.length).toBe(1);
      expect(content.match(/"emo"/g)?.length).toBe(1);
      expect(content.match(/Heading/g)?.length).toBe(1);
      const headIdx = content.indexOf('"head"');
      const bodyIdx = content.indexOf('"body"');
      const emoIdx = content.indexOf('"emo"');
      expect(bodyIdx).toBeLessThan(emoIdx);
      expect(emoIdx).toBeLessThan(headIdx);
      // <h3> child text "Heading" stays attached to the moved element.
      expect(content.includes('Heading')).toBe(true);
    });
  });

  describe('cross-card moves between grid-cols-2 siblings (different JSX parents)', () => {
    // liftToCommonJsxParent (Task 4 of move-any-intermittent plan) lifts source and
    // target to their common ancestor's direct children — i.e. to the outer CARDS,
    // not to the inner elements. Dragging an inner element of one card near an inner
    // element of another card reorders the OUTER cards, not the inner elements.
    // This matches the user's visual intent: the whole card moves with its contents.

    it('dragging <p body-tail> BEFORE <h3 title-bark>: cards already in order → no-op', async () => {
      const { service, fileIO, absPath, relPath } = await makeService(CARDS_FIXTURE);
      const sourceRef = refByClass(service, absPath, relPath, 'p', 'body-tail', CARDS_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'h3', 'title-bark', CARDS_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'before');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // Lift: card-tail (sourceLifted) is moved before card-bark (targetLifted).
      // card-tail was already before card-bark → order is unchanged.
      expect(content.indexOf('"card-tail"')).toBeLessThan(content.indexOf('"card-bark"'));

      // All elements stay intact inside their original cards — nothing was extracted.
      const cardTailOpen = content.indexOf('"card-tail"');
      const cardTailClose = content.indexOf('</article>', cardTailOpen);
      const insideTail = content.slice(cardTailOpen, cardTailClose);
      expect(insideTail.includes('"body-tail"')).toBe(true);
      expect(insideTail.includes('"title-tail"')).toBe(true);
      expect(insideTail.includes('"emoji-tail"')).toBe(true);

      const cardBarkOpen = content.indexOf('"card-bark"');
      const cardBarkClose = content.indexOf('</article>', cardBarkOpen);
      const insideBark = content.slice(cardBarkOpen, cardBarkClose);
      expect(insideBark.includes('"title-bark"')).toBe(true);
      expect(insideBark.includes('"body-bark"')).toBe(true);
      expect(insideBark.includes('"emoji-bark"')).toBe(true);

      // No duplicates — each element appears exactly once.
      expect(content.match(/"body-tail"/g)?.length).toBe(1);
    });

    it('dragging <span emoji-tail> AFTER <span emoji-bark>: card-tail moves after card-bark', async () => {
      const { service, fileIO, absPath, relPath } = await makeService(CARDS_FIXTURE);
      const sourceRef = refByClass(service, absPath, relPath, 'span', 'emoji-tail', CARDS_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'span', 'emoji-bark', CARDS_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'after');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // Lift: card-tail (sourceLifted) is moved AFTER card-bark (targetLifted).
      // card-bark now comes first in the grid.
      expect(content.indexOf('"card-bark"')).toBeLessThan(content.indexOf('"card-tail"'));

      // emoji-tail stays inside card-tail (now second in the grid).
      const cardTailOpen = content.indexOf('"card-tail"');
      const cardTailClose = content.indexOf('</article>', cardTailOpen);
      const insideTail = content.slice(cardTailOpen, cardTailClose);
      expect(insideTail.includes('"emoji-tail"')).toBe(true);

      // emoji-bark stays inside card-bark (now first in the grid).
      const cardBarkOpen = content.indexOf('"card-bark"');
      const cardBarkClose = content.indexOf('</article>', cardBarkOpen);
      const insideBark = content.slice(cardBarkOpen, cardBarkClose);
      expect(insideBark.includes('"emoji-bark"')).toBe(true);
      expect(insideBark.includes('"emoji-tail"')).toBe(false);

      // Both emojis preserved (🌀 from tail, 🐶 from bark) — exactly once each.
      expect(content.match(/🌀/g)?.length).toBe(1);
      expect(content.match(/🐶/g)?.length).toBe(1);
      // No duplicate emoji-tail span.
      expect(content.match(/"emoji-tail"/g)?.length).toBe(1);
      // aria-hidden on emoji-tail span survives.
      const tailIdx = content.indexOf('"emoji-tail"');
      const tailLine = content.slice(content.lastIndexOf('<', tailIdx), content.indexOf('>', tailIdx) + 1);
      expect(tailLine.includes('aria-hidden="true"')).toBe(true);
    });

    it('dragging <h3 title-tail> AFTER <p body-bark>: card-tail moves after card-bark', async () => {
      const { service, fileIO, absPath, relPath } = await makeService(CARDS_FIXTURE);
      const sourceRef = refByClass(service, absPath, relPath, 'h3', 'title-tail', CARDS_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'p', 'body-bark', CARDS_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'after');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // Lift: card-tail (sourceLifted) is moved AFTER card-bark (targetLifted).
      // card-bark now comes first in the grid.
      expect(content.indexOf('"card-bark"')).toBeLessThan(content.indexOf('"card-tail"'));

      // title-tail (h3) stays inside card-tail, travelling with the whole card.
      const cardTailOpen = content.indexOf('"card-tail"');
      const cardTailClose = content.indexOf('</article>', cardTailOpen);
      const insideTail = content.slice(cardTailOpen, cardTailClose);
      expect(insideTail.includes('"title-tail"')).toBe(true);
      // "Tail" text content stays with its h3 inside card-tail.
      const titleTailIdx = insideTail.indexOf('"title-tail"');
      const titleTailEnd = insideTail.indexOf('</h3>', titleTailIdx);
      expect(insideTail.slice(titleTailIdx, titleTailEnd).includes('Tail')).toBe(true);
      // card-tail keeps all its elements.
      expect(insideTail.includes('"body-tail"')).toBe(true);
      expect(insideTail.includes('"emoji-tail"')).toBe(true);

      // title-tail does NOT appear inside card-bark.
      const cardBarkOpen = content.indexOf('"card-bark"');
      const cardBarkClose = content.indexOf('</article>', cardBarkOpen);
      const insideBark = content.slice(cardBarkOpen, cardBarkClose);
      expect(insideBark.includes('"title-tail"')).toBe(false);

      // No duplicate-insertion: title-tail appears exactly once.
      expect(content.match(/"title-tail"/g)?.length).toBe(1);
    });
  });

  describe('JSXExpressionContainer text children — bulka <p>{t("...")}</p> shape', () => {
    it('moves <p>{t(...)}</p> BEFORE <h3>{t(...)}</h3>: t() call survives intact on the moved <p>', async () => {
      const { service, fileIO, absPath, relPath } = await makeService(CARD_I18N_FIXTURE, 'src/CardI18n.tsx');
      const sourceRef = refByClass(service, absPath, relPath, 'p', 'body', CARD_I18N_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'h3', 'title', CARD_I18N_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'before');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);
      // No duplicate-insertion of <p>/<h3>/<span>.
      expect(content.match(/"title"/g)?.length).toBe(1);
      expect(content.match(/"body"/g)?.length).toBe(1);
      expect(content.match(/"emo"/g)?.length).toBe(1);
      // Order flipped: <p> now precedes <h3>.
      const titleIdx = content.indexOf('"title"');
      const bodyIdx = content.indexOf('"body"');
      const emoIdx = content.indexOf('"emo"');
      expect(bodyIdx).toBeLessThan(titleIdx);
      expect(titleIdx).toBeLessThan(emoIdx);
      // The t() expression child of the moved <p> is intact, not unwrapped or
      // duplicated. Both keys are still present exactly once.
      expect(content.match(/t\("habits\.tail\.body"\)/g)?.length ?? 0).toBe(1);
      expect(content.match(/t\("habits\.tail\.title"\)/g)?.length ?? 0).toBe(1);
      // <h3>'s t() call must still be inside the <h3>, not stuck on <p>.
      const h3Open = content.indexOf('<h3');
      const h3Close = content.indexOf('</h3>', h3Open);
      expect(content.slice(h3Open, h3Close).includes('t("habits.tail.title")')).toBe(true);
    });
  });

  describe('position semantics: before/after must match user-visible direction', () => {
    it('after-move places source as the IMMEDIATE next sibling (no gap)', async () => {
      const { service, fileIO, absPath, relPath } = await makeService(CARD_FIXTURE);
      const sourceRef = refByClass(service, absPath, relPath, 'span', 'emo', CARD_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'h3', 'head', CARD_FIXTURE);

      await service.moveElement(relPath, sourceRef, targetRef, 'after');

      const content = fileIO.content(absPath);
      // Critical: span must be present EXACTLY once. Without this assertion a
      // duplicate-insert bug (insert without remove) ships green: indexOf
      // finds the inserted copy after </h3>, but the original <span emo>
      // still sits at the bottom of the card.
      expect(content.match(/"emo"/g)?.length).toBe(1);
      // Slice between </h3> and the next opening tag — the moved <span> must be there.
      const h3CloseIdx = content.indexOf('</h3>');
      const afterH3 = content.slice(h3CloseIdx);
      // The very next tag after </h3> (modulo whitespace) must be `<span className="emo"`.
      const nextOpen = afterH3.search(/<\w/);
      expect(nextOpen).toBeGreaterThan(-1);
      expect(afterH3.slice(nextOpen).startsWith('<span className="emo"')).toBe(true);
    });

    it('before-move places source as the IMMEDIATE previous sibling (no gap)', async () => {
      const { service, fileIO, absPath, relPath } = await makeService(CARD_FIXTURE);
      const sourceRef = refByClass(service, absPath, relPath, 'span', 'emo', CARD_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'h3', 'head', CARD_FIXTURE);

      await service.moveElement(relPath, sourceRef, targetRef, 'before');

      const content = fileIO.content(absPath);
      // Same fake-test guard as the after-move case: indexOf finds the first
      // occurrence so a duplicate-insert bug would slip through. Pin the
      // count to 1.
      expect(content.match(/"emo"/g)?.length).toBe(1);
      // <span emo> must be immediately followed (modulo whitespace) by <h3 head>.
      const spanIdx = content.indexOf('"emo"');
      const afterSpanClose = content.indexOf('</span>', spanIdx);
      expect(afterSpanClose).toBeGreaterThan(-1);
      const tail = content.slice(afterSpanClose + '</span>'.length);
      const nextOpen = tail.search(/<\w/);
      expect(tail.slice(nextOpen).startsWith('<h3 className="head"')).toBe(true);
    });
  });
});
