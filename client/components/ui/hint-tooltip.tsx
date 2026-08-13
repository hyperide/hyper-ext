/**
 * HintTooltip — a self-contained hover hint for inspector controls, styled to look native in
 * the current VS Code theme while degrading gracefully in the SaaS realm.
 *
 * WHY this exists (HYP-1001): the Layout-section mode icons, the Gap field and the numeric
 * fields originally carried plain HTML `title=""` attributes. Those render the browser's
 * NATIVE tooltip, which is drawn by the Chromium compositor OUTSIDE the DOM — it cannot be
 * captured by Playwright / CDP `page.screenshot`, so hover-hint proof for the VS Code webview
 * was impossible to show honestly, and it does not match the editor's look. This wraps the
 * project's Radix Tooltip primitive into a drop-in that renders a REAL in-DOM tooltip element
 * (portaled to `document.body`, so it is never clipped by the narrow inspector panel's
 * `overflow-hidden`), which IS capturable.
 *
 * IDIOMATIC APPROACH: Microsoft's `@vscode/webview-ui-toolkit` is deprecated/archived, so the
 * modern way to make webview UI feel native is to style your own DOM with the `--vscode-*`
 * theme CSS variables VS Code injects into every webview. We therefore paint the tooltip with
 * the editor's hover-widget tokens — `--vscode-editorHoverWidget-background` / `-foreground` /
 * `-border` and `--vscode-widget-shadow` — each with a shadcn theme-token FALLBACK so the SAME
 * shared component looks correct in the SaaS app (where no `--vscode-*` vars exist).
 *
 * Self-contained on purpose: it bundles its OWN `TooltipProvider`, so it works identically in
 * the SaaS realm (client/App.tsx already has a provider), the VS Code extension webview
 * (RightPanelApp has none — only PlatformProvider), and unit tests, without every render site
 * having to wire a provider. `asChild` merges onto the child, so NO extra wrapper DOM is
 * emitted and the caller's flex layout is preserved.
 *
 * PORTAL-BUBBLE GUARD (HYP-1085 follow-up — Codex + review-cli findings on PR #679): several
 * call sites (FillSection's `FillPicker`, both `ColorCombobox` wrappers) wrap a control that
 * itself opens a Radix Popover (linked-color-picker.tsx, image-background-picker.tsx), and that
 * popover's content renders via a Portal to `document.body`. React bubbles events from portaled
 * content through the REACT tree, not the DOM tree, so interacting inside the popover (typing a
 * color search, dragging an image onto the drop zone) still reaches this trigger's
 * onPointerMove/onFocus handlers even though the event's real DOM target lives outside this
 * wrapper — reopening the unrelated hint over the user's popover.
 *
 * The naive fix (composing a guard handler that calls `event.preventDefault()` for
 * out-of-subtree targets, tried in an earlier revision of this file) is unsafe: `preventDefault`
 * marks the SAME shared native event object as prevented, which can cancel the popover's OWN
 * default behavior for that event (e.g. touch-scrolling the color list, drag/drop on the image
 * upload zone) — the fix would silently break the very popover it's supposed to leave alone.
 * Instead we drive `open` ourselves from NATIVE `addEventListener` calls on the trigger's real
 * DOM node (`useIsOverOwnSubtree`, tracking pointer-hover and focus-within as two INDEPENDENT
 * flags OR'd together — a single shared flag would have the pointer still resting on the trigger
 * clobbered back to "away" the moment focus moves into the popover, per an Opus review finding on
 * an earlier revision). Native listeners follow REAL DOM bubbling — a portal's content is never a
 * DOM descendant of this wrapper — so portal-interior interaction never touches them, no
 * interception needed. We still let Radix's Tooltip.Root own hover-delay/focus timing
 * (`open`/`onOpenChange`), but `handleOpenChange` rejects an "open" request only when we KNOW the
 * trigger has a DOM node AND neither native flag is set — i.e. one caused by a bubbled portal
 * event rather than genuine hover/focus of the trigger itself. If `children` doesn't forward its
 * ref to a DOM node (so we never learn "over" ground truth), the guard fails OPEN rather than
 * silently disabling the tooltip forever (also an Opus review finding). Closes are always
 * accepted.
 *
 * Known accepted limitation: the guard tracks pointer/focus on the TRIGGER only, not on the
 * tooltip's own (hoverable) content — if the user moves the pointer from the trigger onto the
 * hint bubble itself, `pointerleave` clears `isPointerOverRef`. In practice this is harmless:
 * Radix's `disableHoverableContent` is off by default, so Radix cancels the close rather than
 * asking us to reopen while the pointer is over its content, and no regression has been observed.
 */
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { type CSSProperties, type ReactElement, useEffect, useRef, useState } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

