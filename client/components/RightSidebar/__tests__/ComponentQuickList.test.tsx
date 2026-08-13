/**
 * @file ComponentQuickList tests (BUG A — Inspector component list when Explorer is hidden)
 *
 * Accessed via: RightSidebar renders <ComponentQuickList> as the empty-state fallback when the
 *   Explorer side bar is hidden and no component is open.
 * Assumptions: the scanner classifies components into atom / composite / PAGE groups; the quick-list
 *   must surface ALL three so every previewable component is pickable (page-level components like
 *   App.tsx were previously dropped).
 */
import { describe, expect, it, mock } from 'bun:test';
import { TID } from '@shared/data-testid-map';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentGroup } from '../../../../lib/component-scanner/types';
import { ComponentQuickList } from '../ComponentQuickList';

const compositeGroups: ComponentGroup[] = [
  { dirPath: 'src/components', components: [{ name: 'Tweet', path: 'src/components/Tweet.tsx' }] },
];
const pageGroups: ComponentGroup[] = [{ dirPath: 'src', components: [{ name: 'App', path: 'src/App.tsx' }] }];

describe('ComponentQuickList', () => {
  it('renders page-level components, not only atoms + composites', () => {
    render(<ComponentQuickList atomGroups={[]} compositeGroups={compositeGroups} pageGroups={pageGroups} />);
    // Composite is present...
    expect(screen.getByTestId(TID.inspector.quickListItem('Tweet'))).toBeTruthy();
    // ...and the page-level App.tsx must be present too.
    expect(screen.getByTestId(TID.inspector.quickListItem('App'))).toBeTruthy();
  });

  it('invokes onComponentClick with name + path when a page item is clicked', () => {
    const onComponentClick = mock(() => {});
    render(
      <ComponentQuickList
        atomGroups={[]}
        compositeGroups={[]}
        pageGroups={pageGroups}
        onComponentClick={onComponentClick}
      />,
    );
    fireEvent.click(screen.getByTestId(TID.inspector.quickListItem('App')));
    expect(onComponentClick).toHaveBeenCalledWith('App', 'src/App.tsx');
  });
});
