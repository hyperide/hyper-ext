/**
 * @file Thin glue between a transport and the orchestrator: (ctx, store, req) → orchestrator.run.
 *
 * Accessed via: the Docker route (server/routes/retargetI18nKey.ts) and, in Phase 2, the NodePod
 *   service-worker intercept. There is deliberately NO registry here — the brainstorm's default
 *   was "dedicated + extraction-ready": one named entry point that both transports import, so the
 *   logic is trivially liftable into a standalone package later without a routing indirection now.
 */
import type { RetargetRequest, RetargetResponse } from './contract';
import type { FileStore } from './file-store';
import { type OrchestratorContext, run } from './orchestrator';

export function handleRetarget(
  ctx: OrchestratorContext,
  store: FileStore,
  req: RetargetRequest,
): Promise<RetargetResponse> {
  return run(ctx, store, req);
}