const OPEN_DELAY_MS = 150;

interface HintTooltipProps {
  /** The hint text shown on hover/focus. */
  label: string;
  /**
   * The trigger element (button, div, …). Rendered via Radix `asChild`, which merges the
   * tooltip wiring + ref onto this element — so it MUST be a single ref-capable element, not a
   * string/fragment/array/`null`.
   */
  children: ReactElement;
  /** Which side of the trigger the tooltip opens on. Defaults to `top`. */
  side?: 'top' | 'right' | 'bottom' | 'left';
}

// VS Code hover-widget tokens first, shadcn theme tokens as the SaaS fallback.
const vscodeHintStyle: CSSProperties = {
  background: 'var(--vscode-editorHoverWidget-background, hsl(var(--popover)))',
  color: 'var(--vscode-editorHoverWidget-foreground, hsl(var(--popover-foreground)))',
  border: '1px solid var(--vscode-editorHoverWidget-border, hsl(var(--border)))',
  boxShadow: '0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36))',
  fontFamily: 'var(--vscode-font-family, inherit)',
};

/**
 * Tracks real pointer-hover and focus-within of `node` via NATIVE listeners as two INDEPENDENT
 * flags — see the file-level PORTAL-BUBBLE GUARD comment for why native (not React synthetic)
 * listeners are required, and why the two states can't share one flag.
 */
function useIsOverOwnSubtree(node: HTMLElement | null) {
  const isPointerOverRef = useRef(false);
  const isFocusWithinRef = useRef(false);

  useEffect(() => {
    if (!node) return undefined;
    const markPointerOver = () => {
      isPointerOverRef.current = true;
    };
    const markPointerAway = () => {
      isPointerOverRef.current = false;
    };
    const markFocusIn = () => {
      isFocusWithinRef.current = true;
    };
    const markFocusOut = () => {
      isFocusWithinRef.current = false;
    };
    node.addEventListener('pointerenter', markPointerOver);
    node.addEventListener('pointerleave', markPointerAway);
    node.addEventListener('focusin', markFocusIn);
    node.addEventListener('focusout', markFocusOut);
    return () => {
      node.removeEventListener('pointerenter', markPointerOver);
      node.removeEventListener('pointerleave', markPointerAway);
      node.removeEventListener('focusin', markFocusIn);
      node.removeEventListener('focusout', markFocusOut);
    };
  }, [node]);

  return { isPointerOverRef, isFocusWithinRef };
}

export function HintTooltip({ label, children, side = 'top' }: HintTooltipProps) {
  const [open, setOpen] = useState(false);
  const [wrapperNode, setWrapperNode] = useState<HTMLElement | null>(null);
  const { isPointerOverRef, isFocusWithinRef } = useIsOverOwnSubtree(wrapperNode);

  const handleOpenChange = (next: boolean) => {
    // Reject only when we have a real DOM node to check AND neither native flag confirms genuine
    // hover/focus — a portal-bubbled reopen. No `wrapperNode` (child never forwarded its ref)
    // means we have no ground truth to check against, so fail OPEN instead of disabling the hint.
    if (next && wrapperNode && !isPointerOverRef.current && !isFocusWithinRef.current) return;
    setOpen(next);
  };

  return (
    <TooltipProvider delayDuration={OPEN_DELAY_MS}>
      <Tooltip open={open} onOpenChange={handleOpenChange}>
        <TooltipTrigger asChild ref={setWrapperNode}>
          {children}
        </TooltipTrigger>
        {/* Portal so the hint escapes the inspector panel's `overflow-hidden` containers —
            the shared TooltipContent does not portal on its own. */}
        <TooltipPrimitive.Portal>
          <TooltipContent side={side} role="tooltip" className="max-w-[240px] text-xs" style={vscodeHintStyle}>
            {label}
          </TooltipContent>
        </TooltipPrimitive.Portal>
      </Tooltip>
    </TooltipProvider>
  );
}
