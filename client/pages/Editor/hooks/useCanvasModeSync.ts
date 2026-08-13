import { useEffect, useRef } from 'react';

export function useCanvasModeSync(
  canvasMode: 'single' | 'multi',
  setBoardModeActive: (active: boolean) => void,
  setActiveDesignInstanceId: (id: string | null) => void,
) {
  const canvasModeInitRef = useRef(true);
  useEffect(() => {
    if (canvasModeInitRef.current) {
      canvasModeInitRef.current = false;
      return;
    }
    if (canvasMode === 'multi') {
      setBoardModeActive(true);
      setActiveDesignInstanceId(null);
    } else {
      setBoardModeActive(false);
    }
  }, [canvasMode, setBoardModeActive, setActiveDesignInstanceId]);
}
