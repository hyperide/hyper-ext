/**
 * Tests for Tailwind parser utilities
 */

import { describe, expect, it } from 'bun:test';
import {
  getConflictingPrefixes,
  mapPropertiesToTailwindClasses,
  parseTailwindClasses,
  removeConflictingClasses,
} from './parser';

describe('parseTailwindClasses', () => {
  it('should parse position classes', () => {
    const result = parseTailwindClasses('relative absolute fixed sticky static');

    expect(result.position).toBe('static'); // Last one wins
  });

  it('should parse spacing classes', () => {
    const result = parseTailwindClasses('w-64 h-32 mt-4 mb-8 ml-2 mr-6');

    expect(result.width).toBe('16rem');
    expect(result.height).toBe('8rem');
    expect(result.marginTop).toBe('1rem');
    expect(result.marginBottom).toBe('2rem');
    expect(result.marginLeft).toBe('0.5rem');
    expect(result.marginRight).toBe('1.5rem');
  });

  it('should parse arbitrary values', () => {
    const result = parseTailwindClasses('w-[227px] h-[100vh] mt-[1.5rem]');

    expect(result.width).toBe('227px');
    expect(result.height).toBe('100vh');
    expect(result.marginTop).toBe('1.5rem');
  });

  it('should parse negative values', () => {
    const result = parseTailwindClasses('-mt-4 -ml-2 -top-8');

    expect(result.marginTop).toBe('-1rem');
    expect(result.marginLeft).toBe('-0.5rem');
    expect(result.top).toBe('-2rem');
  });

  it('should map text size classes separately from text colors', () => {
    const result = mapPropertiesToTailwindClasses('text-[15px] text-[#fff] text-cyan-400');

    expect(result.fontSize).toBe('text-[15px]');
    expect(result.color).toBe('text-cyan-400');
    expect(result['text-[#fff]']).toBeUndefined();
  });

  it('should parse border radius', () => {
    const result = parseTailwindClasses('rounded-lg');

    expect(result.borderRadius).toBe('0.5rem');
  });

  it('should parse overflow', () => {
    const result = parseTailwindClasses('overflow-hidden');

    expect(result.overflow).toBe('hidden');
  });

  it('should parse display and flexbox', () => {
    const result = parseTailwindClasses('flex flex-col');

    expect(result.display).toBe('flex');
    expect(result.flexDirection).toBe('column');
  });

  it('should handle empty or invalid input', () => {
    expect(parseTailwindClasses('')).toEqual({});
    expect(parseTailwindClasses('   ')).toEqual({});
  });

  it('should handle position values for non-static positions', () => {
    const result = parseTailwindClasses('absolute top-4 left-8');

    expect(result.position).toBe('absolute');
    expect(result.top).toBe('1rem');
    expect(result.left).toBe('2rem');
  });
});

describe('getConflictingPrefixes', () => {
  it('should return prefixes for width', () => {
    const prefixes = getConflictingPrefixes(['width']);

    expect(prefixes).toContain('w-');
  });

  it('should return prefixes for margin', () => {
    const prefixes = getConflictingPrefixes(['marginTop', 'marginLeft']);

    expect(prefixes).toContain('mt-');
    expect(prefixes).toContain('-mt-');
    expect(prefixes).toContain('ml-');
    expect(prefixes).toContain('-ml-');
  });

  it('should return prefixes for position', () => {
    const prefixes = getConflictingPrefixes(['position', 'top']);

    expect(prefixes).toContain('static');
    expect(prefixes).toContain('relative');
    expect(prefixes).toContain('absolute');
    expect(prefixes).toContain('top-');
    expect(prefixes).toContain('-top-');
  });

  it('should return prefixes for display', () => {
    const prefixes = getConflictingPrefixes(['display']);

    expect(prefixes).toContain('flex');
    expect(prefixes).toContain('block');
    expect(prefixes).toContain('grid');
  });

  it('should return prefixes for border radius', () => {
    const prefixes = getConflictingPrefixes(['borderRadius']);

    expect(prefixes).toContain('rounded-');
  });

  it('should handle opacity', () => {
    const prefixes = getConflictingPrefixes(['opacity']);

    expect(prefixes).toContain('opacity-');
  });
});

