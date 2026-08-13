/**
 * Canvas Renderer - renders instances from Canvas Engine
 */

import { useEffect, useRef } from 'react';
import type { MapBoundary } from '../../../components/MapOverlay';
import type { ASTNode } from '../types/ast';
import { useCanvasEngine, useChildren } from './hooks';

interface InstanceRendererProps {
  instanceId: string;
}

interface MapGroup {
  parentMapId: string;
  depth: number;
  nodeIds: string[];
  expression: string;
  elementId: string; // First node ID for AST searching
}

/**
 * Extract map groups from AST structure
 */
function extractMapGroups(astNodes: ASTNode[]): MapGroup[] {
  const groups = new Map<string, MapGroup>();

  function traverse(node: ASTNode) {
    if (node.mapItem) {
      const { parentMapId, depth, expression } = node.mapItem;
      if (!groups.has(parentMapId)) {
        groups.set(parentMapId, {
          parentMapId,
          depth,
          nodeIds: [],
          expression: expression || '',
          elementId: node.id, // Use first encountered node as elementId
        });
      }
      groups.get(parentMapId)?.nodeIds.push(node.id);
    }

    if (node.children) {
      node.children.forEach(traverse);
    }
  }

  astNodes.forEach(traverse);
  return Array.from(groups.values());
}

/**
 * Calculate bounding box for a group of elements by AST node IDs.
 * Looks up elements by data-canvas-node-id attribute.
 */
function calculateGroupBoundingBox(containerEl: HTMLElement, nodeIds: string[]): DOMRect | null {
  const allElements: Element[] = [];

  for (const id of nodeIds) {
    const elements = containerEl.querySelectorAll(`[data-canvas-node-id="${id}"]`);
    allElements.push(...Array.from(elements));
  }

  if (allElements.length === 0) return null;

  const rects = allElements.map((el) => el.getBoundingClientRect());

  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));

  return new DOMRect(left, top, right - left, bottom - top);
}

/**
 * Recursively renders a single instance and its children
 */
function InstanceRenderer({ instanceId }: InstanceRendererProps) {
  const engine = useCanvasEngine();
  const instance = engine.getInstance(instanceId);
  const containerRef = useRef<HTMLDivElement>(null);
  const componentDef = instance ? engine.registry.get(instance.type) : undefined;

  // Highlight classes are managed by the overlay system (fiber-based tracing).

  if (!instance) {
    return null;
  }

  if (!componentDef) {
    console.warn(`[CanvasRenderer] Component definition not found: ${instance.type}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
    return null;
  }

  // Render component with SampleDefault or defaultProps
  if (componentDef.SampleDefault) {
    const SampleComponent = componentDef.SampleDefault;
    return (
      <div ref={containerRef} data-canvas-node-id={instanceId} className="canvas-component-wrapper">
        <SampleComponent />
      </div>
    );
  }

  if (componentDef.render) {
    return (
      <div ref={containerRef} data-canvas-node-id={instanceId} className="canvas-component-wrapper">
        {componentDef.render({
          id: instanceId,
          props: componentDef.defaultProps,
          children: undefined,
        })}
      </div>
    );
  }

  return null;
}

/**
 * Main Canvas Renderer component
 */
export function CanvasRenderer({
  onMapBoundariesChange,
}: {
  hoveredId?: string | null;
  selectedId?: string | null;
  onMapBoundariesChange?: (boundaries: MapBoundary[]) => void;
}) {
  const engine = useCanvasEngine();
  const rootChildren = useChildren(engine.getRoot().id);
  const canvasRef = useRef<HTMLDivElement>(null);

  // RAF loop to update map boundaries
  useEffect(() => {
    if (!onMapBoundariesChange) return;

    let rafId: number;

    const updateBoundaries = () => {
      if (!canvasRef.current) {
        rafId = requestAnimationFrame(updateBoundaries);
        return;
      }

      // Collect all map groups from all instances
      const allBoundaries: MapBoundary[] = [];

      // Find all instance containers
      const containers = canvasRef.current.querySelectorAll('.canvas-component-wrapper');

      containers.forEach((container) => {
        const instanceId = (container as HTMLElement).dataset.canvasNodeId;
        if (!instanceId) return;

        const instance = engine.getInstance(instanceId);
        const astData = instance?.metadata?.astStructure;
        if (!Array.isArray(astData)) return;

        // Extract map groups from AST
        const mapGroups = extractMapGroups(astData as ASTNode[]);

        // Calculate boundaries for each group
        mapGroups.forEach((group) => {
          const rect = calculateGroupBoundingBox(container as HTMLElement, group.nodeIds);
          if (rect) {
            allBoundaries.push({
              parentMapId: group.parentMapId,
              depth: group.depth,
              rect,
              expression: group.expression,
              elementId: group.elementId,
            });
          }
        });
      });

      onMapBoundariesChange(allBoundaries);
      rafId = requestAnimationFrame(updateBoundaries);
    };

    rafId = requestAnimationFrame(updateBoundaries);

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [onMapBoundariesChange, engine]);

  return (
    <div ref={canvasRef}>
      {rootChildren.map((child) => (
        <InstanceRenderer key={child.id} instanceId={child.id} />
      ))}
    </div>
  );
}
