/**
 * @file EditNudgeInput — inline input replacing step value display during editing
 *
 * Accessed via: Rendered by NumericMode when editingTarget is set
 * Assumptions: target is 'alt' or 'shift', value is the current step size
 */
import { IconCornerDownLeft } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useNudgeActions } from '@/lib/nudge';

interface EditNudgeInputProps {
  target: 'alt' | 'shift';
  value: number;
  onDone: () => void;
}

export function EditNudgeInput({ target, value, onDone }: EditNudgeInputProps) {
  const [inputValue, setInputValue] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const { setAltStep, setShiftStep, saveForLater } = useNudgeActions();

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  function applyValue() {
    const parsed = Number.parseFloat(inputValue);
    if (!Number.isNaN(parsed) && parsed > 0) {
      if (target === 'alt') {
        setAltStep(parsed);
      } else {
        setShiftStep(parsed);
      }
    }
    onDone();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyValue();
    } else if (e.code === 'KeyS') {
      e.preventDefault();
      applyValue();
      saveForLater();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onDone();
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={onDone}
        className="bg-white/10 border border-violet-400 rounded text-violet-400 text-center w-8 text-[10px] outline-none"
      />
      <span className="text-[10px] text-white/60">
        <IconCornerDownLeft size={10} stroke={1.5} /> apply {'\u00B7'} s save {'\u00B7'} Esc cancel
      </span>
    </div>
  );
}
