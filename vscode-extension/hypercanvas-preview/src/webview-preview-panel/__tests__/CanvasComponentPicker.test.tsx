/**
 * @file CanvasComponentPicker tests (HYP — pick a component from the canvas when BOTH side panels are closed).
 *
 * Accessed via: PreviewPanelApp renders <CanvasComponentPicker> as the empty-state body when no
 *   component is selected AND both the Explorer + Inspector side panels are hidden — the only place
 *   left to pick a component. Clicking an item drives the normal stateHub selection pipeline.
 * Assumptions: the scanner classifies components into atom / composite / PAGE groups; the picker must
 *   surface ALL three so every previewable component is reachable with no panel open.
 *
 * Same DOM-walking workaround as DisconnectedScreen.test — happy-dom's selector parser leaks state
 * across files in the full bun:test suite, so we iterate Element.children instead of querySelector.
 */

import { describe, expect, it, mock } from 'bun:test';
import { TID } from '@shared/data-testid-map';
import { fireEvent, render } from '@testing-library/react';
import type { ComponentGroup } from '../../../../../lib/component-scanner/types';
import { CanvasComponentPicker, hasPickerComponents, shouldShowComponentPicker } from '../CanvasComponentPicker';

function find(container: Element, testid: string): HTMLElement {
  const stack: Element[] = [container];
  while (stack.length) {
    const el = stack.pop();
    if (!el) continue;
    if (el.getAttribute && el.getAttribute('data-testid') === testid) return el as HTMLElement;
    for (let i = 0; i < el.children.length; i++) stack.push(el.children[i]);
  }
  throw new Error(`No element with data-testid="${testid}"`);
}

function findOptional(container: Element, testid: string): HTMLElement | null {
  try {
    return find(container, testid);
  } catch {
    return null;
  }
}

const atomGroups: ComponentGroup[] = [
  { dirPath: 'src/components/ui', components: [{ name: 'Button', path: 'src/components/ui/Button.tsx' }] },
];
const compositeGroups: ComponentGroup[] = [
  { dirPath: 'src/components', components: [{ name: 'Tweet', path: 'src/components/Tweet.tsx' }] },
];
const pageGroups: ComponentGroup[] = [{ dirPath: 'src', components: [{ name: 'App', path: 'src/App.tsx' }] }];

const fullGroups = { atomGroups, compositeGroups, pageGroups };

describe('shouldShowComponentPicker', () => {
  it('shows only when no component is selected AND both panels hidden AND components exist', () => {
    expect(shouldShowComponentPicker({ showNoComponentHint: true, sidePanelsHidden: true, hasComponents: true })).toBe(
      true,
    );
  });

  it('is hidden when a side panel is open (the list is reachable there instead)', () => {
    expect(shouldShowComponentPicker({ showNoComponentHint: true, sidePanelsHidden: false, hasComponents: true })).toBe(
      false,
    );
  });

  it('is hidden when a component is already selected', () => {
    expect(shouldShowComponentPicker({ showNoComponentHint: false, sidePanelsHidden: true, hasComponents: true })).toBe(
      false,
    );
  });

  it('is hidden when the project has no components', () => {
    expect(shouldShowComponentPicker({ showNoComponentHint: true, sidePanelsHidden: true, hasComponents: false })).toBe(
      false,
    );
  });
});

describe('hasPickerComponents', () => {
  it('is true when any group carries a component', () => {
    expect(hasPickerComponents({ atomGroups: [], compositeGroups: [], pageGroups })).toBe(true);
  });

  it('is false when every group is empty', () => {
    expect(hasPickerComponents({ atomGroups: [], compositeGroups: [], pageGroups: [] })).toBe(false);
    expect(hasPickerComponents(null)).toBe(false);
  });
});

describe('CanvasComponentPicker', () => {
  it('renders the picker root testid', () => {
    const { container } = render(<CanvasComponentPicker groups={fullGroups} onPick={() => {}} />);
    expect(findOptional(container, TID.preview.componentPicker)).not.toBeNull();
  });

  it('renders an item for atoms, composites AND page-level components', () => {
    const { container } = render(<CanvasComponentPicker groups={fullGroups} onPick={() => {}} />);
    expect(findOptional(container, TID.preview.componentPickerItem('Button'))).not.toBeNull();
    expect(findOptional(container, TID.preview.componentPickerItem('Tweet'))).not.toBeNull();
    // Page-level App.tsx must be pickable too (dropped components were the inspector bug).
    expect(findOptional(container, TID.preview.componentPickerItem('App'))).not.toBeNull();
  });

  it('invokes onPick with the component name + path when an item is clicked', () => {
    const onPick = mock((_name: string, _path: string) => {});
    const { container } = render(<CanvasComponentPicker groups={fullGroups} onPick={onPick} />);
    fireEvent.click(find(container, TID.preview.componentPickerItem('Tweet')));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('Tweet', 'src/components/Tweet.tsx');
  });
});
