/**
 * @file Compact opacity percentage input for color picker
 *
 * Accessed via: Internal component, rendered inline in ColorCombobox
 * Assumptions: opacity is 0-100 integer scale
 */

import type * as React from 'react';
import { Input } from '@/components/ui/input';
import type { TokenSystem } from './color-utils';

interface OpacityInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

const TOKEN_SYSTEM_SUPPORTS_ALPHA: Record<TokenSystem, boolean> = {
  tailwind: true,
  tamagui: false,
};

export function shouldShowOpacity(isLinked: boolean, tokenSystem: TokenSystem): boolean {
  return !isLinked || TOKEN_SYSTEM_SUPPORTS_ALPHA[tokenSystem];
}

export function OpacityInput({ value, onChange, className }: OpacityInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replaceAll('%', '').trim();
    const num = Number.parseInt(raw, 10);
    if (raw === '' || raw === '-') {
      onChange('');
      return;
    }
    if (!Number.isNaN(num)) {
      onChange(`${Math.max(0, Math.min(100, num))}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const increment = e.key === 'ArrowUp' ? 1 : -1;
    const step = e.shiftKey || e.altKey ? 10 : 1;
    const num = Number.parseFloat(value || '100') || 0;
    const newNum = Math.max(0, Math.min(100, num + increment * step));
    onChange(`${newNum}`);
  };

  return (
    <div className={`h-6 w-14 px-2 bg-muted rounded flex items-center ${className || ''}`}>
      <Input
        type="text"
        value={`${value || '100'}%`}
        placeholder="100%"
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1 text-center"
      />
    </div>
  );
}
