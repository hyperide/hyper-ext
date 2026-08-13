import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import type { TreeNode } from '../ElementsTree';
import ElementsTree from '../ElementsTree';

mock.module('@/lib/platform', () => ({
  usePlatformContext: () => 'browser',
}));

const NODE: TreeNode = {
  id: 'node-1',
  type: 'element',
  label: 'View',
};

const NODE_WITH_CHILDREN: TreeNode = {
  id: 'parent-1',
  type: 'element',
  label: 'Container',
  children: [NODE],
};

describe('ElementsTree — scroll into view (Task A)', () => {
  let scrollIntoViewMock: ReturnType<typeof mock>;

  beforeEach(() => {
    scrollIntoViewMock = mock();
    // happy-dom may not implement scrollIntoView; install it globally
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock as unknown as typeof HTMLElement.prototype.scrollIntoView;
  });

  afterEach(() => {
    scrollIntoViewMock.mockReset?.();
  });

  it('calls scrollIntoView when a node becomes selected', () => {
    const { rerender } = render(<ElementsTree tree={[NODE]} selectedElements={[]} onSelectElement={() => {}} />);

    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    rerender(<ElementsTree tree={[NODE]} selectedElements={['node-1']} onSelectElement={() => {}} />);

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
  });

  it('does not call scrollIntoView when node is not selected', () => {
    render(<ElementsTree tree={[NODE]} selectedElements={[]} onSelectElement={() => {}} />);

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('calls scrollIntoView for the correct node when multiple nodes exist', () => {
    const node2: TreeNode = { id: 'node-2', type: 'element', label: 'Text' };

    const { rerender } = render(<ElementsTree tree={[NODE, node2]} selectedElements={[]} onSelectElement={() => {}} />);

    rerender(<ElementsTree tree={[NODE, node2]} selectedElements={['node-2']} onSelectElement={() => {}} />);

    // Only the selected node scrolls into view
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });

  it('also invokes onElementPosition callback with correct id and y when selected', () => {
    const onElementPosition = mock();

    const { rerender } = render(
      <ElementsTree
        tree={[NODE]}
        selectedElements={[]}
        onSelectElement={() => {}}
        onElementPosition={onElementPosition}
      />,
    );

    rerender(
      <ElementsTree
        tree={[NODE]}
        selectedElements={['node-1']}
        onSelectElement={() => {}}
        onElementPosition={onElementPosition}
      />,
    );

    expect(onElementPosition).toHaveBeenCalledTimes(1);
    const [calledId] = onElementPosition.mock.calls[0] as [string, number];
    expect(calledId).toBe('node-1');
  });
});

describe('ElementsTree — auto-expand collapsed parent on external selection (HYP-841)', () => {
  let scrollIntoViewMock: ReturnType<typeof mock>;

  beforeEach(() => {
    scrollIntoViewMock = mock();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock as unknown as typeof HTMLElement.prototype.scrollIntoView;
  });

  afterEach(() => {
    scrollIntoViewMock.mockReset?.();
  });

  it('expands a collapsed parent and scrolls child into view when child becomes selected', () => {
    const collapsedParent: TreeNode = {
      id: 'parent-2',
      type: 'element',
      label: 'CollapsedParent',
      collapsed: true,
      children: [{ id: 'child-1', type: 'element', label: 'Child' }],
    };

    const { rerender, queryByText } = render(
      <ElementsTree tree={[collapsedParent]} selectedElements={[]} onSelectElement={() => {}} />,
    );

    // Child should not be in the DOM while parent is collapsed
    expect(queryByText('Child')).toBeNull();

    // Canvas selects the child externally
    rerender(<ElementsTree tree={[collapsedParent]} selectedElements={['child-1']} onSelectElement={() => {}} />);

    // Parent auto-expands → child renders → scrollIntoView fires
    expect(queryByText('Child')).not.toBeNull();
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
  });

  it('allows manual collapse after auto-expand even while child stays selected', () => {
    const collapsedParent: TreeNode = {
      id: 'parent-3',
      type: 'element',
      label: 'ManualCollapseParent',
      collapsed: true,
      children: [{ id: 'child-2', type: 'element', label: 'ChildStaysSelected' }],
    };

    const { rerender, queryByText, getAllByRole } = render(
      <ElementsTree tree={[collapsedParent]} selectedElements={[]} onSelectElement={() => {}} />,
    );

    // Auto-expand: child becomes selected externally
    rerender(<ElementsTree tree={[collapsedParent]} selectedElements={['child-2']} onSelectElement={() => {}} />);

    expect(queryByText('ChildStaysSelected')).not.toBeNull();

    // User manually clicks the collapse chevron button
    const buttons = getAllByRole('button');
    fireEvent.click(buttons[0]);

    // Child should now be hidden — manual collapse must not be overridden
    expect(queryByText('ChildStaysSelected')).toBeNull();
  });

  it('expands multiple collapsed ancestors to reveal deeply nested selected child', () => {
    const deeplyNested: TreeNode = {
      id: 'grandparent',
      type: 'element',
      label: 'GrandParent',
      collapsed: true,
      children: [
        {
          id: 'middle',
          type: 'element',
          label: 'Middle',
          collapsed: true,
          children: [{ id: 'deep-child', type: 'element', label: 'DeepChild' }],
        },
      ],
    };

    const { rerender, queryByText } = render(
      <ElementsTree tree={[deeplyNested]} selectedElements={[]} onSelectElement={() => {}} />,
    );

    expect(queryByText('DeepChild')).toBeNull();

    rerender(<ElementsTree tree={[deeplyNested]} selectedElements={['deep-child']} onSelectElement={() => {}} />);

    expect(queryByText('DeepChild')).not.toBeNull();
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });
});

describe('ElementsTree — click selects element (Task B)', () => {
  it('calls onSelectElement with node id when row is clicked', () => {
    const onSelectElement = mock();

    const { getByRole } = render(
      <ElementsTree tree={[NODE]} selectedElements={[]} onSelectElement={onSelectElement} />,
    );

    const treeItem = getByRole('treeitem');
    fireEvent.click(treeItem);

    expect(onSelectElement).toHaveBeenCalledTimes(1);
    const [calledId] = onSelectElement.mock.calls[0] as [string, unknown];
    expect(calledId).toBe('node-1');
  });

  it('calls onSelectElement with correct id for nested child node', () => {
    const onSelectElement = mock();

    const { getAllByRole } = render(
      <ElementsTree tree={[NODE_WITH_CHILDREN]} selectedElements={[]} onSelectElement={onSelectElement} />,
    );

    const treeItems = getAllByRole('treeitem');
    // Second item is the child
    fireEvent.click(treeItems[1]);

    expect(onSelectElement).toHaveBeenCalledTimes(1);
    const [calledId] = onSelectElement.mock.calls[0] as [string, unknown];
    expect(calledId).toBe('node-1');
  });

  it('calls onSelectElement via keyboard Enter key', () => {
    const onSelectElement = mock();

    const { getByRole } = render(
      <ElementsTree tree={[NODE]} selectedElements={[]} onSelectElement={onSelectElement} />,
    );

    const treeItem = getByRole('treeitem');
    fireEvent.keyDown(treeItem, { key: 'Enter' });

    expect(onSelectElement).toHaveBeenCalledTimes(1);
    const [calledId] = onSelectElement.mock.calls[0] as [string, unknown];
    expect(calledId).toBe('node-1');
  });
});
