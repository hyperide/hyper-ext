import { useCallback } from 'react';

interface UseIDEHandlersDeps {
  setIframeError: (error: { message: string | null; retryCount: number }) => void;
  setActiveFile: (path: string) => void;
}

export function useIDEHandlers(deps: UseIDEHandlersDeps) {
  const { setIframeError, setActiveFile } = deps;

  const handleIframeErrorChange = useCallback(
    (error: string | null, retryCount: number) => {
      setIframeError({ message: error, retryCount });
    },
    [setIframeError],
  );

  const handleIDEActiveFileChange = useCallback(
    (filePath: string | null) => {
      if (filePath) {
        const normalizedPath = filePath.replace(/^\/app\//, '');
        setActiveFile(normalizedPath);
      }
    },
    [setActiveFile],
  );

  return {
    handleIframeErrorChange,
    handleIDEActiveFileChange,
  };
}
