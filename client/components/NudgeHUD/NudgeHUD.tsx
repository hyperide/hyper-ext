/**
 * @file NudgeHUD root component — floating overlay showing nudge step sizes and token preview
 *
 * Accessed via: Rendered by the inspector mount points (SaaS CanvasEditor; VS Code
 *   webview-right RightPanelApp). Renders within a <NudgeStateProvider>.
 * Assumptions: a NudgeStatePort is provided in context; adapter prop matches the active
 *   project's styling approach.
 * Architecture: D1-A, docs/specs/2026-06-04-crossrealm-webview-bridge.md
 */

import type { AdapterName } from '@lib/tokens/token-scales';
import { IconArrowsSort } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { useNudgeKeyboard, useNudgeState } from '@/lib/nudge';
import { NumericMode } from './NumericMode';
import { TokenMode } from './TokenMode';

export type NudgeAdapter = AdapterName | 'none';

/**
 * Layout classes (position + overflow behavior). Tuned for the SaaS canvas overlay, which has
 * room for a single nowrap row pinned bottom-left. Narrow mounts (the ~300px VS Code inspector
 * panel) override this via the `className` prop — the appearance classes below stay shared.
 */
const SAAS_LAYOUT = 'absolute bottom-[88px] left-2 whitespace-nowrap';

interface NudgeHUDProps {
  adapter: NudgeAdapter;
  /**
   * Per-mount layout override (position / wrapping / width). Replaces SAAS_LAYOUT. Pass this from
   * a narrow realm (the inspector panel) so the HUD wraps/fits instead of clipping at the panel
   * edge — without editing the shared appearance value. `cn` (twMerge) makes the override win.
   */
  className?: string;
}

export function NudgeHUD({ adapter, className }: NudgeHUDProps) {
  const visible = useNudgeState((s) => s.visible);
  const mode = useNudgeState((s) => s.mode);
  // Route t/n/s/Escape through the same port the HUD reads — stays mounted even while hidden.
  useNudgeKeyboard(adapter);

  if (!visible) return null;

  return (
    <div
      data-testid="nudge-hud"
      className={cn(
        'z-[1000] flex items-center gap-1.5 bg-black/90 text-white backdrop-blur-xl border border-white/10 rounded-lg px-3 py-1.5 shadow-lg',
        className ?? SAAS_LAYOUT,
      )}
    >
      <span className="text-[10px] text-white/60">
        <IconArrowsSort size={12} stroke={1.5} />
      </span>
      <Separator />
      {mode === 'numeric' ? <NumericMode adapter={adapter} /> : <TokenMode adapter={adapter} />}
    </div>
  );
}

export function Separator() {
  return <div className="w-px h-3.5 bg-white/20" />;
}
