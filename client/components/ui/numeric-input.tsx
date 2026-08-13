import { useCallback, useRef } from 'react';
import { useNudgeActions } from '@/lib/nudge';
import { Input } from './input';

interface NumericInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
  id?: string;
  placeholder?: string;
  testId?: string;
  disabled?: boolean;
  /**
   * CSS style property this field edits (e.g. 'borderWidth'). When set, focusing the field
   * shows the NudgeHUD with token/step previews for that property and blurring hides it.
   * Omit for generic numeric fields that should not drive the HUD.
   *
   * The HUD state flows through the injected NudgeStatePort (DI), not a module singleton,
   * so the same wiring works in SaaS (single realm) and the VS Code inspector webview.
   */
  styleKey?: string;
}

export const NumericInput = function NumericInput({
  value,
  onChange,
  onKeyDown,
  styleKey,
  ...props
}: NumericInputProps) {
  const nudge = useNudgeActions();
  // Delay hide so focus moving into the HUD (e.g. pressing 'n' to edit a step) doesn't dismiss it.
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
        const num = match ? parseFloat(match[1]) : 0;
        const unit = match ? match[2] : 'px';
        // HUD-driven fields (styleKey set) honor the configured per-project alt/shift step
        // through the port; generic fields keep the fixed 1/10 step.
        const step = styleKey ? nudge.getStepForModifiers(e.shiftKey, e.altKey, unit || 'px') : e.shiftKey ? 10 : 1;
        const delta = e.key === 'ArrowUp' ? step : -step;
        const newNum = Math.max(0, num + delta);
        // Trim float noise (e.g. 1 + 0.5 → 1.5, not 1.5000000000000002).
        const next = `${parseFloat(newNum.toFixed(4))}${unit || 'px'}`;
        onChange(next);
        if (styleKey) nudge.updateCurrentValue(next);
        return;
      }
      onKeyDown?.(e);
    },
    [value, onChange, onKeyDown, styleKey, nudge],
  );

  const handleFocus = useCallback(() => {
    if (!styleKey) return;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    nudge.show(styleKey, value || '0px');
  }, [styleKey, value, nudge]);

  const handleBlur = useCallback(() => {
    if (!styleKey) return;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      // Don't hide if focus moved into the NudgeHUD (e.g. editing a step via the 'n' key).
      if (document.activeElement?.closest('[data-testid="nudge-hud"]')) return;
      nudge.hide();
    }, 150);
  }, [styleKey, nudge]);

  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      onFocus={styleKey ? handleFocus : undefined}
      onBlur={styleKey ? handleBlur : undefined}
      {...props}
    />
  );
};
