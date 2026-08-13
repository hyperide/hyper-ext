import { useCallback } from 'react';
import { toast } from '@/hooks/use-toast';
import { authFetch } from '@/utils/authFetch';
import type { CanvasEngine } from '@/lib/canvas-engine';

interface UseNavigationHandlersDeps {
  selectedIds: string[];
  componentPath: string | null;
  engine: CanvasEngine | null;
  openFile: (path: string, content: string) => void;
  goToCode: (path: string, line: number, column: number) => void;
  childrenLocation: { line: number; column: number } | undefined;
}

export function useNavigationHandlers(deps: UseNavigationHandlersDeps) {
  const { selectedIds, componentPath, engine, openFile, goToCode, childrenLocation } = deps;

  const handleGoToTextCode = useCallback(async () => {
    if (selectedIds.length === 0 || !componentPath || !engine) {
      return;
    }

    const goToSelectedId = selectedIds[0];
    try {
      const response = await authFetch(
        `/api/get-element-location?elementId=${encodeURIComponent(goToSelectedId)}&componentPath=${encodeURIComponent(componentPath)}`,
      );

      if (!response.ok) {
        toast({
          variant: 'destructive',
          title: 'Navigation Error',
          description: 'Could not find element location in code',
        });
        return;
      }

      const data = await response.json();

      if (!data.success || !data.location) {
        toast({
          variant: 'destructive',
          title: 'Navigation Error',
          description: 'Could not find element location in code',
        });
        return;
      }

      const targetLocation = data.childrenLocation || data.location;
      const fileResponse = await authFetch(`/api/read-file?path=${encodeURIComponent(componentPath)}`);
      if (!fileResponse.ok) {
        return;
      }

      const fileData = await fileResponse.json();
      engine.setMode('code');
      openFile(componentPath, fileData.content);

      requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent('monaco-goto-position', {
            detail: {
              line: targetLocation.line,
              column: targetLocation.column,
              endLine: targetLocation.endLine,
              endColumn: targetLocation.endColumn,
              filePath: componentPath,
            },
          }),
        );
      });
    } catch (error) {
      console.error('[Go to Text Code] Error:', error);
      toast({
        variant: 'destructive',
        title: 'Navigation Error',
        description: 'Failed to navigate to code',
      });
    }
  }, [selectedIds, componentPath, engine, openFile]);

  const handleGoToTextCodeVSCode = useCallback(() => {
    if (!componentPath || !childrenLocation) return;
    goToCode(componentPath, childrenLocation.line, childrenLocation.column);
  }, [componentPath, childrenLocation, goToCode]);

  return {
    handleGoToTextCode,
    handleGoToTextCodeVSCode,
  };
}
