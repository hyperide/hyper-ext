/**
 * Canvas Renderer - renders instances from Canvas Engine
 */

import { useEffect, useRef } from 'react';
import type { MapBoundary } from '../../../components/MapOverlay';
import type { ASTNode } from '../types/ast';
import { useCanvasEngine, useChildren } from './hooks';

interface InstanceRendererProps {
  instanceId: string;
  hoveredId?: string | null;
  selectedId?: string | null;
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
 * Calculate bounding box for a group of elements
 * For map() items, finds ALL elements with the same data-uniq-id
 */
function calculateGroupBoundingBox(containerEl: HTMLElement, nodeIds: string[]): DOMRect | null {
  const allElements: Element[] = [];

  // For each node ID, find ALL elements with that ID (map items have same ID)
  nodeIds.forEach((id) => {
    const elements = containerEl.querySelectorAll(`[data-uniq-id="${id}"]`);
    allElements.push(...Array.from(elements));
  });

  if (allElements.length === 0) return null;

  // Get bounding boxes of all elements
  const rects = allElements.map((el) => el.getBoundingClientRect());

  // Calculate combined bounding box
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));

  return new DOMRect(left, top, right - left, bottom - top);
}

/**
 * Recursively adds data-uniq-id to DOM elements based on AST structure
 */
function addDataUniqIds(containerEl: HTMLElement, astNodes: ASTNode[]) {
  // For each AST node, try to find corresponding DOM element and add data-uniq-id
  const allElements = Array.from(containerEl.querySelectorAll('*'));

  function processNode(node: ASTNode, domElements: Element[]) {
    // Try to find matching DOM element by tag name and attributes
    for (const el of domElements) {
      if (el.tagName.toLowerCase() === node.type) {
        // Check if attributes match
        let matches = true;
        if (node.props) {
          for (const [key, value] of Object.entries(node.props)) {
            if (key === 'children' || key === 'className') continue;
            const attrName = key === 'className' ? 'class' : key;
            if (el.getAttribute(attrName) !== value) {
              matches = false;
              break;
            }
          }
        }

        if (matches && !(el as HTMLElement).dataset.uniqId) {
          (el as HTMLElement).dataset.uniqId = node.id;

          // Process children
          if (node.children && node.children.length > 0) {
            const childElements = Array.from(el.children);
            node.children.forEach((childNode) => {
              processNode(childNode, childElements);
            });
          }

          break;
        }
      }
    }
  }

  for (const node of astNodes) {
    processNode(node, allElements);
  }
}

/**
 * Recursively renders a single instance and its children
 */
function InstanceRenderer({ instanceId, hoveredId, selectedId }: InstanceRendererProps) {
  const engine = useCanvasEngine();
  const instance = engine.getInstance(instanceId);
  const containerRef = useRef<HTMLDivElement>(null);
  const componentDef = instance ? engine.registry.get(instance.type) : undefined;

  // Add data-uniq-id attributes after render
  useEffect(() => {
    if (!instance || !componentDef) return;
    const astStructure = instance.metadata?.astStructure;
    if (containerRef.current && Array.isArray(astStructure)) {
      addDataUniqIds(containerRef.current, astStructure as ASTNode[]);
    }
  }, [instance, instance?.metadata?.astStructure, componentDef]);

  // Update highlight classes when hover/select changes
  useEffect(() => {
    if (!instance || !componentDef || !containerRef.current) return;

    // Remove all highlight classes first
    const allElements = containerRef.current.querySelectorAll('[data-uniq-id]');
    allElements.forEach((el) => {
      el.classList.remove('canvas-hover-highlight', 'canvas-select-highlight');
    });

    // Add highlight class to hovered element
    if (hoveredId) {
      const hoveredEl = containerRef.current.querySelector(`[data-uniq-id="${hoveredId}"]`);
      if (hoveredEl) {
        hoveredEl.classList.add('canvas-hover-highlight');
      }
    }

    // Add highlight class to selected element
    if (selectedId) {
      const selectedEl = containerRef.current.querySelector(`[data-uniq-id="${selectedId}"]`);
      if (selectedEl) {
        selectedEl.classList.add('canvas-select-highlight');
      }
    }
  }, [instance, hoveredId, selectedId, componentDef]);

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
      <div ref={containerRef} data-uniq-id={instanceId} className="canvas-component-wrapper">
        <SampleComponent />
      </div>
    );
  }

  if (componentDef.render) {
    return (
      <div ref={containerRef} data-uniq-id={instanceId} className="canvas-component-wrapper">
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
  hoveredId,
  selectedId,
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
        const instanceId = (container as HTMLElement).dataset.uniqId;
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
        <InstanceRenderer key={child.id} instanceId={child.id} hoveredId={hoveredId} selectedId={selectedId} />
      ))}
    </div>
  );
}
