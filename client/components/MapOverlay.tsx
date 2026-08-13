/**
 * MapOverlay types — map() boundary descriptor consumed by the map-edit popup
 * and canvas renderer wiring.
 */

export interface MapBoundary {
  parentMapId: string;
  depth: number;
  rect: DOMRect;
  expression: string; // Array expression being mapped over (e.g., "screenshots")
  elementId: string; // ID of the element inside the map, used to locate it in the AST
}
