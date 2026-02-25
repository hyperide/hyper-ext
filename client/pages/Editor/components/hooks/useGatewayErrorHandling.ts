/**
 * Hook for managing gateway error state and handlers
 * Handles gateway errors, auto-fix, and retry functionality
 */

import { useCallback, useState } from 'react';

interface ProjectConfigError {
  projectId: string;
  error: string;
}

interface UseGatewayErrorHandlingProps {
  projectConfigError: ProjectConfigError | null;
  componentPath: string | undefined;
  loadComponent: (path: string) => void;
}

interface UseGatewayErrorHandlingReturn {
  hasGatewayError: boolean;
  gatewayErrorMessage: string | null;
  setHasGatewayError: React.Dispatch<React.SetStateAction<boolean>>;
  setGatewayErrorMessage: React.Dispatch<React.SetStateAction<string | null>>;
  handleAutoFix: () => void;
  handleRetryLoad: () => void;
  handleGatewayErrorClose: () => void;
  handleGatewayError: (hasError: boolean, errorMessage?: string | null) => void;
}

/**
 * Manages gateway error state and handlers
 */
export function useGatewayErrorHandling({
  projectConfigError,
  componentPath,
  loadComponent,
}: UseGatewayErrorHandlingProps): UseGatewayErrorHandlingReturn {
  const [hasGatewayError, setHasGatewayError] = useState(false);
  const [gatewayErrorMessage, setGatewayErrorMessage] = useState<string | null>(null);

  // Handle Auto Fix button click for project config errors
  const handleAutoFix = useCallback(() => {
    if (!projectConfigError) return;
    const prompt = `Project configuration error:

\`\`\`json
${JSON.stringify({ error: projectConfigError.error }, null, 2)}
\`\`\`

Please analyze and fix this error.`;
    window.dispatchEvent(
      new CustomEvent('openAIChat', {
        detail: {
          prompt,
          forceNewChat: true,
          projectId: projectConfigError.projectId,
        },
      }),
    );
  }, [projectConfigError]);

  // Handle retry loading component after parse error
  const handleRetryLoad = useCallback(() => {
    if (componentPath) {
      loadComponent(componentPath);
    } else {
      window.location.reload();
    }
  }, [componentPath, loadComponent]);

  // Handle gateway error panel close
  const handleGatewayErrorClose = useCallback(() => {
    setHasGatewayError(false);
    setGatewayErrorMessage(null);
  }, []);

  // Combined handler for IframeCanvas gateway error callback
  const handleGatewayError = useCallback((hasError: boolean, errorMessage?: string | null) => {
    setHasGatewayError(hasError);
    setGatewayErrorMessage(hasError ? (errorMessage ?? null) : null);
  }, []);

  return {
    hasGatewayError,
    gatewayErrorMessage,
    setHasGatewayError,
    setGatewayErrorMessage,
    handleAutoFix,
    handleRetryLoad,
    handleGatewayErrorClose,
    handleGatewayError,
  };
}
