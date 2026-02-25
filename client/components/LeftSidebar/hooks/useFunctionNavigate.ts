/**
 * Compat hook for navigating to function definitions.
 * SaaS: engine.setMode('code') + CustomEvent('monaco-goto-position').
 * VS Code: goToCode(path, line, column).
 */

import { useCallback } from 'react';
import { useCanvasEngineOptional } from '@/lib/canvas-engine';
import { useGoToCode } from '@/lib/platform';

export function useFunctionNavigate(filePath: string | undefined): (loc: { line: number; column: number }) => void {
  const engine = useCanvasEngineOptional();
  const goToCode = useGoToCode();

  return useCallback(
    (loc: { line: number; column: number }) => {
      if (!filePath) return;

      if (engine) {
        // SaaS: switch to code mode, dispatch monaco event
        engine.setMode('code');
        requestAnimationFrame(() => {
          window.dispatchEvent(
            new CustomEvent('monaco-goto-position', {
              detail: {
                line: loc.line,
                column: loc.column,
                filePath,
              },
            }),
          );
        });
      } else {
        // VS Code: use platform goToCode
        goToCode(filePath, loc.line, loc.column);
      }
    },
    [engine, goToCode, filePath],
  );
}
