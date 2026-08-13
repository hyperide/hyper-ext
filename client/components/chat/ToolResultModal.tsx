interface ToolResultModalProps {
  isOpen: boolean;
  toolName: string;
  content: string;
  onClose: () => void;
}

/**
 * Modal overlay to display full tool output.
 * Works in both SaaS and VS Code extension webviews.
 */
export function ToolResultModal({ isOpen, toolName, content, onClose }: ToolResultModalProps) {
  if (!isOpen) return null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop dismiss
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop propagation only */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: modal content wrapper */}
      <div
        className="bg-background border border-border rounded-lg w-[90%] max-h-[80%] overflow-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-medium mb-2">{toolName} — Output</div>
        <pre className="text-xs whitespace-pre-wrap font-mono bg-muted p-3 rounded">{content}</pre>
      </div>
    </div>
  );
}
