/**
 * Tests for Tailwind generator utilities
 */

import { describe, it, expect } from 'bun:test';
import { generateTailwindClasses } from './generator';

describe('generateTailwindClasses', () => {
  it('should generate position classes', () => {
    const result = generateTailwindClasses({ position: 'absolute' });

    expect(result).toContain('absolute');
  });

  it('should generate position with values', () => {
    const result = generateTailwindClasses({
      position: 'absolute',
      top: '1rem',
      left: '2rem',
    });

    expect(result).toContain('absolute');
    expect(result).toContain('top-4');
    expect(result).toContain('left-8');
  });

  it('should not generate position values for static position', () => {
    const result = generateTailwindClasses({
      position: 'static',
      top: '1rem',
    });

    expect(result).toContain('static');
    expect(result).not.toContain('top-');
  });

  it('should generate width and height', () => {
    const result = generateTailwindClasses({
      width: '16rem',
      height: '8rem',
    });

    expect(result).toContain('w-64');
    expect(result).toContain('h-32');
  });

  it('should generate arbitrary values', () => {
    const result = generateTailwindClasses({
      width: '227px',
      height: '90vh',
    });

    expect(result).toContain('w-[227px]');
    expect(result).toContain('h-[90vh]');
  });

  it('should generate margin classes', () => {
    const result = generateTailwindClasses({
      marginTop: '1rem',
      marginRight: '0.5rem',
      marginBottom: '2rem',
      marginLeft: '0.25rem',
    });

    expect(result).toContain('mt-4');
    expect(result).toContain('mr-2');
    expect(result).toContain('mb-8');
    expect(result).toContain('ml-1');
  });

  it('should generate negative margins', () => {
    const result = generateTailwindClasses({
      marginTop: '-1rem',
      marginLeft: '-0.5rem',
    });

    expect(result).toContain('-mt-4');
    expect(result).toContain('-ml-2');
  });

  it('should generate color classes with arbitrary values', () => {
    const result = generateTailwindClasses({
      backgroundColor: '#ff0000',
      borderColor: 'rgba(0,0,0,0.5)',
    });

    expect(result).toContain('bg-[#ff0000]');
    expect(result).toContain('border-[rgba(0,0,0,0.5)]');
  });

  it('should generate common color classes', () => {
    const result = generateTailwindClasses({
      backgroundColor: '#ffffff',
      borderColor: '#000000',
    });

    expect(result).toContain('bg-white');
    expect(result).toContain('border-black');
  });

  it('should generate border radius', () => {
    const result = generateTailwindClasses({
      borderRadius: '8px',
    });

    expect(result).toContain('rounded-lg');
  });

  it('should generate individual corner border radius', () => {
    const result = generateTailwindClasses({
      borderRadiusTopLeft: '8px',
      borderRadiusTopRight: '4px',
    });

    expect(result).toContain('rounded-tl-lg');
    expect(result).toContain('rounded-tr');
  });

  it('should generate overflow classes', () => {
    const result = generateTailwindClasses({ overflow: 'hidden' });

    expect(result).toContain('overflow-hidden');
  });

  it('should generate display classes', () => {
    const result = generateTailwindClasses({ display: 'flex' });

    expect(result).toContain('flex');
  });

  it('should generate flex direction', () => {
    const result = generateTailwindClasses({
      display: 'flex',
      flexDirection: 'column',
    });

    expect(result).toContain('flex');
    expect(result).toContain('flex-col');
  });

  it('should generate percentage-based sizes', () => {
    const result = generateTailwindClasses({
      width: '100%',
      height: '50%',
    });

    expect(result).toContain('w-full');
    expect(result).toContain('h-1/2');
  });

  it('should generate opacity classes', () => {
    const result = generateTailwindClasses({ opacity: '50' });

    expect(result).toContain('opacity-50');
  });

  it('should generate arbitrary opacity for custom values', () => {
    const result = generateTailwindClasses({ opacity: '33' });

    expect(result).toContain('opacity-[0.33]');
  });

  it('should handle empty styles', () => {
    const result = generateTailwindClasses({});

    expect(result).toBe('');
  });

  it('should remove duplicates', () => {
    const result = generateTailwindClasses({
      display: 'flex',
      flexDirection: 'row',
    });

    const classes = result.split(' ');
    const uniqueClasses = [...new Set(classes)];

    expect(classes.length).toBe(uniqueClasses.length);
  });

  it('should handle auto values', () => {
    const result = generateTailwindClasses({
      width: 'auto',
      marginLeft: 'auto',
    });

    expect(result).toContain('w-auto');
    expect(result).toContain('ml-auto');
  });

  it('should generate grid display', () => {
    const result = generateTailwindClasses({ display: 'grid' });

    expect(result).toContain('grid');
  });

  it('should combine multiple properties', () => {
    const result = generateTailwindClasses({
      position: 'absolute',
      top: '0px',
      left: '0px',
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    });

    expect(result).toContain('absolute');
    expect(result).toContain('top-0');
    expect(result).toContain('left-0');
    expect(result).toContain('w-full');
    expect(result).toContain('h-full');
    expect(result).toContain('flex');
    expect(result).toContain('flex-col');
  });
});
