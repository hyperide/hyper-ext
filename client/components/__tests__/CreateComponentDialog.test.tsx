/**
 * Tests for the guided "New component" dialog (HYP-1184) — type picker,
 * live name validation, collision detection, and the submit flow.
 */

import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { TID } from '@shared/data-testid-map';
import type { ComponentGroup } from '../../../lib/component-scanner/types';
import { CreateComponentDialog } from '../CreateComponentDialog';

const atomGroups: ComponentGroup[] = [
  {
    dirPath: 'src/components/ui',
    components: [
      { name: 'Button.tsx', path: 'src/components/ui/Button.tsx' },
      { name: 'Badge.tsx', path: 'src/components/ui/Badge.tsx' },
    ],
  },
  { dirPath: 'src/components', components: [{ name: 'Logo.tsx', path: 'src/components/Logo.tsx' }] },
];

function renderDialog(overrides: Partial<Parameters<typeof CreateComponentDialog>[0]> = {}) {
  const props = {
    open: true,
    initialKind: 'atom' as const,
    onClose: mock(() => {}),
    atomGroups,
    compositeGroups: [],
    pageGroups: [],
    onCreate: mock(() => Promise.resolve({ name: 'Pill', relativePath: 'src/components/ui/Pill.tsx' })),
    onCreated: mock(() => {}),
    ...overrides,
  };
  return { ...render(<CreateComponentDialog {...props} />), props };
}

describe('CreateComponentDialog', () => {
  it('renders the type picker with plain-language descriptions', () => {
    const { getByTestId, getByText } = renderDialog();
    expect(getByTestId(TID.explorer.createComponentKind('atom'))).not.toBeNull();
    expect(getByText(/small reusable piece/i)).not.toBeNull();
    expect(getByText(/full screen/i)).not.toBeNull();
  });

  it('blocks submit with a friendly error for a lowercase name', () => {
    const { getByTestId, getByText } = renderDialog();
    fireEvent.change(getByTestId(TID.explorer.createComponentNameInput), { target: { value: 'pill' } });
    expect(getByText(/capital letter/i)).not.toBeNull();
    expect((getByTestId(TID.explorer.createComponentSubmit) as HTMLButtonElement).disabled).toBe(true);
  });

  it('flags a name that collides with an existing component', () => {
    const { getByTestId, getByText } = renderDialog();
    fireEvent.change(getByTestId(TID.explorer.createComponentNameInput), { target: { value: 'Badge' } });
    expect(getByText(/already have a component with that name/i)).not.toBeNull();
    expect((getByTestId(TID.explorer.createComponentSubmit) as HTMLButtonElement).disabled).toBe(true);
  });

  it('submits with kind, name and the auto-picked target dir, then reports success', async () => {
    const { getByTestId, props } = renderDialog();
    fireEvent.change(getByTestId(TID.explorer.createComponentNameInput), { target: { value: 'Pill' } });
    fireEvent.click(getByTestId(TID.explorer.createComponentSubmit));
    await waitFor(() => expect(props.onCreate).toHaveBeenCalledWith('atom', 'Pill', 'src/components/ui'));
    await waitFor(() =>
      expect(props.onCreated).toHaveBeenCalledWith(
        { name: 'Pill', relativePath: 'src/components/ui/Pill.tsx' },
        'atom',
      ),
    );
    expect(props.onClose).toHaveBeenCalled();
  });

  it('surfaces a host-side error instead of closing', async () => {
    const onCreate = mock(() => Promise.reject(new Error('A file named Pill.tsx already exists there')));
    const { getByTestId, findByText, props } = renderDialog({ onCreate });
    fireEvent.change(getByTestId(TID.explorer.createComponentNameInput), { target: { value: 'Pill' } });
    fireEvent.click(getByTestId(TID.explorer.createComponentSubmit));
    await findByText(/already exists/i);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('switches the target dir when the page kind is picked', () => {
    const pageGroups: ComponentGroup[] = [
      { dirPath: 'src/pages', components: [{ name: 'Home.tsx', path: 'src/pages/Home.tsx' }] },
    ];
    const { getByTestId, getByText } = renderDialog({ pageGroups });
    fireEvent.click(getByTestId(TID.explorer.createComponentKind('page')));
    expect(getByText(/src\/pages\//)).not.toBeNull();
  });

  it('derives the page fallback from the active sub-project in a monorepo', () => {
    // Scanner contract: monorepos return flat-empty pageGroups; atoms/composites
    // are flattened with sub-project-prefixed dirPaths.
    const subProjects = [
      {
        name: 'web',
        path: 'targets/web',
        supported: true,
        atomGroups: [],
        compositeGroups: [],
        pageGroups: [],
      },
    ];
    const monorepoAtoms: ComponentGroup[] = [
      {
        dirPath: 'targets/web/src/components',
        components: [{ name: 'A.tsx', path: 'targets/web/src/components/A.tsx' }],
      },
    ];
    const { getByTestId, getByText } = renderDialog({
      atomGroups: monorepoAtoms,
      pageGroups: [],
      subProjects,
      activeSubProjectPath: 'targets/web',
    });
    fireEvent.click(getByTestId(TID.explorer.createComponentKind('page')));
    expect(getByText(/targets\/web\/src\/pages\//)).not.toBeNull();
  });
});
