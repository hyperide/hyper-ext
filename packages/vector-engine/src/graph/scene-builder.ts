/**
 * @file Scene graph builder — converts executor terminal output into SceneGraph
 *
 * Accessed via: Internal module — converts executor output into the render tree drawn on canvas
 *
 * Tradeoffs: flat scene for v0 — no group nesting yet.
 * Groups will be added when the node system supports group nodes.
 */

import type { SceneGraph, SceneItem, TerminalNodeOutput } from '../types';

export interface BuildSceneInput {
  terminalNodes: TerminalNodeOutput[];
  canvas: { width: number; height: number };
  background?: string;
}

export function buildScene(input: BuildSceneInput): SceneGraph {
  const items: SceneItem[] = input.terminalNodes.map((terminal) => ({
    id: terminal.id,
    name: terminal.name,
    path: terminal.path,
    style: terminal.style,
    transform: terminal.transform,
    clipPath: terminal.clipPath,
    visible: terminal.visible,
  }));

  return {
    items,
    canvas: input.canvas,
    background: input.background,
  };
}
