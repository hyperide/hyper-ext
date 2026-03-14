/**
 * @file Graph execution engine — topological traversal with per-node caching
 *
 * Accessed via: Runs on every parameter change in Properties panel — re-evaluates affected subgraph
 * Assumptions: graph is acyclic (VectorGraphModel rejects cycles at addEdge). Node execute() is pure — cache invalidation relies on deterministic outputs for same inputs.
 * Tradeoffs: per-node cache keyed on type+params+input fingerprints — trades memory
 *   for avoiding redundant recomputation on unchanged subgraphs.
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Execution Engine
 */

import type { NodeRegistry } from '../nodes/registry';
import type {
  ExecutionResult,
  NodeExecutionStatus,
  NodeValue,
  PathValue,
  StyleValue,
  TerminalNodeOutput,
} from '../types';
import { IDENTITY_TRANSFORM } from '../types';
import { buildScene } from './scene-builder';
import type { VectorGraphModel } from './vector-graph';

interface CacheEntry {
  cacheKey: string;
  outputs: Record<string, NodeValue | NodeValue[]>;
}

const EMPTY_STYLE: StyleValue = {};

/** Ports auto-forwarded from upstream nodes without requiring explicit edges */
const IMPLICIT_PORTS = ['transform', 'clipPath'] as const;

/**
 * Compute a cache fingerprint for a node value.
 * Uses byte-level FNV-1a hashing for Float64Array (PathValue) to avoid
 * O(n) JSON.stringify on large path buffers.
 */
function fingerprint(value: unknown): string {
  if (value && typeof value === 'object' && 'commands' in value) {
    const pv = value as PathValue;
    // FNV-1a 32-bit hash of the raw buffer bytes
    let h = 0x811c9dc5;
    const view = new Uint8Array(pv.commands.buffer, pv.commands.byteOffset, pv.commands.byteLength);
    for (let i = 0; i < view.length; i++) {
      h ^= view[i];
      h = Math.imul(h, 0x01000193);
    }
    return `p:${h >>> 0}:${pv.closed}`;
  }
  return JSON.stringify(value);
}

export class GraphExecutor {
  private cache = new Map<string, CacheEntry>();
  private dirty = new Set<string>();

  constructor(private registry: NodeRegistry) {}

