import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import type { SubProject } from '../../../../../lib/component-scanner/types';
import { SubProjectAccordion } from '../SubProjectAccordion';

mock.module('@/lib/platform', () => ({
  usePlatformContext: () => 'vscode-webview',
}));

mock.module('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ContextMenuTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
  ContextMenuContent: () => null,
  ContextMenuItem: () => null,
}));

const subProjects: SubProject[] = [
  {
    name: 'portal',
    path: 'packages/portal',
    supported: true,
    atomGroups: [],
    compositeGroups: [],
    pageGroups: [],
  },
  {
    name: 'legacy',
    path: 'packages/legacy',
    supported: false,
    unsupportedReason: 'React dependency not found',
    atomGroups: [],
    compositeGroups: [],
    pageGroups: [],
  },
];

const originalScrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

function renderAccordion(currentSubProjectPath?: string | null) {
  return render(
    <SubProjectAccordion
      subProjects={subProjects}
      activePath={null}
      loadingComponent={null}
      onComponentClick={() => {}}
      searchQuery=""
      currentSubProjectPath={currentSubProjectPath}
    />,
  );
}

describe('SubProjectAccordion', () => {
  let scrollIntoViewMock: ReturnType<typeof mock>;

  beforeEach(() => {
    scrollIntoViewMock = mock();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
    });
  });

  afterEach(() => {
    scrollIntoViewMock.mockReset?.();
    if (originalScrollIntoViewDescriptor) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoViewDescriptor);
    } else {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });

  it('expands the current sub-project even when that row would normally start collapsed', () => {
    renderAccordion('packages/legacy');

    const legacyButton = screen.getByTestId('hyper-explorer-subproject-unsupported-legacy');
    const chevron = legacyButton.querySelector('svg');

    expect(chevron?.className.toString()).not.toContain('rotate-[-90deg]');
  });

  it('scrolls the matching current sub-project into view', () => {
    renderAccordion('packages/portal');

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('does not scroll when no current sub-project is provided', () => {
    renderAccordion();
    renderAccordion(null);

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });
});
