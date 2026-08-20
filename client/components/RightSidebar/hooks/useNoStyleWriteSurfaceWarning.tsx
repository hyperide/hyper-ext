/**
 * @file HYP-1294 — proactive "this component may not accept style edits" warning.
 *
 * Accessed via: client/components/RightSidebar/RightSidebar.tsx, wired next to the
 * `useElementStyleData` read of the currently selected element.
 * Assumptions: `componentPropSurface` (A1 forward-detector facts, HYP-1229/HYP-1280) is populated
 * in BROWSER/SaaS mode via the read-time `GET /api/element-forwarding` fetch
 * (`useElementStyleData.ts`'s `fetchComponentPropSurface`) and in VS Code mode via the extension
 * host's `styles:response` RPC payload (HYP-1294 AC2) — both paths project through the SAME
 * `projectForwardDetectionToPropSurface`, so this hook's trigger condition is platform-agnostic.
 * TRI-STATE CONTRACT (review finding, HYP-1294): `componentPropSurface` is `undefined` whenever
 * facts haven't arrived yet (fresh selection, in-flight fetch) OR the platform/payload is too old
 * to carry the field at all — that MUST read as "unknown, stay silent", never as "no surface".
 * `shouldWarn` below is gated on `!!componentPropSurface` first for exactly this reason; do not
 * change `hasNoStyleWriteSurface` to accept `undefined` as an implicit "no channel" — an older
 * extension build or a still-loading selection would then false-positive-warn on every element.
 * Past bugs: none yet — this is the FIRST live consumer of `componentPropSurface` (HYP-1280
 * review, P1: the field was fetched/exposed on `ElementStyleData` but read by no shipped code).
 * This hook is intentionally NON-BLOCKING: it never disables a style control, it only warns —
 * `componentPropSurface` isn't consulted by the live write path either (that's the separate,
 * still-STAGED D3 stylability ladder, `lib/style-write/stylability-ladder.ts`'s file header). Both
 * this warning and that future write-time enforcement read the SAME `hasNoStyleWriteSurface` /
 * `resolveStyleSurface` functions off the SAME `ComponentPropSurfaceFacts` — when D3 goes live,
 * route its enforcement through those same functions rather than re-deriving the verdict, or the
 * warning and the enforcement can silently disagree.
 * KNOWN, DELIBERATE SCOPE GAP (review finding, HYP-1294): this toast and RightSidebar's EXISTING
 * post-write `warningToastRef` ("Style could not be applied", HYP-901/HYP-987) are NOT
 * coordinated — a user who edits anyway after seeing this warning can get both toasts for the
 * same element with overlapping copy. Left uncoordinated for this first slice (the post-write
 * path is VS-Code-only today per `useStyleSync.ts`'s `onNonForwardingComponent`, so the overlap
 * is narrower than it will become once VS Code's own post-write UX is touched again); a follow-up
 * should have the post-write handler dismiss/supersede this toast for the same element key rather
 * than stack a second one.
 */
import { useEffect, useRef } from 'react';
import type { ComponentPropSurfaceFacts } from '@lib/style-read/types';
import { hasNoStyleWriteSurface } from '@lib/style-write/stylability-ladder';
import { toast } from '@/hooks/use-toast';
import { ToastAction } from '../../ui/toast';

export interface NoStyleWriteSurfaceWarningContent {
  title: string;
  description: string;
  prompt: string;
}

/**
 * Pure — builds the toast copy + "Ask AI" prompt from the selected element's tag and file. This is
 * a PRE-write warning (no write has been attempted), so the copy must never claim a write failed
 * or was reverted — contrast `shared/style-forwarding/autofix-prompt.ts`'s `buildStyleAutoFixPrompt`,
 * whose POST-write copy correctly says "the editor reverted it" (not reusable here for that reason).
 * Exported for direct unit testing without mounting the hook/toast machinery.
 */
export function buildNoStyleWriteSurfaceWarningContent(
  tagType: string,
  componentPath: string | null,
): NoStyleWriteSurfaceWarningContent {
  const tag = tagType || 'this component';
  return {
    title: 'This component may not accept style edits',
    description: `<${tag}> does not appear to forward className/style to a DOM element — style changes made here might not visibly apply.`,
    prompt:
      `Before I edit styles on <${tag}> in ${componentPath ?? 'this file'}, check whether it forwards ` +
      "`className`/`style` to a DOM element. If it doesn't, suggest the best way to make style edits " +
      'actually render — e.g. forwarding `style`/`className` through to its root DOM element.',
  };
}

