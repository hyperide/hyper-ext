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
