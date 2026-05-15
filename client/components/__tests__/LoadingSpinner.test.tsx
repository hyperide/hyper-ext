import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { LoadingSpinner } from '@/components/LoadingSpinner';

describe('LoadingSpinner', () => {
  it('renders the canonical SaaS spinner — animate-spin + border-primary', () => {
    const { container } = render(<LoadingSpinner />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).not.toBeNull();
    expect(spinner?.classList.contains('rounded-full')).toBe(true);
    expect(spinner?.classList.contains('border-primary')).toBe(true);
    expect(spinner?.classList.contains('border-b-2')).toBe(true);
  });

  it('renders an optional label', () => {
    const { getByText } = render(<LoadingSpinner label="Loading component..." />);
    expect(getByText('Loading component...')).not.toBeNull();
  });

  it('omits the label paragraph when label prop is missing', () => {
    const { container } = render(<LoadingSpinner />);
    expect(container.querySelector('p')).toBeNull();
  });

  it('uses h-12 w-12 by default (canonical full-screen size)', () => {
    const { container } = render(<LoadingSpinner />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner?.classList.contains('h-12')).toBe(true);
    expect(spinner?.classList.contains('w-12')).toBe(true);
  });

  it('uses h-8 w-8 for size="md"', () => {
    const { container } = render(<LoadingSpinner size="md" />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner?.classList.contains('h-8')).toBe(true);
    expect(spinner?.classList.contains('w-8')).toBe(true);
  });

  it('exposes a default test id for E2E assertions', () => {
    const { getByTestId } = render(<LoadingSpinner />);
    expect(getByTestId('loading-spinner')).not.toBeNull();
  });

  it('respects an explicit data-testid override', () => {
    const { getByTestId } = render(<LoadingSpinner data-testid="my-spinner" />);
    expect(getByTestId('my-spinner')).not.toBeNull();
  });

  it('keeps the SaaS background classes for parent contrast', () => {
    const { getByTestId } = render(<LoadingSpinner />);
    const root = getByTestId('loading-spinner');
    expect(root.classList.contains('bg-slate-100')).toBe(true);
    expect(root.classList.contains('dark:bg-slate-900')).toBe(true);
  });
});