interface UseNoStyleWriteSurfaceWarningOptions {
  componentPropSurface: ComponentPropSurfaceFacts | undefined;
  tagType: string;
  selectedId: string | null;
  componentPath: string | null;
  openAIChat: (options?: { prompt?: string; forceNewChat?: boolean }) => void;
}

/**
 * Raises a PERSISTENT (`duration: Infinity`) toast the moment `hasNoStyleWriteSurface` reports NO
 * known style-write channel at all for the selected element — BEFORE any write is attempted. This
 * is a STRONGER condition than "A1 says non-forwarding": a component whose className/style are
 * both dropped but that exposes a covering `styleLikeProps`/`semanticProps` entry does NOT warn
 * here (there IS a known write path for it, just not the generic channel).
 * Scoped to exactly ONE toast at a time, keyed on (componentPath, selectedId, tagType): a
 * re-render for the SAME element with the SAME verdict (e.g. a `refreshKey`-triggered re-fetch)
 * does not re-toast; moving to a DIFFERENT element/file dismisses the old toast and — only if the
 * new element also warrants it — replaces it with a new one; the verdict flipping to "has a
 * channel" dismisses without a replacement.
 * Requires BOTH `selectedId` AND `componentPath` to warn — in practice `componentPropSurface`
 * is never populated on either platform without a known `componentPath` (both the browser fetch
 * effect and the VS Code RPC request require it), so this never withholds a warning that
 * `shouldWarn` would otherwise raise; `buildNoStyleWriteSurfaceWarningContent`'s own null-path
 * handling exists so the builder stays independently correct/testable, not because this hook
 * relies on it in practice.
 */
export function useNoStyleWriteSurfaceWarning({
  componentPropSurface,
  tagType,
  selectedId,
  componentPath,
  openAIChat,
}: UseNoStyleWriteSurfaceWarningOptions): void {
  const toastRef = useRef<{ dismiss: () => void } | null>(null);
  const shownKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // `!!componentPropSurface` first — see the file header's TRI-STATE CONTRACT note: undefined
    // facts (still loading, or an older payload that never carried the field) must never warn.
    const shouldWarn = !!componentPropSurface && hasNoStyleWriteSurface(componentPropSurface);
    // tagType is part of the key (review finding, HYP-1294): the toast's own copy names the tag,
    // so a tag-name change for the SAME (componentPath, selectedId) — e.g. a JSX rename landing
    // via the same refetch that re-verifies the verdict — must replace the toast, not leave it
    // showing the OLD tag name behind an unrelated dedupe hit.
    const elementKey = selectedId && componentPath ? `${componentPath}::${selectedId}::${tagType}` : null;

    if (!shouldWarn || !elementKey) {
      toastRef.current?.dismiss();
      toastRef.current = null;
      shownKeyRef.current = null;
      return;
    }
    if (shownKeyRef.current === elementKey) return; // already shown for this exact element

    shownKeyRef.current = elementKey;
    toastRef.current?.dismiss();
    const content = buildNoStyleWriteSurfaceWarningContent(tagType, componentPath);
    toastRef.current = toast({
      duration: Infinity,
      title: content.title,
      description: content.description,
      action: (
        <ToastAction altText="Ask AI" onClick={() => openAIChat({ prompt: content.prompt, forceNewChat: true })}>
          Ask AI
        </ToastAction>
      ),
    });
  }, [componentPropSurface, tagType, selectedId, componentPath, openAIChat]);

  // Dismiss on unmount so the persistent toast can't outlive the sidebar that owns it (mirrors
  // RightSidebar's own warningToastRef unmount cleanup for the POST-write warning). MUST also
  // clear `shownKeyRef` (review finding, HYP-1294 — a real StrictMode-reproducible bug): React
  // StrictMode's dev-mode double-invoke runs mount → this cleanup → mount again WITHOUT actually
  // destroying the component/its refs. Leaving `shownKeyRef` set here meant the simulated cleanup
  // dismissed the toast but the immediate re-mount's main effect saw the STALE key still matching
  // and early-returned without recreating it — the warning appeared once, then vanished
  // permanently for that element. Clearing both refs together keeps toast existence and the
  // dedupe key in lockstep regardless of why this cleanup fired.
  useEffect(() => {
    return () => {
      toastRef.current?.dismiss();
      toastRef.current = null;
      shownKeyRef.current = null;
    };
  }, []);
}
