import type { DiagnosticHub } from '../DiagnosticHub';
import type { StateHub } from '../StateHub';
import type { AstService } from '../services/AstService';
import type { ComponentService } from '../services/ComponentService';

export interface HyperMcpServices {
  astService: AstService;
  componentService: ComponentService;
  stateHub: StateHub;
  diagnosticHub: DiagnosticHub;
  workspaceRoot: string;
  onNavigate: (filePath: string, elementId: string) => Promise<void>;
  onRefresh: () => void;
  onOpenComponent: (path: string) => void;
  onScreenshot: (elementId?: string) => Promise<string | null>;
}

/**
 * Resolve filePath: use provided value or fall back to the currently active component.
 * Returns null if neither is available.
 */
export function resolveFilePath(stateHub: StateHub, filePath?: string): string | null {
  if (filePath) return filePath;
  return stateHub.state.currentComponent?.path || null;
}
