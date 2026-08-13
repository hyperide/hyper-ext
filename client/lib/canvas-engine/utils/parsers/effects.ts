/**
 * @file Tailwind effects and transitions parsing utilities
 *
 * Accessed via: tailwindParser.ts (parseOpacity, parseShadow, parseBlur, parseTransition)
 */

import { extractArbitraryValue } from './modifiers';

export interface ParsedEffectStyles {
  opacity?: string;
  shadow?: string;
  shadowColor?: string;
  shadowOpacity?: string;
  shadowX?: string;
  shadowY?: string;
  shadowBlur?: string;
  shadowSpread?: string;
  blur?: string;
  transitionProperty?: string;
  transitionDuration?: string;
  transitionTiming?: string;
}

export function parseOpacity(classes: string[]): Pick<ParsedEffectStyles, 'opacity'> {
  const result: Pick<ParsedEffectStyles, 'opacity'> = {};

  for (const cls of classes) {
    if (cls.startsWith('opacity-')) {
      const value = cls.slice(8);
      const arbValue = extractArbitraryValue(cls);
      if (arbValue) {
        const uiValue = Number.parseFloat(arbValue) * 100;
        result.opacity = uiValue.toString();
      } else {
        result.opacity = value;
      }
    }
  }

  return result;
}

export function parseShadow(classes: string[]): ParsedEffectStyles {
  const result: ParsedEffectStyles = {};

  for (const cls of classes) {
    if (cls === 'shadow') result.shadow = 'default';
    else if (cls === 'shadow-sm') result.shadow = 'sm';
    else if (cls === 'shadow-md') result.shadow = 'md';
    else if (cls === 'shadow-lg') result.shadow = 'lg';
    else if (cls === 'shadow-xl') result.shadow = 'xl';
    else if (cls === 'shadow-2xl') result.shadow = '2xl';
    else if (cls === 'shadow-inner') result.shadow = 'inner';
    else if (cls === 'shadow-none') result.shadow = 'none';
    else if (cls.startsWith('shadow-[')) {
      const match = cls.match(/shadow-\[([^\]]+)\]/);
      if (match) {
        const shadowValue = match[1].replace(/_/g, ' ');
        const justColorMatch = shadowValue.match(/^#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/);
        if (justColorMatch) {
          result.shadowColor = justColorMatch[0];
          result.shadowOpacity = '100';
        } else {
          const rgbaMatch = shadowValue.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
          if (rgbaMatch) {
            const [, r, g, b, a] = rgbaMatch;
            const hex = `#${Number.parseInt(r, 10).toString(16).padStart(2, '0')}${Number.parseInt(g, 10).toString(16).padStart(2, '0')}${Number.parseInt(b, 10).toString(16).padStart(2, '0')}`;
            result.shadowColor = hex;
            result.shadowOpacity = a ? `${Math.round(Number.parseFloat(a) * 100)}` : '100';
          } else {
            const hexMatch = shadowValue.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})/);
            if (hexMatch) {
              result.shadowColor = hexMatch[0];
              result.shadowOpacity = '100';
            }
          }
        }

        const parts = shadowValue.split(/\s+/);
        if (!justColorMatch && parts.length >= 4) {
          result.shadowX = parts[0];
          result.shadowY = parts[1];
          result.shadowBlur = parts[2];
          result.shadowSpread = parts[3];
          const vOffset = parts[1];
          const blur = parts[2];
          if (vOffset === '1px' && blur === '2px') result.shadow = 'sm';
          else if (vOffset === '1px' && blur === '3px') result.shadow = 'default';
          else if (vOffset === '4px' && blur === '6px') result.shadow = 'md';
          else if (vOffset === '10px' && blur === '15px') result.shadow = 'lg';
          else if (vOffset === '20px' && blur === '25px') result.shadow = 'xl';
          else if (vOffset === '25px' && blur === '50px') result.shadow = '2xl';
          else if (shadowValue.includes('inset')) result.shadow = 'inner';
          else result.shadow = 'default';
        } else if (!justColorMatch && parts.length >= 3) {
          result.shadowX = parts[0];
          result.shadowY = parts[1];
          result.shadowBlur = parts[2];
          result.shadowSpread = '0';
        }
      }
    }
  }

  return result;
}

export function parseBlur(classes: string[]): Pick<ParsedEffectStyles, 'blur'> {
  const result: Pick<ParsedEffectStyles, 'blur'> = {};

  for (const cls of classes) {
    if (cls === 'blur') result.blur = 'default';
    else if (cls === 'blur-sm') result.blur = 'sm';
    else if (cls === 'blur-md') result.blur = 'md';
    else if (cls === 'blur-lg') result.blur = 'lg';
    else if (cls === 'blur-xl') result.blur = 'xl';
    else if (cls === 'blur-2xl') result.blur = '2xl';
    else if (cls === 'blur-3xl') result.blur = '3xl';
    else if (cls === 'blur-none') result.blur = 'none';
  }

  return result;
}

export function parseTransition(
  classes: string[],
): Pick<ParsedEffectStyles, 'transitionProperty' | 'transitionDuration' | 'transitionTiming'> {
  const result: Pick<ParsedEffectStyles, 'transitionProperty' | 'transitionDuration' | 'transitionTiming'> = {};

  for (const cls of classes) {
    if (cls === 'transition' || cls === 'transition-all') result.transitionProperty = 'all';
    else if (cls === 'transition-colors') result.transitionProperty = 'colors';
    else if (cls === 'transition-opacity') result.transitionProperty = 'opacity';
    else if (cls === 'transition-transform') result.transitionProperty = 'transform';
    else if (cls === 'transition-none') result.transitionProperty = 'none';

    if (cls.startsWith('duration-')) {
      result.transitionDuration = cls.slice(9);
    }

    if (cls === 'ease-linear') result.transitionTiming = 'linear';
    else if (cls === 'ease-in') result.transitionTiming = 'in';
    else if (cls === 'ease-out') result.transitionTiming = 'out';
    else if (cls === 'ease-in-out') result.transitionTiming = 'in-out';
  }

  return result;
}
