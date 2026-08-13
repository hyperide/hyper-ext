/**
 * CondOverlay types — conditional boundary descriptor consumed by the
 * conditional-edit popup and canvas editor wiring.
 */

export interface CondBoundary {
  condId: string;
  type: 'if-then' | 'if-else' | 'else-if' | 'switch-case';
  branch: 'then' | 'else' | 'case';
  index?: number;
  expression: string;
  elementId: string; // ID of the element inside the condition, used to locate it in the AST
  rect: DOMRect;
}