  execute(graph: VectorGraphModel): ExecutionResult {
    const start = performance.now();
    const order = graph.topologicalOrder();
    const nodeStatus: Record<string, NodeExecutionStatus> = {};
    // nodeId → outputs produced during this execution pass
    const nodeOutputs = new Map<string, Record<string, NodeValue | NodeValue[]>>();

    // Collect outgoing edges to identify terminal nodes
    const hasOutgoing = new Set<string>();
    for (const edge of graph.getEdges()) {
      hasOutgoing.add(edge.source);
    }

    const terminalOutputs: TerminalNodeOutput[] = [];

    for (const nodeId of order) {
      const node = graph.getNode(nodeId);
      if (!node) continue;

      const isMuted = graph.isMuted(nodeId);
      const inputEdges = graph.getInputEdges(nodeId);

      // Gather resolved inputs from upstream nodes
      const resolvedInputs: Record<string, NodeValue | NodeValue[]> = {};
      for (const edge of inputEdges) {
        const upstreamOutputs = nodeOutputs.get(edge.source);
        if (!upstreamOutputs) continue;
        const portValue = upstreamOutputs[edge.sourcePort];
        if (portValue === undefined) continue;
        const existing = resolvedInputs[edge.targetPort];
        if (existing === undefined) {
          resolvedInputs[edge.targetPort] = portValue;
        } else {
          // Multiple edges into one port → collect as array
          const arr = Array.isArray(existing) ? existing : [existing as NodeValue];
          resolvedInputs[edge.targetPort] = [
            ...arr,
            ...(Array.isArray(portValue) ? portValue : [portValue as NodeValue]),
          ];
        }
      }

      // Auto-forward implicit ports (transform, clipPath) from upstream nodes.
      // When an edge connects source → target on any port, also forward
      // matching-name outputs that the target accepts but has no explicit edge for.
      const typeDef = this.registry.get(node.type);
      if (typeDef) {
        const implicitInputNames = new Set(typeDef.inputs.map((p) => p.name));
        const explicitTargetPorts = new Set(inputEdges.map((e) => e.targetPort));
        const upstreamSources = new Set(inputEdges.map((e) => e.source));
        for (const srcId of upstreamSources) {
          const upstreamOutputs = nodeOutputs.get(srcId);
          if (!upstreamOutputs) continue;
          for (const portName of IMPLICIT_PORTS) {
            if (implicitInputNames.has(portName) && !explicitTargetPorts.has(portName)) {
              const val = upstreamOutputs[portName];
              if (val !== undefined && resolvedInputs[portName] === undefined) {
                resolvedInputs[portName] = val;
              }
            }
          }
        }
      }

      if (isMuted) {
        // Passthrough: forward first input port value to first output port
        const outputs: Record<string, NodeValue | NodeValue[]> = {};
        if (typeDef && typeDef.inputs.length > 0 && typeDef.outputs.length > 0) {
          const firstIn = typeDef.inputs[0].name;
          const firstOut = typeDef.outputs[0].name;
          const val = resolvedInputs[firstIn];
          if (val !== undefined) outputs[firstOut] = val;
        }
        nodeOutputs.set(nodeId, outputs);
        nodeStatus[nodeId] = { state: 'skipped' };
      } else {
        // Compute cache key using fingerprints to avoid expensive JSON.stringify on PathValues
        const inputKeys = Object.fromEntries(Object.entries(resolvedInputs).map(([k, v]) => [k, fingerprint(v)]));
        const cacheKey = JSON.stringify({ type: node.type, params: node.params, inputKeys });

        const existing = this.cache.get(nodeId);
        if (existing && existing.cacheKey === cacheKey && !this.dirty.has(nodeId)) {
          // Cache hit
          nodeOutputs.set(nodeId, existing.outputs);
          nodeStatus[nodeId] = { state: 'cached' };
        } else {
          // Execute
          if (!typeDef) {
            nodeStatus[nodeId] = { state: 'error', error: `Unknown node type: ${node.type}` };
            nodeOutputs.set(nodeId, {});
            continue;
          }

          const nodeStart = performance.now();
          try {
            const outputs = typeDef.execute(resolvedInputs, node.params);
            const execMs = performance.now() - nodeStart;
            this.cache.set(nodeId, { cacheKey, outputs });
            this.dirty.delete(nodeId);
            nodeOutputs.set(nodeId, outputs);
            nodeStatus[nodeId] = { state: 'ok', executionTimeMs: execMs };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            nodeStatus[nodeId] = { state: 'error', error: msg };
            nodeOutputs.set(nodeId, {});
          }
        }
      }

      // If this node is terminal (no outgoing edges), collect its path output for scene
      if (!hasOutgoing.has(nodeId)) {
        const outputs = nodeOutputs.get(nodeId) ?? {};
        const pathVal = outputs.path;
        if (pathVal && !Array.isArray(pathVal) && pathVal.type === 'path') {
          const styleVal = outputs.style;
          const style =
            styleVal && !Array.isArray(styleVal) && styleVal.type === 'style' ? styleVal.value : EMPTY_STYLE;
          const transformVal = outputs.transform;
          const transform =
            transformVal && !Array.isArray(transformVal) && transformVal.type === 'transform'
              ? transformVal.value
              : IDENTITY_TRANSFORM;
          const clipVal = outputs.clipPath;
          const clipPath = clipVal && !Array.isArray(clipVal) && clipVal.type === 'path' ? clipVal.value : undefined;
          terminalOutputs.push({
            id: nodeId,
            name: node.type,
            path: pathVal.value,
            style,
            transform,
            clipPath,
            visible: true,
          });
        }
      }
    }

    const scene = buildScene({ terminalNodes: terminalOutputs, canvas: graph.getCanvas() });

    return {
      scene,
      nodeStatus,
      executionTimeMs: performance.now() - start,
    };
  }

  /** Mark a node and all its downstream dependents as dirty (cache invalidated). */
  invalidate(nodeId: string): void {
    this.dirty.add(nodeId);
  }

  /** Clear the entire cache. */
  clearCache(): void {
    this.cache.clear();
    this.dirty.clear();
  }
}
