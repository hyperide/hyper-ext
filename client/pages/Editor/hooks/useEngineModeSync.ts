import { useEffect } from 'react';
import type { CanvasEngine } from '@/lib/canvas-engine';
import { authFetch } from '@/utils/authFetch';

export function useEngineModeSync(engine: CanvasEngine, setMode: (mode: 'design' | 'interact' | 'code') => void) {
  useEffect(() => {
    const handleModeChange = ({ mode }: { mode: 'design' | 'interact' | 'code' }) => {
      setMode(mode);
      if (mode === 'interact') {
        authFetch('/api/clear-classname-cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }).catch((error) => {
          console.error('[CanvasEditor] Failed to clear className cache:', error);
        });
      }
    };

    engine.events.on('mode:change', handleModeChange);
    return () => {
      engine.events.off('mode:change', handleModeChange);
    };
  }, [engine, setMode]);
}
