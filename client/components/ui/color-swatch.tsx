/**
 * @file Color swatch display component with special state handling
 *
 * Accessed via: Internal component, used throughout the color picker system
 * Renders: none (dashed + red diagonal), transparent (checkerboard),
 * unknown token (?), normal color.
 */

import cn from 'clsx';

interface ColorSwatchProps {
  hex: string;
  value?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function ColorSwatch({ hex, value, size = 'sm', className: cls }: ColorSwatchProps) {
  const s = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';

  // None: dashed border + pale red diagonal line
  if (value === 'none' || (hex === '' && !value)) {
    return (
      <div className={cn(s, 'rounded border border-dashed border-border relative overflow-hidden shrink-0', cls)}>
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="absolute w-[141%] h-px bg-red-400/60 dark:bg-red-500/60"
            style={{ transform: 'rotate(-45deg)' }}
          />
        </div>
      </div>
    );
  }

  // Transparent: checkerboard
  if (hex === 'transparent') {
    return (
      <div className={cn(s, 'rounded border border-border grid grid-cols-2 grid-rows-2 overflow-hidden shrink-0', cls)}>
        <div className="bg-background" />
        <div className="bg-border" />
        <div className="bg-border" />
        <div className="bg-background" />
      </div>
    );
  }

  // Unknown token: question mark on white background
  if (hex && !hex.startsWith('#') && hex !== 'inherit' && hex !== 'currentColor') {
    return (
      <div
        className={cn(s, 'rounded border border-border bg-background flex items-center justify-center shrink-0', cls)}
      >
        <span
          className="text-red-400 dark:text-red-500 font-bold leading-none"
          style={{ fontSize: size === 'sm' ? 7 : 9 }}
        >
          ?
        </span>
      </div>
    );
  }

  // Normal color swatch
  return (
    <div
      className={cn(s, 'rounded border border-border shrink-0', cls)}
      style={{ backgroundColor: hex || 'transparent' }}
    />
  );
}
