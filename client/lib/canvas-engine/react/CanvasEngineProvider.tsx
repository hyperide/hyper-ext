/**
 * React Provider for Canvas Engine
 */

import { createContext, type ReactNode, useContext, useMemo } from 'react';
import type { CanvasEngine } from '../core/CanvasEngine';
import type { CanvasStoreApi } from '../store/createCanvasStore';
import { createCanvasStore } from '../store/createCanvasStore';

/**
 * Canvas Engine Context
 */
interface CanvasEngineContext {
  engine: CanvasEngine;
  store: CanvasStoreApi;
}

const CanvasEngineContext = createContext<CanvasEngineContext | null>(null);

/**
 * Canvas Engine Provider Props
 */
export interface CanvasEngineProviderProps {
  engine: CanvasEngine;
  children: ReactNode;
}

/**
 * Canvas Engine Provider
 */
export function CanvasEngineProvider({ engine, children }: CanvasEngineProviderProps) {
  const store = useMemo(() => createCanvasStore(engine), [engine]);

  const value = useMemo(
    () => ({
      engine,
      store,
    }),
    [engine, store],
  );

  return <CanvasEngineContext.Provider value={value}>{children}</CanvasEngineContext.Provider>;
}

/**
 * Use Canvas Engine Context
 */
export function useCanvasEngineContext(): CanvasEngineContext {
  const context = useContext(CanvasEngineContext);

  if (!context) {
    throw new Error('useCanvasEngineContext must be used within CanvasEngineProvider');
  }

  return context;
}

/**
 * Safe variant — returns null outside CanvasEngineProvider.
 * Used in components shared between SaaS (has engine) and VS Code (no engine).
 */
export function useCanvasEngineOptional(): CanvasEngine | null {
  const context = useContext(CanvasEngineContext);
  return context?.engine ?? null;
}

/**
 * Safe variant of useCanvasEngineContext — returns null outside CanvasEngineProvider.
 */
export function useCanvasEngineContextOptional(): CanvasEngineContext | null {
  return useContext(CanvasEngineContext);
}
