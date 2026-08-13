import { useEffect, useRef } from 'react';

export function useComponentChangeReset(
  currentPath: string | undefined,
  setActiveDesignInstanceId: (id: string | null) => void,
  setActiveBoardInstance: (id: string | null) => void,
) {
  const prevComponentPathRef = useRef(currentPath);
  useEffect(() => {
    if (prevComponentPathRef.current !== currentPath && currentPath !== undefined) {
      setActiveDesignInstanceId(null);
      setActiveBoardInstance(null);
    }
    prevComponentPathRef.current = currentPath;
  }, [currentPath, setActiveDesignInstanceId, setActiveBoardInstance]);
}
