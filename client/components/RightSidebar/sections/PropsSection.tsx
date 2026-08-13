/**
 * PropsSection — inspector section that edits the typed props of the selected
 * source element (HYP-437, FIX-RECONNECT of the dropped <PropsEditor /> callsite).
 *
 * Accessed via: RightSidebar inspector body, mounted for a single selected element.
 *
 * Assumptions:
 *   - Edits route through `engine.updateASTProp` (source-AST write path), NOT the
 *     canvas.json instance REST path used by InstanceEditPopup. The inspector
 *     operates on source JSX elements (`selectedIds[0]`), a different surface than
 *     a placed canvas instance.
 *   - The component self-gates: it renders nothing unless a file path + a typed
 *     props schema are available for the selection.
 */

import { PropsEditor } from '@/components/PropsEditor';

export function PropsSection() {
  return <PropsEditor />;
}