describe('removeConflictingClasses', () => {
  it('should remove conflicting width classes', () => {
    const { preserved, removed } = removeConflictingClasses('w-32 w-64 h-16', ['width']);

    expect(removed).toContain('w-32');
    expect(removed).toContain('w-64');
    expect(preserved).toContain('h-16');
  });

  it('should remove conflicting margin classes', () => {
    const { preserved, removed } = removeConflictingClasses('mt-4 mt-8 mb-2', ['marginTop']);

    expect(removed).toContain('mt-4');
    expect(removed).toContain('mt-8');
    expect(preserved).toContain('mb-2');
  });

  it('should preserve border width when removing border color', () => {
    const { preserved, removed } = removeConflictingClasses('border border-red-500', ['borderColor']);

    expect(preserved).toContain('border');
    expect(removed).toContain('border-red-500');
  });

  it('should remove position classes', () => {
    const { preserved, removed } = removeConflictingClasses('relative absolute flex', ['position']);

    expect(removed).toContain('relative');
    expect(removed).toContain('absolute');
    expect(preserved).toContain('flex');
  });

  it('should handle negative values', () => {
    const { preserved, removed } = removeConflictingClasses('-mt-4 mt-8 flex', ['marginTop']);

    expect(removed).toContain('-mt-4');
    expect(removed).toContain('mt-8');
    expect(preserved).toContain('flex');
  });

  it('should handle arbitrary values', () => {
    const { preserved, removed } = removeConflictingClasses('w-[227px] w-64 h-32', ['width']);

    expect(removed).toContain('w-[227px]');
    expect(removed).toContain('w-64');
    expect(preserved).toContain('h-32');
  });

  it('should preserve non-conflicting classes', () => {
    const { preserved, removed } = removeConflictingClasses('flex items-center justify-between w-32', ['width']);

    expect(preserved).toContain('flex');
    expect(preserved).toContain('items-center');
    expect(preserved).toContain('justify-between');
    expect(removed).toContain('w-32');
  });

  it('should handle empty className', () => {
    const { preserved, removed } = removeConflictingClasses('', ['width']);
    expect(preserved).toBe('');
    expect(removed).toEqual([]);
  });

  it('should handle multiple style keys', () => {
    const { preserved, removed } = removeConflictingClasses('w-32 h-16 mt-4 mb-8 flex', ['width', 'marginTop']);

    expect(removed).toContain('w-32');
    expect(removed).toContain('mt-4');
    expect(preserved).toContain('h-16');
    expect(preserved).toContain('mb-8');
    expect(preserved).toContain('flex');
  });

  it('should not remove text-3xl when removing color conflicts', () => {
    const { preserved, removed } = removeConflictingClasses(
      'text-cyan-400 font-mono tabular-nums tracking-wide text-3xl',
      ['color'],
    );

    expect(preserved).toContain('text-3xl');
    expect(removed).toContain('text-cyan-400');
    expect(preserved).toContain('font-mono');
  });

  it('should preserve text color classes when removing font size conflicts', () => {
    const { preserved, removed } = removeConflictingClasses('text-[#fff] text-sm text-cyan-400', ['fontSize']);

    expect(removed).toContain('text-sm');
    expect(preserved).toContain('text-[#fff]');
    expect(preserved).toContain('text-cyan-400');
  });

  it('should not remove text-align or text-wrap classes when removing color', () => {
    const { preserved, removed } = removeConflictingClasses('text-red-500 text-center text-wrap text-2xl', ['color']);

    expect(removed).toContain('text-red-500');
    expect(preserved).toContain('text-center');
    expect(preserved).toContain('text-wrap');
    expect(preserved).toContain('text-2xl');
  });

  it('should still remove old color when setting new text color', () => {
    const { preserved, removed } = removeConflictingClasses('text-blue-500 text-3xl font-bold', ['color']);

    expect(removed).toContain('text-blue-500');
    expect(preserved).toContain('text-3xl');
    expect(preserved).toContain('font-bold');
  });

  // ── Prefix overlap bugs (shadow-, bg-, border-) ──

  it('should preserve shadow-md when removing shadowColor', () => {
    const { preserved, removed } = removeConflictingClasses('shadow-md shadow-red-500', ['shadowColor']);

    expect(removed).toContain('shadow-red-500');
    expect(preserved).toContain('shadow-md');
  });

  it('should preserve shadow-lg when removing shadowColor (arbitrary)', () => {
    const { preserved, removed } = removeConflictingClasses('shadow-lg shadow-[#ff0000]', ['shadowColor']);

    expect(removed).toContain('shadow-[#ff0000]');
    expect(preserved).toContain('shadow-lg');
  });

  it('should preserve bg-cover/bg-center when removing backgroundColor', () => {
    const { preserved, removed } = removeConflictingClasses('bg-red-500 bg-cover bg-center bg-no-repeat', [
      'backgroundColor',
    ]);

    expect(removed).toContain('bg-red-500');
    expect(preserved).toContain('bg-cover');
    expect(preserved).toContain('bg-center');
    expect(preserved).toContain('bg-no-repeat');
  });

  it('should preserve bg-gradient classes when removing backgroundColor', () => {
    const { preserved, removed } = removeConflictingClasses('bg-blue-500 bg-gradient-to-r', ['backgroundColor']);

    expect(removed).toContain('bg-blue-500');
    expect(preserved).toContain('bg-gradient-to-r');
  });

  it('should preserve border-2 when removing borderColor', () => {
    const { preserved, removed } = removeConflictingClasses('border-2 border-red-500', ['borderColor']);

    expect(removed).toContain('border-red-500');
    expect(preserved).toContain('border-2');
  });

  it('should preserve border-4 and border-dashed when removing borderColor', () => {
    const { preserved, removed } = removeConflictingClasses('border-4 border-dashed border-blue-300', ['borderColor']);

    expect(removed).toContain('border-blue-300');
    expect(preserved).toContain('border-4');
    expect(preserved).toContain('border-dashed');
  });

  // ── Padding (all directions) ──

  it('should remove all padding shorthand variants when setting paddingTop', () => {
    const { preserved, removed } = removeConflictingClasses('p-4 pt-2 py-6 px-8 pb-3', ['paddingTop']);

    expect(removed).toContain('p-4');
    expect(removed).toContain('pt-2');
    expect(removed).toContain('py-6');
    expect(preserved).toContain('px-8');
    expect(preserved).toContain('pb-3');
  });

  it('should remove px and p shorthand when setting paddingLeft', () => {
    const { preserved, removed } = removeConflictingClasses('p-4 px-8 pl-2 py-6 pr-3', ['paddingLeft']);

    expect(removed).toContain('p-4');
    expect(removed).toContain('px-8');
    expect(removed).toContain('pl-2');
    expect(preserved).toContain('py-6');
    expect(preserved).toContain('pr-3');
  });

  // ── Margin (shorthand interactions) ──

  it('should remove m- shorthand when setting marginBottom', () => {
    const { preserved, removed } = removeConflictingClasses('m-4 mb-2 mx-6 mt-3', ['marginBottom']);

    expect(removed).toContain('m-4');
    expect(removed).toContain('mb-2');
    expect(preserved).toContain('mx-6');
    expect(preserved).toContain('mt-3');
  });

  it('should remove mx and m shorthand when setting marginRight', () => {
    const { preserved, removed } = removeConflictingClasses('m-4 mx-8 mr-2 my-6', ['marginRight']);

    expect(removed).toContain('m-4');
    expect(removed).toContain('mx-8');
    expect(removed).toContain('mr-2');
    expect(preserved).toContain('my-6');
  });

  // ── Gap variants ──

  it('should preserve gap-x and gap-y when removing gap', () => {
    const { preserved, removed } = removeConflictingClasses('gap-4 gap-x-2 gap-y-6', ['gap']);

    expect(removed).toContain('gap-4');
    expect(preserved).toContain('gap-x-2');
    expect(preserved).toContain('gap-y-6');
  });

  it('should remove only gap-x when setting columnGap', () => {
    const { preserved, removed } = removeConflictingClasses('gap-4 gap-x-2 gap-y-6', ['columnGap']);

    expect(removed).toContain('gap-x-2');
    expect(preserved).toContain('gap-4');
    expect(preserved).toContain('gap-y-6');
  });

  // ── Display vs flex-direction ──

  it('should preserve flex-col when removing display classes', () => {
    const { preserved, removed } = removeConflictingClasses('flex flex-col items-center', ['display']);

    expect(removed).toContain('flex');
    expect(preserved).toContain('flex-col');
    expect(preserved).toContain('items-center');
  });

  it('should remove flex-col and flex-row when setting flexDirection', () => {
    const { preserved, removed } = removeConflictingClasses('flex flex-col flex-row', ['flexDirection']);

    expect(removed).toContain('flex-col');
    expect(removed).toContain('flex-row');
    expect(preserved).toContain('flex');
  });

  // ── Justify vs justify-items ──

  it('should preserve justify-items-center when removing justifyContent', () => {
    const { preserved, removed } = removeConflictingClasses('justify-between justify-items-center', ['justifyContent']);

    expect(removed).toContain('justify-between');
    expect(preserved).toContain('justify-items-center');
  });

  // ── Border radius (corner vs generic) ──

  it('should remove generic rounded when setting borderRadiusTopLeft', () => {
    const { removed } = removeConflictingClasses('rounded-lg rounded-tl-sm', ['borderRadiusTopLeft']);

    expect(removed).toContain('rounded-lg');
    expect(removed).toContain('rounded-tl-sm');
  });

  it('should preserve corner radius when removing borderRadius', () => {
    // borderRadius removes all rounded-* including corner-specific
    const { removed } = removeConflictingClasses('rounded-lg rounded-tl-sm rounded-br-md', ['borderRadius']);

    expect(removed).toContain('rounded-lg');
    expect(removed).toContain('rounded-tl-sm');
    expect(removed).toContain('rounded-br-md');
  });

  // ── Height ──

  it('should remove height classes', () => {
    const { preserved, removed } = removeConflictingClasses('h-32 h-[100px] w-16', ['height']);

    expect(removed).toContain('h-32');
    expect(removed).toContain('h-[100px]');
    expect(preserved).toContain('w-16');
  });

  // ── Overflow ──

  it('should remove overflow classes', () => {
    const { preserved, removed } = removeConflictingClasses('overflow-hidden overflow-auto flex', ['overflow']);

    expect(removed).toContain('overflow-hidden');
    expect(removed).toContain('overflow-auto');
    expect(preserved).toContain('flex');
  });

  // ── Opacity ──

  it('should remove opacity classes', () => {
    const { preserved, removed } = removeConflictingClasses('opacity-50 opacity-100 flex', ['opacity']);

    expect(removed).toContain('opacity-50');
    expect(removed).toContain('opacity-100');
    expect(preserved).toContain('flex');
  });

  // ── Grid ──

  it('should remove grid-cols classes', () => {
    const { preserved, removed } = removeConflictingClasses('grid grid-cols-3 gap-4', ['gridTemplateColumns']);

    expect(removed).toContain('grid-cols-3');
    expect(preserved).toContain('grid');
    expect(preserved).toContain('gap-4');
  });

  it('should remove grid-rows classes', () => {
    const { preserved, removed } = removeConflictingClasses('grid grid-rows-2 gap-4', ['gridTemplateRows']);

    expect(removed).toContain('grid-rows-2');
    expect(preserved).toContain('grid');
    expect(preserved).toContain('gap-4');
  });

  // ── Inset positions with negative values ──

  it('should remove top classes including negative', () => {
    const { preserved, removed } = removeConflictingClasses('top-4 -top-2 left-8', ['top']);

    expect(removed).toContain('top-4');
    expect(removed).toContain('-top-2');
    expect(preserved).toContain('left-8');
  });

  // ── State modifier filtering ──

  it('should not remove hover: classes when updating base styles', () => {
    const { preserved, removed } = removeConflictingClasses('bg-red-500 hover:bg-blue-500', ['backgroundColor']);

    expect(removed).toContain('bg-red-500');
    expect(preserved).toContain('hover:bg-blue-500');
  });

  it('should only remove hover: classes when state=hover', () => {
    const { preserved, removed } = removeConflictingClasses(
      'bg-red-500 hover:bg-blue-500 focus:bg-green-500',
      ['backgroundColor'],
      'hover',
    );

    expect(removed).toContain('hover:bg-blue-500');
    expect(preserved).toContain('bg-red-500');
    expect(preserved).toContain('focus:bg-green-500');
  });

  // ── Align items ──

  it('should remove alignItems classes', () => {
    const { preserved, removed } = removeConflictingClasses('items-center items-start flex', ['alignItems']);

    expect(removed).toContain('items-center');
    expect(removed).toContain('items-start');
    expect(preserved).toContain('flex');
  });

  // ── Background color vs bg-opacity (TW3 modifier) ──

  it('should preserve bg-opacity when removing backgroundColor', () => {
    const { preserved, removed } = removeConflictingClasses('bg-red-500 bg-opacity-50', ['backgroundColor']);

    expect(removed).toContain('bg-red-500');
    expect(preserved).toContain('bg-opacity-50');
  });

  // ── Blur ──

  it('should remove blur classes', () => {
    const { preserved, removed } = removeConflictingClasses('blur-md blur-lg flex', ['blur']);

    expect(removed).toContain('blur-md');
    expect(removed).toContain('blur-lg');
    expect(preserved).toContain('flex');
  });

  // ── Shadow (boxShadow) vs shadowColor ──

  it('should preserve shadow color when removing boxShadow', () => {
    const { preserved, removed } = removeConflictingClasses('shadow-md shadow-red-500', ['boxShadow']);

    expect(removed).toContain('shadow-md');
    expect(preserved).toContain('shadow-red-500');
  });

  it('should remove arbitrary boxShadow when updating boxShadow', () => {
    const { preserved, removed } = removeConflictingClasses('shadow-[0_4px_6px_-1px_rgb(0,0,0,0.1)] shadow-red-500', [
      'boxShadow',
    ]);

    expect(removed).toContain('shadow-[0_4px_6px_-1px_rgb(0,0,0,0.1)]');
    expect(preserved).toContain('shadow-red-500');
  });

  // ── Border style classes ──

  it('should preserve border-style classes when removing borderColor', () => {
    const { preserved, removed } = removeConflictingClasses('border-solid border-red-500', ['borderColor']);

    expect(removed).toContain('border-red-500');
    expect(preserved).toContain('border-solid');
  });

  // ── Border side-specific width (gap in exception set) ──

  it('should preserve border-t-2 when removing borderColor', () => {
    const { preserved, removed } = removeConflictingClasses('border-t-2 border-red-500', ['borderColor']);

    expect(removed).toContain('border-red-500');
    expect(preserved).toContain('border-t-2');
  });

  it('should preserve border-b-4 and border-l-8 when removing borderColor', () => {
    const { preserved, removed } = removeConflictingClasses('border-b-4 border-l-8 border-blue-300', ['borderColor']);

    expect(removed).toContain('border-blue-300');
    expect(preserved).toContain('border-b-4');
    expect(preserved).toContain('border-l-8');
  });

  it('should preserve border-spacing-4 when removing borderColor', () => {
    const { preserved, removed } = removeConflictingClasses('border-spacing-4 border-red-500', ['borderColor']);

    expect(removed).toContain('border-red-500');
    expect(preserved).toContain('border-spacing-4');
  });

  // ── Shadow arbitrary values: color vs box-shadow ──

  it('should preserve arbitrary shadow color shadow-[#ff0000] when removing boxShadow', () => {
    const { preserved, removed } = removeConflictingClasses('shadow-md shadow-[#ff0000]', ['boxShadow']);

    expect(removed).toContain('shadow-md');
    expect(preserved).toContain('shadow-[#ff0000]');
  });

  it('should preserve arbitrary shadow color shadow-[rgba(0,0,0,0.5)] when removing boxShadow', () => {
    const { preserved, removed } = removeConflictingClasses('shadow-lg shadow-[rgba(0,0,0,0.5)]', ['boxShadow']);

    expect(removed).toContain('shadow-lg');
    expect(preserved).toContain('shadow-[rgba(0,0,0,0.5)]');
  });

  it('should preserve arbitrary shadow color shadow-[hsl(200,50%,50%)] when removing boxShadow', () => {
    const { preserved, removed } = removeConflictingClasses('shadow-md shadow-[hsl(200,50%,50%)]', ['boxShadow']);

    expect(removed).toContain('shadow-md');
    expect(preserved).toContain('shadow-[hsl(200,50%,50%)]');
  });

  it('should remove arbitrary box-shadow value when removing boxShadow', () => {
    const { preserved, removed } = removeConflictingClasses('shadow-[0_4px_6px_-1px_rgb(0,0,0,0.1)] shadow-[#ff0000]', [
      'boxShadow',
    ]);

    expect(removed).toContain('shadow-[0_4px_6px_-1px_rgb(0,0,0,0.1)]');
    expect(preserved).toContain('shadow-[#ff0000]');
  });

  it('should remove bare shadow class when removing boxShadow', () => {
    const { preserved, removed } = removeConflictingClasses('shadow shadow-red-500', ['boxShadow']);

    expect(removed).toContain('shadow');
    expect(preserved).toContain('shadow-red-500');
  });

  // ── Border side-specific color (should be removed) ──

  it('should remove border-t-red-500 when removing borderColor', () => {
    const { preserved, removed } = removeConflictingClasses('border-t-2 border-t-red-500 border-red-500', [
      'borderColor',
    ]);

    expect(removed).toContain('border-t-red-500');
    expect(removed).toContain('border-red-500');
    expect(preserved).toContain('border-t-2');
  });

  it('should remove arbitrary side border color border-t-[#ff0000] when removing borderColor', () => {
    const { preserved, removed } = removeConflictingClasses('border-t-2 border-t-[#ff0000]', ['borderColor']);

    expect(removed).toContain('border-t-[#ff0000]');
    expect(preserved).toContain('border-t-2');
  });

  it('should remove border-x-[color:var(--c)] when removing borderColor', () => {
    const { preserved, removed } = removeConflictingClasses('border-x-4 border-x-[color:var(--c)]', ['borderColor']);

    expect(removed).toContain('border-x-[color:var(--c)]');
    expect(preserved).toContain('border-x-4');
  });

  // ── Shadow: color-first arbitrary box-shadow ──

  it('should remove shadow-[rgba(0,0,0,0.25)_0_4px_6px_-1px] when removing boxShadow', () => {
    const { preserved, removed } = removeConflictingClasses('shadow-[rgba(0,0,0,0.25)_0_4px_6px_-1px] shadow-red-500', [
      'boxShadow',
    ]);

    expect(removed).toContain('shadow-[rgba(0,0,0,0.25)_0_4px_6px_-1px]');
    expect(preserved).toContain('shadow-red-500');
  });

  // ── Shadow: simultaneous boxShadow + shadowColor update ──

  it('should remove both shadow preset and shadow color when updating boxShadow + shadowColor', () => {
    const { preserved, removed } = removeConflictingClasses('shadow-lg shadow-red-500 flex', [
      'boxShadow',
      'shadowColor',
    ]);

    expect(removed).toContain('shadow-lg');
    expect(removed).toContain('shadow-red-500');
    expect(preserved).toContain('flex');
  });

  // ── Shadow: all preset sizes removed by boxShadow ──

  it('should remove all shadow preset sizes when updating boxShadow', () => {
    const { removed } = removeConflictingClasses(
      'shadow-sm shadow shadow-md shadow-lg shadow-xl shadow-2xl shadow-inner shadow-none',
      ['boxShadow'],
    );

    expect(removed).toContain('shadow-sm');
    expect(removed).toContain('shadow');
    expect(removed).toContain('shadow-md');
    expect(removed).toContain('shadow-lg');
    expect(removed).toContain('shadow-xl');
    expect(removed).toContain('shadow-2xl');
    expect(removed).toContain('shadow-inner');
    expect(removed).toContain('shadow-none');
  });

  // ── Shadow: all preset sizes preserved when updating shadowColor ──

  it('should preserve all shadow preset sizes when updating shadowColor', () => {
    const { preserved, removed } = removeConflictingClasses(
      'shadow-sm shadow-md shadow-lg shadow-xl shadow-2xl shadow-inner shadow-red-500',
      ['shadowColor'],
    );

    expect(removed).toContain('shadow-red-500');
    expect(preserved).toContain('shadow-sm');
    expect(preserved).toContain('shadow-md');
    expect(preserved).toContain('shadow-lg');
    expect(preserved).toContain('shadow-xl');
    expect(preserved).toContain('shadow-2xl');
    expect(preserved).toContain('shadow-inner');
  });

  // ── Shadow: named color variations preserved by boxShadow ──

  it('should preserve various named shadow colors when updating boxShadow', () => {
    const { preserved, removed } = removeConflictingClasses('shadow-md shadow-blue-500 shadow-emerald-300/50', [
      'boxShadow',
    ]);

    expect(removed).toContain('shadow-md');
    expect(preserved).toContain('shadow-blue-500');
    expect(preserved).toContain('shadow-emerald-300/50');
  });

  // ── Shadow: named color with opacity modifier removed by shadowColor ──

  it('should remove shadow color with opacity modifier when updating shadowColor', () => {
    const { preserved, removed } = removeConflictingClasses('shadow-lg shadow-red-500/75', ['shadowColor']);

    expect(removed).toContain('shadow-red-500/75');
    expect(preserved).toContain('shadow-lg');
  });

  // ── Shadow: arbitrary oklch/oklab colors ──

  it('should preserve arbitrary oklch shadow color when updating boxShadow', () => {
    const { preserved, removed } = removeConflictingClasses('shadow-md shadow-[oklch(0.5_0.2_240)]', ['boxShadow']);

    expect(removed).toContain('shadow-md');
    expect(preserved).toContain('shadow-[oklch(0.5_0.2_240)]');
  });

  // ── Shadow: arbitrary box-shadow starting with number ──

  it('should remove number-first arbitrary box-shadow when updating boxShadow', () => {
    const { preserved, removed } = removeConflictingClasses('shadow-[0_0_10px_5px_black] shadow-red-500', [
      'boxShadow',
    ]);

    expect(removed).toContain('shadow-[0_0_10px_5px_black]');
    expect(preserved).toContain('shadow-red-500');
  });

  // ── Shadow: inset arbitrary box-shadow ──

  it('should remove inset arbitrary box-shadow when updating boxShadow', () => {
    const { preserved, removed } = removeConflictingClasses(
      'shadow-[inset_0_2px_4px_rgba(0,0,0,0.06)] shadow-blue-300',
      ['boxShadow'],
    );

    expect(removed).toContain('shadow-[inset_0_2px_4px_rgba(0,0,0,0.06)]');
    expect(preserved).toContain('shadow-blue-300');
  });

  // ── Shadow: hover state interactions ──

  it('should not remove hover:shadow-lg when updating base boxShadow', () => {
    const { preserved, removed } = removeConflictingClasses('shadow-md hover:shadow-lg shadow-red-500', ['boxShadow']);

    expect(removed).toContain('shadow-md');
    expect(preserved).toContain('hover:shadow-lg');
    expect(preserved).toContain('shadow-red-500');
  });

  it('should not remove hover:shadow-blue-500 when updating base shadowColor', () => {
    const { preserved, removed } = removeConflictingClasses('shadow-md shadow-red-500 hover:shadow-blue-500', [
      'shadowColor',
    ]);

    expect(removed).toContain('shadow-red-500');
    expect(preserved).toContain('shadow-md');
    expect(preserved).toContain('hover:shadow-blue-500');
  });

  it('should remove only hover shadow color when updating hover shadowColor', () => {
    const { preserved, removed } = removeConflictingClasses(
      'shadow-md shadow-red-500 hover:shadow-blue-500 hover:shadow-xl',
      ['shadowColor'],
      'hover',
    );

    expect(removed).toContain('hover:shadow-blue-500');
    expect(preserved).toContain('shadow-md');
    expect(preserved).toContain('shadow-red-500');
    expect(preserved).toContain('hover:shadow-xl');
  });

  it('should remove only hover shadow preset when updating hover boxShadow', () => {
    const { preserved, removed } = removeConflictingClasses(
      'shadow-md shadow-red-500 hover:shadow-xl hover:shadow-blue-500',
      ['boxShadow'],
      'hover',
    );

    expect(removed).toContain('hover:shadow-xl');
    expect(preserved).toContain('shadow-md');
    expect(preserved).toContain('shadow-red-500');
    expect(preserved).toContain('hover:shadow-blue-500');
  });

  // ── Shadow: shadow-none as reset ──

  it('should preserve shadow-none when updating shadowColor', () => {
    const { preserved, removed } = removeConflictingClasses('shadow-none shadow-red-500', ['shadowColor']);

    expect(removed).toContain('shadow-red-500');
    expect(preserved).toContain('shadow-none');
  });

  // ── Shadow: no false positives on unrelated classes ──

  it('should not touch non-shadow classes when updating boxShadow and shadowColor', () => {
    const { preserved, removed } = removeConflictingClasses('shadow-md shadow-red-500 flex bg-white p-4 text-sm', [
      'boxShadow',
      'shadowColor',
    ]);

    expect(removed).toContain('shadow-md');
    expect(removed).toContain('shadow-red-500');
    expect(preserved).toContain('flex');
    expect(preserved).toContain('bg-white');
    expect(preserved).toContain('p-4');
    expect(preserved).toContain('text-sm');
  });
});
