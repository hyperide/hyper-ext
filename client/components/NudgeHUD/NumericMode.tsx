/**
 * @file NumericMode — displays alt/shift step values, editable nudge, and nearest token preview
 *
 * Accessed via: Rendered by NudgeHUD when mode === 'numeric'
 * Assumptions: the NudgeStatePort provides altStep, shiftStep, highlightedTarget, editingTarget
 * Layout: Alt [0.1] | Shift [10] | n edit nudge | t token-name
 */

import { type AdapterName, findNearestToken, getTokenScale } from '@lib/tokens/token-scales';
import { IconArrowBigUp } from '@tabler/icons-react';
import cn from 'clsx';
import { useNudgeActions, useNudgeState } from '@/lib/nudge';
import { EditNudgeInput } from './EditNudgeInput';
import type { NudgeAdapter } from './NudgeHUD';
import { Separator } from './NudgeHUD';

interface NumericModeProps {
  adapter: NudgeAdapter;
}

export function NumericMode({ adapter }: NumericModeProps) {
  const altStep = useNudgeState((s) => s.altStep);
  const shiftStep = useNudgeState((s) => s.shiftStep);
  const highlightedTarget = useNudgeState((s) => s.highlightedTarget);
  const editingTarget = useNudgeState((s) => s.editingTarget);
  const currentValue = useNudgeState((s) => s.currentValue);
  const activeProperty = useNudgeState((s) => s.activeProperty);
  const { stopEditing } = useNudgeActions();

  const scale = adapter !== 'none' && activeProperty ? getTokenScale(activeProperty, adapter as AdapterName) : [];

  const nearestToken = scale.length > 0 ? findNearestToken(currentValue, scale) : null;

  if (editingTarget) {
    return (
      <div className="flex items-center gap-1.5">
        <EditNudgeInput
          target={editingTarget}
          value={editingTarget === 'alt' ? altStep : shiftStep}
          onDone={stopEditing}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <StepPill label="Alt" value={altStep} highlighted={highlightedTarget === 'alt'} />
      <Separator />
      <StepPill label="Shift" value={shiftStep} highlighted={highlightedTarget === 'shift'} />
      <Separator />
      <span className="text-[10px] text-white/60">n edit nudge</span>
      {adapter !== 'none' && nearestToken && (
        <>
          <Separator />
          <TokenPreview token={nearestToken.token} exact={nearestToken.exact} />
        </>
      )}
    </div>
  );
}

function StepPill({ label, value, highlighted }: { label: string; value: number; highlighted: boolean }) {
  return (
    <div className="flex items-center gap-1">
      {label === 'Shift' && (
        <span className="text-[10px] text-white/60">
          <IconArrowBigUp size={10} stroke={1.5} />
        </span>
      )}
      <span className="text-[10px] text-white/60">{label}</span>
      <span
        className={cn(
          'text-[10px] px-1 rounded border',
          highlighted ? 'border-violet-400 text-violet-400' : 'border-white/20 text-white/60',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function TokenPreview({ token, exact }: { token: string; exact: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-white/60">t</span>
      {!exact && <span className="text-[10px] text-yellow-500">{'\u2248'}</span>}
      <span className="text-[10px] text-violet-400">{token}</span>
    </div>
  );
}
