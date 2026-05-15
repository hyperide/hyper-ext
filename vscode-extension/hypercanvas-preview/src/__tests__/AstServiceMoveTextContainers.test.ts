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
    it('moves <p className="body-tail"> from card-tail BEFORE <h3 className="title-bark"> in card-bark', async () => {
      const { service, fileIO, absPath, relPath } = await makeService(CARDS_FIXTURE);
      const sourceRef = refByClass(service, absPath, relPath, 'p', 'body-tail', CARDS_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'h3', 'title-bark', CARDS_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'before');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // <p body-tail> must now live INSIDE card-bark, BEFORE <h3 title-bark>.
      const cardBarkOpen = content.indexOf('"card-bark"');
      const cardBarkClose = content.indexOf('</article>', cardBarkOpen);
      const insideBark = content.slice(cardBarkOpen, cardBarkClose);
      expect(insideBark.includes('"body-tail"')).toBe(true);
      expect(insideBark.indexOf('"body-tail"')).toBeLessThan(insideBark.indexOf('"title-bark"'));

      // <p body-tail> no longer in card-tail.
      const cardTailOpen = content.indexOf('"card-tail"');
      const cardTailClose = content.indexOf('</article>', cardTailOpen);
      const insideTail = content.slice(cardTailOpen, cardTailClose);
      expect(insideTail.includes('"body-tail"')).toBe(false);
      // card-tail still has its title and emoji.
      expect(insideTail.includes('"title-tail"')).toBe(true);
      expect(insideTail.includes('"emoji-tail"')).toBe(true);
    });

    it('moves <span emoji-tail> 🌀 from card-tail AFTER <span emoji-bark> in card-bark', async () => {
      const { service, fileIO, absPath, relPath } = await makeService(CARDS_FIXTURE);
      const sourceRef = refByClass(service, absPath, relPath, 'span', 'emoji-tail', CARDS_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'span', 'emoji-bark', CARDS_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'after');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // <span emoji-tail> now sits in card-bark, after <span emoji-bark>.
      const cardBarkOpen = content.indexOf('"card-bark"');
      const cardBarkClose = content.indexOf('</article>', cardBarkOpen);
      const insideBark = content.slice(cardBarkOpen, cardBarkClose);
      expect(insideBark.includes('"emoji-tail"')).toBe(true);
      expect(insideBark.indexOf('"emoji-bark"')).toBeLessThan(insideBark.indexOf('"emoji-tail"'));

      // No longer in card-tail.
      const cardTailOpen = content.indexOf('"card-tail"');
      const cardTailClose = content.indexOf('</article>', cardTailOpen);
      const insideTail = content.slice(cardTailOpen, cardTailClose);
      expect(insideTail.includes('"emoji-tail"')).toBe(false);

      // Both emojis preserved (🌀 from tail, 🐶 from bark).
      expect(content.includes('🌀')).toBe(true);
      expect(content.includes('🐶')).toBe(true);
      // aria-hidden on the moved span survives.
      const movedTailIdx = content.indexOf('"emoji-tail"');
      const movedTailLine = content.slice(
        content.lastIndexOf('<', movedTailIdx),
        content.indexOf('>', movedTailIdx) + 1,
      );
      expect(movedTailLine.includes('aria-hidden="true"')).toBe(true);
    });

    it('moves <h3 title-tail> AFTER <p body-bark>: heading travels with its child text', async () => {
      const { service, fileIO, absPath, relPath } = await makeService(CARDS_FIXTURE);
      const sourceRef = refByClass(service, absPath, relPath, 'h3', 'title-tail', CARDS_FIXTURE);
      const targetRef = refByClass(service, absPath, relPath, 'p', 'body-bark', CARDS_FIXTURE);

      const result = await service.moveElement(relPath, sourceRef, targetRef, 'after');

      expect(result.success).toBe(true);
      const content = fileIO.content(absPath);

      // <h3 title-tail> now lives inside card-bark, after <p body-bark>.
      const cardBarkOpen = content.indexOf('"card-bark"');
      const cardBarkClose = content.indexOf('</article>', cardBarkOpen);
      const insideBark = content.slice(cardBarkOpen, cardBarkClose);
      expect(insideBark.includes('"title-tail"')).toBe(true);
      expect(insideBark.indexOf('"body-bark"')).toBeLessThan(insideBark.indexOf('"title-tail"'));
      // The "Tail" text content moved with the <h3>.
      const movedHeadIdx = insideBark.indexOf('"title-tail"');
      const movedHeadEnd = insideBark.indexOf('</h3>', movedHeadIdx);
      expect(insideBark.slice(movedHeadIdx, movedHeadEnd).includes('Tail')).toBe(true);

      // Original card-tail no longer hosts <h3 title-tail> but keeps the rest.
      const cardTailOpen = content.indexOf('"card-tail"');
      const cardTailClose = content.indexOf('</article>', cardTailOpen);
      const insideTail = content.slice(cardTailOpen, cardTailClose);
      expect(insideTail.includes('"title-tail"')).toBe(false);
      expect(insideTail.includes('"body-tail"')).toBe(true);
      expect(insideTail.includes('"emoji-tail"')).toBe(true);
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
