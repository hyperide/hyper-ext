/**
 * Tests for useLogsPanelState transition logic.
 *
 * Tests the exported pure functions that the hook uses internally.
 * If the hook's logic breaks, these tests break too — they share the same code.
 */

import { describe, expect, it } from 'bun:test';
import type { RuntimeError } from '@shared/runtime-error';
import {
  computeDismissAction,
  computeToggleAction,
  type ErrorInputs,
  hasAnyError,
  shouldResetCollapsed,
} from '../useLogsPanelState';

// --- Fixtures ---

const NO_ERRORS: ErrorInputs = {
  hasGatewayError: false,
  runtimeError: null,
  parseErrorAsRuntimeError: null,
};

const RUNTIME_ERROR: RuntimeError = {
  framework: 'vite',
  type: 'Runtime Error',
  message: 'TypeError: x is not a function',
  fullText: 'TypeError: x is not a function\n    at App.tsx:10',
};

const PARSE_ERROR: RuntimeError = {
  framework: 'vite',
  type: 'Build Error',
  message: 'SyntaxError: Unexpected token',
  fullText: 'SyntaxError: Unexpected token\n    at App.tsx:5',
};

// --- Tests ---

describe('hasAnyError', () => {
  it('should return false when no errors', () => {
    expect(hasAnyError(NO_ERRORS)).toBe(false);
  });

  it('should return true for gateway error', () => {
    expect(hasAnyError({ ...NO_ERRORS, hasGatewayError: true })).toBe(true);
  });

  it('should return true for runtime error', () => {
    expect(hasAnyError({ ...NO_ERRORS, runtimeError: RUNTIME_ERROR })).toBe(true);
  });

  it('should return true for parse error', () => {
    expect(hasAnyError({ ...NO_ERRORS, parseErrorAsRuntimeError: PARSE_ERROR })).toBe(true);
  });
});

describe('computeDismissAction', () => {
  it('should collapse when gateway error is present', () => {
    const action = computeDismissAction({ ...NO_ERRORS, hasGatewayError: true });
    expect(action).toEqual({ collapsed: true });
  });

  it('should collapse when runtime error is present', () => {
    const action = computeDismissAction({ ...NO_ERRORS, runtimeError: RUNTIME_ERROR });
    expect(action).toEqual({ collapsed: true });
  });

  it('should collapse when parse error is present', () => {
    const action = computeDismissAction({ ...NO_ERRORS, parseErrorAsRuntimeError: PARSE_ERROR });
    expect(action).toEqual({ collapsed: true });
  });

  it('should delegate to store when no errors', () => {
    const action = computeDismissAction(NO_ERRORS);
    expect(action).toEqual({ delegateToStore: true });
  });

  it('should collapse when all error types present simultaneously', () => {
    const action = computeDismissAction({
      hasGatewayError: true,
      runtimeError: RUNTIME_ERROR,
      parseErrorAsRuntimeError: PARSE_ERROR,
    });
    expect(action).toEqual({ collapsed: true });
  });
});

describe('computeToggleAction', () => {
  it('should expand when collapsed and errors present', () => {
    const action = computeToggleAction(true, { ...NO_ERRORS, runtimeError: RUNTIME_ERROR });
    expect(action).toEqual({ collapsed: false });
  });

  it('should collapse when expanded and errors present', () => {
    const action = computeToggleAction(false, { ...NO_ERRORS, hasGatewayError: true });
    expect(action).toEqual({ collapsed: true });
  });

  it('should delegate to store when no errors (expanded)', () => {
    const action = computeToggleAction(false, NO_ERRORS);
    expect(action).toEqual({ delegateToStore: true });
  });

  it('should delegate to store when no errors (collapsed — edge case after error clears mid-render)', () => {
    const action = computeToggleAction(true, NO_ERRORS);
    expect(action).toEqual({ delegateToStore: true });
  });
});

describe('shouldResetCollapsed', () => {
  it('should reset when all errors clear', () => {
    expect(shouldResetCollapsed(NO_ERRORS)).toBe(true);
  });

  it('should not reset when gateway error persists', () => {
    expect(shouldResetCollapsed({ ...NO_ERRORS, hasGatewayError: true })).toBe(false);
  });

  it('should not reset when runtime error persists', () => {
    expect(shouldResetCollapsed({ ...NO_ERRORS, runtimeError: RUNTIME_ERROR })).toBe(false);
  });

  it('should not reset when parse error persists', () => {
    expect(shouldResetCollapsed({ ...NO_ERRORS, parseErrorAsRuntimeError: PARSE_ERROR })).toBe(false);
  });
});

describe('full lifecycle scenarios', () => {
  it('error appears → dismiss → floating island → toggle → panel back', () => {
    const errors: ErrorInputs = { ...NO_ERRORS, runtimeError: RUNTIME_ERROR };

    // Dismiss with error → collapses
    const dismissAction = computeDismissAction(errors);
    expect(dismissAction).toEqual({ collapsed: true });

    // Toggle from collapsed state → expands
    const toggleAction = computeToggleAction(true, errors);
    expect(toggleAction).toEqual({ collapsed: false });
  });

  it('error appears → dismiss → error clears → auto-reset', () => {
    // Dismiss with error
    const dismissAction = computeDismissAction({ ...NO_ERRORS, hasGatewayError: true });
    expect(dismissAction).toEqual({ collapsed: true });

    // Error clears → should reset
    expect(shouldResetCollapsed(NO_ERRORS)).toBe(true);
  });

  it('toggle cycles collapse/expand while errors persist', () => {
    const errors: ErrorInputs = { ...NO_ERRORS, runtimeError: RUNTIME_ERROR };

    // Start expanded → collapse
    let action = computeToggleAction(false, errors);
    expect(action).toEqual({ collapsed: true });

    // Now collapsed → expand
    action = computeToggleAction(true, errors);
    expect(action).toEqual({ collapsed: false });

    // Expanded again → collapse
    action = computeToggleAction(false, errors);
    expect(action).toEqual({ collapsed: true });
  });
});
