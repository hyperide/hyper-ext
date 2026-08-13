import { useCallback } from 'react';
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
}

export const NumericInput = function NumericInput({ value, onChange, onKeyDown, ...props }: NumericInputProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
        const num = match ? parseFloat(match[1]) : 0;
        const unit = match ? match[2] : 'px';
        const step = e.shiftKey ? 10 : 1;
        const delta = e.key === 'ArrowUp' ? step : -step;
        const newNum = Math.max(0, num + delta);
        onChange(`${newNum}${unit || 'px'}`);
        return;
      }
      onKeyDown?.(e);
    },
    [value, onChange, onKeyDown],
  );

  return <Input value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={handleKeyDown} {...props} />;
};
