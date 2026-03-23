/**
 * @file EvalContext — shared session state for CLI
 *
 * Accessed via: All CLI commands — holds graph, executor, history, registry
 */

import {
  createDefaultRegistry,
  GraphExecutor,
  HistoryManager,
  type NodeRegistry,
  sceneToSvg,
  VectorGraphModel,
} from 'vector-engine';

export interface EvalContext {
  graph: VectorGraphModel;
  registry: NodeRegistry;
  executor: GraphExecutor;
  history: HistoryManager;
  currentFile?: string;
  previewPath?: string;
  canvasWidth: number;
  canvasHeight: number;
}

export function createContext(width = 100, height = 100): EvalContext {
  const registry = createDefaultRegistry();
  const graph = VectorGraphModel.create(crypto.randomUUID(), 'untitled', width, height);
  return {
    graph,
    registry,
    executor: new GraphExecutor(registry),
    history: new HistoryManager(),
    canvasWidth: width,
    canvasHeight: height,
  };
}

export function executeAndRender(ctx: EvalContext): string {
  const result = ctx.executor.execute(ctx.graph);
  return sceneToSvg(result.scene);
}
