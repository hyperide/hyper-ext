import type { LayoutOption, SizePreset } from './types';

export const IPHONE_SIZES = {
  bezel: { width: 402, height: 874, borderRadius: '64px' },
  safe: { width: 402, height: 874 - 62 - 34, borderRadius: '0 0 64px 64px' },
} as const;

export const SIZE_PRESETS: readonly SizePreset[] = [
  { label: 'Desktop', width: 1920, height: 1080 },
  { label: 'Laptop', width: 1440, height: 900 },
  { label: 'Tablet', width: 1024, height: 768 },
  { label: 'Tablet Portrait', width: 768, height: 1024 },
  { label: 'Mobile', width: 375, height: 667 },
  { label: 'Mobile Large', width: 390, height: 844 },
  { label: 'iPhone 17', width: IPHONE_SIZES.bezel.width, height: IPHONE_SIZES.bezel.height },
  { label: 'iPhone 17 (Safe)', width: IPHONE_SIZES.safe.width, height: IPHONE_SIZES.safe.height },
] as const;

export const LAYOUT_OPTIONS: readonly LayoutOption[] = [
  { row: 0, col: 0, justify: 'flex-start', align: 'flex-start' },
  { row: 0, col: 1, justify: 'center', align: 'flex-start' },
  { row: 0, col: 2, justify: 'flex-end', align: 'flex-start' },
  { row: 1, col: 0, justify: 'flex-start', align: 'center' },
  { row: 1, col: 1, justify: 'center', align: 'center' },
  { row: 1, col: 2, justify: 'flex-end', align: 'center' },
  { row: 2, col: 0, justify: 'flex-start', align: 'flex-end' },
  { row: 2, col: 1, justify: 'center', align: 'flex-end' },
  { row: 2, col: 2, justify: 'flex-end', align: 'flex-end' },
] as const;

export const ZOOM_PRESETS = [25, 50, 75, 100, 125, 150, 200] as const;

export const STATE_OPTIONS = [
  { value: undefined, label: 'Base' },
  { value: 'hover', label: 'Hover' },
  { value: 'focus', label: 'Focus' },
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'first', label: 'First' },
  { value: 'last', label: 'Last' },
  { value: 'odd', label: 'Odd' },
  { value: 'even', label: 'Even' },
] as const;

export const POSITION_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'static', label: 'Static' },
  { value: 'rel', label: 'Relative' },
  { value: 'abs', label: 'Absolute' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'sticky', label: 'Sticky' },
] as const;

export const STYLE_DEBOUNCE_MS = 300;
