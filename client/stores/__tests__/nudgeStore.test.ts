import { beforeEach, describe, expect, test } from 'bun:test';
import { nudgeStore } from '../nudgeStore';

beforeEach(() => {
  nudgeStore.getState().reset();
});

describe('nudgeStore', () => {
  test('default state is numeric mode, hidden', () => {
    const state = nudgeStore.getState();
    expect(state.mode).toBe('numeric');
    expect(state.visible).toBe(false);
    expect(state.altStep).toBe(0.1);
    expect(state.shiftStep).toBe(10);
    expect(state.editingTarget).toBeNull();
    expect(state.activeProperty).toBeNull();
    expect(state.currentValue).toBe('');
  });

  test('show sets visible, activeProperty, and currentValue', () => {
    nudgeStore.getState().show('width', '240px');
    const state = nudgeStore.getState();
    expect(state.visible).toBe(true);
    expect(state.activeProperty).toBe('width');
    expect(state.currentValue).toBe('240px');
  });

  test('show is idempotent when already visible with same property', () => {
    nudgeStore.getState().show('width', '240px');
    nudgeStore.getState().show('width', '241px');
    // Updates currentValue but doesn't reset other state
    expect(nudgeStore.getState().currentValue).toBe('241px');
  });

  test('hide resets visibility and editing', () => {
    nudgeStore.getState().show('width', '240px');
    nudgeStore.getState().startEditing('shift');
    nudgeStore.getState().hide();
    const state = nudgeStore.getState();
    expect(state.visible).toBe(false);
    expect(state.editingTarget).toBeNull();
  });

  test('toggleMode switches between numeric and token', () => {
    expect(nudgeStore.getState().mode).toBe('numeric');
    nudgeStore.getState().toggleMode();
    expect(nudgeStore.getState().mode).toBe('token');
    nudgeStore.getState().toggleMode();
    expect(nudgeStore.getState().mode).toBe('numeric');
  });

  test('setAltStep updates alt step', () => {
    nudgeStore.getState().setAltStep(0.5);
    expect(nudgeStore.getState().altStep).toBe(0.5);
  });

  test('setShiftStep updates shift step', () => {
    nudgeStore.getState().setShiftStep(20);
    expect(nudgeStore.getState().shiftStep).toBe(20);
  });

  test('startEditing / stopEditing', () => {
    nudgeStore.getState().startEditing('alt');
    expect(nudgeStore.getState().editingTarget).toBe('alt');
    nudgeStore.getState().stopEditing();
    expect(nudgeStore.getState().editingTarget).toBeNull();
  });

  test('highlightedTarget defaults to shift, switches on alt use', () => {
    expect(nudgeStore.getState().highlightedTarget).toBe('shift');
    nudgeStore.getState().setHighlightedTarget('alt');
    expect(nudgeStore.getState().highlightedTarget).toBe('alt');
  });

  test('getStepForModifiers returns correct step for px unit', () => {
    const { getStepForModifiers } = nudgeStore.getState();
    expect(getStepForModifiers(false, false, 'px')).toBe(1);
    expect(getStepForModifiers(false, true, 'px')).toBe(0.1);
    expect(getStepForModifiers(true, false, 'px')).toBe(10);
  });

  test('getStepForModifiers returns rem-aware defaults', () => {
    const { getStepForModifiers } = nudgeStore.getState();
    expect(getStepForModifiers(false, false, 'rem')).toBe(0.25);
    expect(getStepForModifiers(false, true, 'rem')).toBe(0.025);
    expect(getStepForModifiers(true, false, 'rem')).toBe(2.5);
  });

  test('getStepForModifiers uses custom steps when set (absolute, not per-unit)', () => {
    nudgeStore.getState().setAltStep(0.5);
    nudgeStore.getState().setShiftStep(20);
    const { getStepForModifiers } = nudgeStore.getState();
    expect(getStepForModifiers(false, true, 'px')).toBe(0.5);
    expect(getStepForModifiers(true, false, 'px')).toBe(20);
    // Custom steps apply regardless of unit — user explicitly chose these values
    expect(getStepForModifiers(false, true, 'rem')).toBe(0.5);
    expect(getStepForModifiers(true, false, 'rem')).toBe(20);
  });

  test('setAltStep does not affect shift unit defaults, and vice versa', () => {
    // Setting only altStep must not make shiftStep use the custom value
    nudgeStore.getState().setAltStep(0.2);
    expect(nudgeStore.getState().getStepForModifiers(true, false, 'rem')).toBe(2.5);
    expect(nudgeStore.getState().getStepForModifiers(false, true, 'rem')).toBe(0.2);

    // Setting only shiftStep must not make altStep use the custom value
    nudgeStore.getState().reset();
    nudgeStore.getState().setShiftStep(25);
    expect(nudgeStore.getState().getStepForModifiers(false, true, 'rem')).toBe(0.025);
    expect(nudgeStore.getState().getStepForModifiers(true, false, 'rem')).toBe(25);
  });

  test('getStepForModifiers falls back to px defaults for unknown/empty unit', () => {
    const { getStepForModifiers } = nudgeStore.getState();
    expect(getStepForModifiers(false, false, '')).toBe(1);
    expect(getStepForModifiers(false, true, '')).toBe(0.1);
  });

  test('updateCurrentValue updates value without changing visibility', () => {
    nudgeStore.getState().show('width', '240px');
    nudgeStore.getState().updateCurrentValue('241px');
    expect(nudgeStore.getState().currentValue).toBe('241px');
    expect(nudgeStore.getState().visible).toBe(true);
  });

  test('setProjectId updates persist key', () => {
    nudgeStore.getState().setProjectId('proj-123');
    expect(nudgeStore.getState().projectId).toBe('proj-123');
  });

  test('saveForLater + setProjectId round-trip restores steps', () => {
    nudgeStore.getState().setProjectId('proj-a');
    nudgeStore.getState().setAltStep(0.5);
    nudgeStore.getState().setShiftStep(25);
    nudgeStore.getState().saveForLater();

    // Switch to another project
    nudgeStore.getState().setProjectId('proj-b');
    expect(nudgeStore.getState().altStep).toBe(0.1);
    expect(nudgeStore.getState().shiftStep).toBe(10);

    // Switch back — steps restored
    nudgeStore.getState().setProjectId('proj-a');
    expect(nudgeStore.getState().altStep).toBe(0.5);
    expect(nudgeStore.getState().shiftStep).toBe(25);
  });

  test('getStepForModifiers returns correct step for % unit', () => {
    const { getStepForModifiers } = nudgeStore.getState();
    expect(getStepForModifiers(false, false, '%')).toBe(1);
    expect(getStepForModifiers(false, true, '%')).toBe(0.1);
    expect(getStepForModifiers(true, false, '%')).toBe(10);
  });

  test('reset does not clear saved project steps', () => {
    nudgeStore.getState().setProjectId('proj-a');
    nudgeStore.getState().setShiftStep(50);
    nudgeStore.getState().saveForLater();
    nudgeStore.getState().reset();
    nudgeStore.getState().setProjectId('proj-a');
    expect(nudgeStore.getState().shiftStep).toBe(50);
  });

  test('saveForLater does nothing when projectId is empty', () => {
    nudgeStore.getState().setAltStep(0.5);
    nudgeStore.getState().saveForLater();
    nudgeStore.getState().setProjectId('proj-empty-guard');
    expect(nudgeStore.getState().altStep).toBe(0.1);
  });

  test('reset restores defaults', () => {
    nudgeStore.getState().show('width', '240px');
    nudgeStore.getState().toggleMode();
    nudgeStore.getState().setShiftStep(50);
    nudgeStore.getState().reset();
    const state = nudgeStore.getState();
    expect(state.mode).toBe('numeric');
    expect(state.visible).toBe(false);
    expect(state.shiftStep).toBe(10);
    expect(state.currentValue).toBe('');
  });
});
