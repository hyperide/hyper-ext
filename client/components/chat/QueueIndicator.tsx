import type { QueuedMessage } from '../../../shared/ai-agent';

interface QueueIndicatorProps {
  queue: QueuedMessage[];
  onCancel: (id: string) => void;
}

export function QueueIndicator({ queue, onCancel }: QueueIndicatorProps) {
  if (queue.length === 0) return null;

  return (
    <div className="mb-2 p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded text-xs">
      <div className="font-semibold text-amber-800 dark:text-amber-400 mb-1">Queued ({queue.length}):</div>
      {queue.map((msg, idx) => (
        <div key={msg.id} className="flex items-center gap-2 py-1">
          <span className="text-muted-foreground">[{idx + 1}]</span>
          <span className="flex-1 truncate text-foreground">{msg.content}</span>
          <button
            type="button"
            onClick={() => onCancel(msg.id)}
            className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 px-1"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
