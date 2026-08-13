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
 */
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { CSSProperties, ReactElement } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

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

export function HintTooltip({ label, children, side = 'top' }: HintTooltipProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
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
