/**
 * Hook for managing logs panel collapsed/expanded state.
 * When errors are present and user dismisses the panel, it collapses
 * into a floating island instead of fully closing.
 */

import { useCallback, useEffect, useState } from 'react';
import type { RuntimeError } from '@/../../shared/runtime-error';
import { useEditorStore } from '@/stores/editorStore';

// --- Pure transition logic (exported for testing) ---

export interface ErrorInputs {
  hasGatewayError: boolean;
  runtimeError: RuntimeError | null;
  parseErrorAsRuntimeError: RuntimeError | null;
}

export type PanelAction = { collapsed: boolean } | { delegateToStore: true };

export function hasAnyError(inputs: ErrorInputs): boolean {
  return inputs.hasGatewayError || inputs.runtimeError !== null || inputs.parseErrorAsRuntimeError !== null;
}

/** Dismiss: collapse if errors present, otherwise delegate to store to close panel */
export function computeDismissAction(inputs: ErrorInputs): PanelAction {
  if (hasAnyError(inputs)) {
    return { collapsed: true };
  }
  return { delegateToStore: true };
}

/** Toggle from AI Chat button: collapse/expand when errors force visibility */
export function computeToggleAction(isCollapsed: boolean, inputs: ErrorInputs): PanelAction {
  const errorsPresent = hasAnyError(inputs);
  if (isCollapsed && errorsPresent) {
    return { collapsed: false };
  }
  if (errorsPresent) {
    return { collapsed: true };
  }
  return { delegateToStore: true };
}

/** Auto-reset: clear collapsed state when all errors disappear */
export function shouldResetCollapsed(inputs: ErrorInputs): boolean {
  return !hasAnyError(inputs);
}

// --- React hook ---

type UseLogsPanelStateProps = ErrorInputs;

interface UseLogsPanelStateReturn {
  isLogsPanelOpen: boolean;
  isLogsPanelCollapsed: boolean;
  handleLogsDismiss: () => void;
  handleExpandLogs: () => void;
  handleToggleLogs: () => void;
}

export function useLogsPanelState({
  hasGatewayError,
  runtimeError,
  parseErrorAsRuntimeError,
}: UseLogsPanelStateProps): UseLogsPanelStateReturn {
  const { isLogsPanelOpen, toggleLogsPanelWithDock } = useEditorStore();

  // Errors present but panel dismissed → show floating island
  const [isLogsPanelCollapsed, setIsLogsPanelCollapsed] = useState(false);

  // Auto-reset collapsed when errors disappear — island vanishes automatically
  useEffect(() => {
    if (shouldResetCollapsed({ hasGatewayError, runtimeError, parseErrorAsRuntimeError })) {
      setIsLogsPanelCollapsed(false);
    }
  }, [hasGatewayError, runtimeError, parseErrorAsRuntimeError]);

  const handleLogsDismiss = useCallback(() => {
    const action = computeDismissAction({ hasGatewayError, runtimeError, parseErrorAsRuntimeError });
    if ('delegateToStore' in action) {
      toggleLogsPanelWithDock();
    } else {
      setIsLogsPanelCollapsed(action.collapsed);
    }
  }, [hasGatewayError, runtimeError, parseErrorAsRuntimeError, toggleLogsPanelWithDock]);

  const handleExpandLogs = useCallback(() => {
    setIsLogsPanelCollapsed(false);
  }, []);

  /** Toggle from AI Chat button — collapse/expand when errors force visibility */
  const handleToggleLogs = useCallback(() => {
    const action = computeToggleAction(isLogsPanelCollapsed, {
      hasGatewayError,
      runtimeError,
      parseErrorAsRuntimeError,
    });
    if ('delegateToStore' in action) {
      toggleLogsPanelWithDock();
    } else {
      setIsLogsPanelCollapsed(action.collapsed);
    }
  }, [isLogsPanelCollapsed, hasGatewayError, runtimeError, parseErrorAsRuntimeError, toggleLogsPanelWithDock]);

  return {
    isLogsPanelOpen,
    isLogsPanelCollapsed,
    handleLogsDismiss,
    handleExpandLogs,
    handleToggleLogs,
  };
}
