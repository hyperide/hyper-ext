/**
 * @file Platform transport for the guided "New component" flow (HYP-1184).
 *
 * Accessed via: CreateComponentDialog. Mirrors the branching of
 *   useComponentsData: SaaS (canvas engine present) → authFetch POST
 *   /api/create-component; VS Code webview → canvasRPC 'component:create'
 *   handled by the extension host's PanelRouter. Both hosts run the SAME
 *   @shared/component-create logic, so behavior stays at parity.
 * Assumptions: authFetch is stubbed (throwing) in the VS Code webview bundle —
 *   the SaaS branch is never taken there because `engine` is null.
 */

import { useCallback } from 'react';
import { type CanvasEngine, useCanvasEngineOptional } from '@/lib/canvas-engine';
import { usePlatformCanvas } from '@/lib/platform';
import type { CanvasAdapter } from '@/lib/platform/types';
import type { CreateComponentRequest, CreatedComponent } from '../../../shared/component-create/types';
import { authFetch } from '@/utils/authFetch';
import { canvasRPC } from './PlatformContext';

/**
 * Hook form of the create transport — closes over the engine/canvas so
 * callers (the LeftSidebar dialog wiring) never touch the platform split.
 */
export function useCreateComponent(): (request: CreateComponentRequest) => Promise<CreatedComponent> {
  const engine = useCanvasEngineOptional();
  const canvas = usePlatformCanvas();
  return useCallback(
    (request: CreateComponentRequest) => createComponentRemote(engine, canvas, request),
    [engine, canvas],
  );
}

/**
 * Create a component file in the open project. Throws with a plain-language
 * message (from the shared validators / host) on failure.
 */
async function createComponentRemote(
  engine: CanvasEngine | null,
  canvas: CanvasAdapter,
  request: CreateComponentRequest,
): Promise<CreatedComponent> {
  if (engine) {
    return createViaSaaS(request);
  }
  return createViaExtensionHost(canvas, request);
}

async function createViaSaaS(request: CreateComponentRequest): Promise<CreatedComponent> {
  const response = await authFetch('/api/create-component', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = (await response.json()) as {
    success: boolean;
    component?: CreatedComponent;
    error?: string;
  };
  if (!response.ok || !body.success || !body.component) {
    throw new Error(body.error || 'Could not create the component — please try again.');
  }
  return body.component;
}

async function createViaExtensionHost(
  canvas: CanvasAdapter,
  request: CreateComponentRequest,
): Promise<CreatedComponent> {
  const result = await canvasRPC<CreatedComponent>(
    canvas,
    { type: 'component:create', requestId: crypto.randomUUID(), ...request },
    'component:response',
  );
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Could not create the component — please try again.');
  }
  return result.data;
}
