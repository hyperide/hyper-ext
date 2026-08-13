import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import { GlobalWindow } from 'happy-dom';
import { AddressBar } from '../AddressBar';
import type { RouteSuggestionItem } from '../types';

beforeEach(() => {
  const win = new GlobalWindow({ url: 'http://localhost' });
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    HTMLDivElement: win.HTMLDivElement,
    HTMLInputElement: win.HTMLInputElement,
    HTMLUListElement: win.HTMLUListElement,
    HTMLLIElement: win.HTMLLIElement,
    Element: win.Element,
    Node: win.Node,
    Text: win.Text,
    DocumentFragment: win.DocumentFragment,
    Event: win.Event,
    KeyboardEvent: win.KeyboardEvent,
    MouseEvent: win.MouseEvent,
  });
});

const SUGGESTIONS: RouteSuggestionItem[] = [
  { path: '/', source: 'route-config' },
  { path: '/about', source: 'route-config' },
  { path: '/billing', source: 'link' },
];

function renderBar(overrides: Partial<React.ComponentProps<typeof AddressBar>> = {}) {
  const onNavigate = mock(() => {});
  const utils = render(
    <AddressBar value="/" suggestions={SUGGESTIONS} onNavigate={onNavigate} testId="addr" {...overrides} />,
  );
  const input = utils.getByTestId('addr') as HTMLInputElement;
  return { onNavigate, input, ...utils };
}

describe('AddressBar', () => {
  it('renders no dropdown until focused', () => {
    const { queryByRole } = renderBar();
    expect(queryByRole('listbox')).toBeNull();
  });

  it('shows the suggestions dropdown on focus', () => {
    const { input, getByRole, getAllByRole } = renderBar();
    fireEvent.focus(input);
    expect(getByRole('listbox')).toBeTruthy();
    expect(getAllByRole('option').length).toBe(3);
  });

  it('renders NO dropdown when there are zero suggestions, even when focused', () => {
    const { input, queryByRole } = renderBar({ suggestions: [] });
    fireEvent.focus(input);
    expect(queryByRole('listbox')).toBeNull();
  });

  it('allows free text — Enter navigates to a path that is not in the suggestions', () => {
    const { input, onNavigate } = renderBar();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '/anything/goes' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledWith('/anything/goes');
  });

  it('prefixes a leading slash for free text typed without one', () => {
    const { input, onNavigate } = renderBar();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'dashboard' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledWith('/dashboard');
  });

  it('navigates to a picked suggestion on mouseDown', () => {
    const { input, onNavigate, getByText } = renderBar();
    fireEvent.focus(input);
    fireEvent.mouseDown(getByText('/about'));
    expect(onNavigate).toHaveBeenCalledWith('/about');
  });

  it('filters suggestions by typed substring', () => {
    const { input, getAllByRole } = renderBar();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'bill' } });
    const options = getAllByRole('option');
    expect(options.length).toBe(1);
    expect(options[0].textContent).toContain('/billing');
  });

  it('Enter on a keyboard-highlighted row navigates to that row, not the draft', () => {
    const { input, onNavigate } = renderBar();
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // highlight first (/)
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // highlight second (/about)
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledWith('/about');
  });

  it('Escape closes the dropdown without navigating', () => {
    const { input, onNavigate, getByRole, queryByRole } = renderBar();
    fireEvent.focus(input);
    expect(getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(queryByRole('listbox')).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('blur closes the dropdown', () => {
    const { input, getByRole, queryByRole } = renderBar();
    fireEvent.focus(input);
    expect(getByRole('listbox')).toBeTruthy();
    fireEvent.blur(input);
    expect(queryByRole('listbox')).toBeNull();
  });
});
