/**
 * @file WorkspacePicker UI tests — single source of truth for the workspace switcher.
 *
 * Accessed via: Projects page header ("Projects / <workspace>") and any future
 * surface that needs to switch the active workspace.
 * Assumptions: workspaces/currentWorkspace/setCurrentWorkspace come from authStore;
 * navigation to /workspaces/new goes through react-router's useNavigate.
 *
 * Note (HYP-516): WorkspacePicker returns null when currentWorkspace is null, but on
 * the Projects page that branch is unreachable (the page's `loading` flag only flips
 * false inside loadProjects(), which early-returns while currentWorkspace is null —
 * so the header, and thus this component, never renders without a current workspace).
 * The inline switcher's `|| 'Select workspace'` fallback was therefore dead-defensive;
 * this is a clean swap with no parity loss, so no null-state test is needed here.
 *
 * Scope: this asserts the rendered trigger (current workspace name + testId). Opening
 * the Radix dropdown and switching is covered by the e2e layer — the repo has no
 * Radix-open unit tests because happy-dom can't drive the portal's pointer/floating
 * effects without noisy act() warnings.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, render, screen } from '@testing-library/react';
import { useAuthStore, type Workspace } from '@/stores/authStore';
import WorkspacePicker from '../WorkspacePicker';

const navigateMock = mock(() => {});
mock.module('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

const wsAlpha: Workspace = { id: 'a', name: 'Alpha', slug: 'alpha', role: 'owner' };
const wsBeta: Workspace = { id: 'b', name: 'Beta', slug: 'beta', role: 'member' };

const setStore = (overrides: Partial<ReturnType<typeof useAuthStore.getState>> = {}) => {
  act(() => {
    useAuthStore.setState({ workspaces: [], currentWorkspace: null, ...overrides });
  });
};

beforeEach(() => {
  navigateMock.mockClear();
  setStore();
});

afterEach(() => {
  setStore();
});

describe('WorkspacePicker', () => {
  it('renders the current workspace name in the trigger', () => {
    setStore({ workspaces: [wsAlpha, wsBeta], currentWorkspace: wsAlpha });
    act(() => void render(<WorkspacePicker />));
    const trigger = screen.getByTestId('WorkspacePicker-trigger');
    expect(trigger.textContent).toContain('Alpha');
  });

  it('exposes the WorkspacePicker-trigger test id for E2E selectors', () => {
    setStore({ workspaces: [wsAlpha], currentWorkspace: wsAlpha });
    act(() => void render(<WorkspacePicker />));
    expect(screen.getByTestId('WorkspacePicker-trigger')).not.toBeNull();
  });

  it('renders nothing when no workspace is selected (Projects guards this path upstream)', () => {
    setStore({ workspaces: [], currentWorkspace: null });
    const { container } = render(<WorkspacePicker />);
    expect(container.querySelector('[data-testid="WorkspacePicker-trigger"]')).toBeNull();
  });
});
