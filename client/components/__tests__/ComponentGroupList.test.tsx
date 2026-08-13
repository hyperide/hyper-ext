import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react';
import type { ComponentGroup } from '../../../lib/component-scanner/types';
import { ComponentGroupList } from '../ComponentGroupList';

mock.module('@/lib/platform', () => ({
  usePlatformContext: () => 'vscode-webview',
}));

// Stub out context-menu (Radix portal + popper) — not relevant for scroll tests
mock.module('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ContextMenuTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
  ContextMenuContent: () => null,
  ContextMenuItem: () => null,
}));

const GROUP: ComponentGroup = {
  dirPath: 'src/pages',
  components: [
    { name: 'LoginScreen', path: 'src/pages/LoginScreen.tsx' },
    { name: 'HomeScreen', path: 'src/pages/HomeScreen.tsx' },
    { name: 'ProfileScreen', path: 'src/pages/ProfileScreen.tsx' },
  ],
};

describe('ComponentGroupList — scroll to active component', () => {
  let scrollIntoViewMock: ReturnType<typeof mock>;

  beforeEach(() => {
    scrollIntoViewMock = mock();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock as unknown as typeof HTMLElement.prototype.scrollIntoView;
  });

  afterEach(() => {
    scrollIntoViewMock.mockReset?.();
  });

  it('calls scrollIntoView when activeComponentPath is set on mount', () => {
    render(
      <ComponentGroupList
        groups={[GROUP]}
        activeComponentPath="src/pages/LoginScreen.tsx"
        onComponentClick={() => {}}
      />,
    );

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
  });

  it('does not call scrollIntoView when no component is active', () => {
    render(<ComponentGroupList groups={[GROUP]} activeComponentPath={null} onComponentClick={() => {}} />);

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('calls scrollIntoView when activeComponentPath changes to a new component', () => {
    const { rerender } = render(
      <ComponentGroupList groups={[GROUP]} activeComponentPath={null} onComponentClick={() => {}} />,
    );

    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    rerender(
      <ComponentGroupList
        groups={[GROUP]}
        activeComponentPath="src/pages/HomeScreen.tsx"
        onComponentClick={() => {}}
      />,
    );

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
  });

  it('scrolls to the new item, not the old one, when active path switches', () => {
    const { rerender } = render(
      <ComponentGroupList
        groups={[GROUP]}
        activeComponentPath="src/pages/LoginScreen.tsx"
        onComponentClick={() => {}}
      />,
    );

    // Reset after first mount call
    scrollIntoViewMock.mockClear?.();

    rerender(
      <ComponentGroupList
        groups={[GROUP]}
        activeComponentPath="src/pages/ProfileScreen.tsx"
        onComponentClick={() => {}}
      />,
    );

    // Only the newly-active item scrolls; the previously-active one does not
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });
});
