import { IconEye, IconLoader2 } from '@tabler/icons-react';
import cn from 'clsx';
import { useState } from 'react';
import type { DisplayToolCall } from '../../../shared/ai-chat-display';
import { EditFileDiff } from '../EditFileDiff';

interface ToolCallCardProps {
  toolCall: DisplayToolCall;
  onViewResult?: () => void;
}

export function ToolCallCard({ toolCall, onViewResult }: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isEditFile = toolCall.name === 'edit_file';
  const editInput = isEditFile
    ? (toolCall.input as {
        path?: string;
        old_content?: string;
        new_content?: string;
        oldContent?: string;
        newContent?: string;
      })
    : null;
  const oldContent = editInput?.old_content ?? editInput?.oldContent ?? '';
  const newContent = editInput?.new_content ?? editInput?.newContent ?? '';

  // Truncate output to 5 lines for preview
  const outputPreview = toolCall.result?.output
    ? (() => {
        const lines = toolCall.result.output.split('\n');
        const truncated = lines.slice(0, 5).join('\n');
        return { truncated, hasMore: lines.length > 5, totalLines: lines.length };
      })()
    : null;

  return (
    <div className="border border-amber-500/20 bg-amber-500/5 rounded p-2 my-1 text-xs">
      {/* Tool name header — clickable to expand input */}
      <button
        type="button"
        className="font-medium text-amber-700 dark:text-amber-400 cursor-pointer text-left w-full"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {toolCall.name}
        {toolCall.result && (
          <span
            className={cn(
              'ml-2',
              toolCall.result.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
            )}
          >
            {toolCall.result.success ? 'Done' : 'Failed'}
          </span>
        )}
        {!toolCall.result && <IconLoader2 size={12} className="inline-block ml-1 animate-spin text-amber-500" />}
      </button>

      {/* Expanded: show input (or diff for edit_file) */}
      {isExpanded && (
        <div className="mt-1">
          {isEditFile && oldContent && newContent ? (
            <EditFileDiff path={String(editInput?.path ?? '')} oldContent={oldContent} newContent={newContent} />
          ) : (
            <pre className="text-[10px] whitespace-pre-wrap font-mono bg-muted p-1.5 rounded overflow-auto max-h-32">
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Output preview + view full button */}
      {outputPreview && (
        <div className="mt-1">
          <pre className="text-[10px] whitespace-pre-wrap font-mono text-foreground/70 overflow-hidden max-h-20">
            {outputPreview.truncated}
            {outputPreview.hasMore && '...'}
          </pre>
          {onViewResult && (
            <button
              type="button"
              className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 mt-1"
              onClick={onViewResult}
            >
              <IconEye size={10} />
              {outputPreview.hasMore ? `View full output (${outputPreview.totalLines} lines)` : 'View output'}
            </button>
          )}
        </div>
      )}

      {/* Error display */}
      {toolCall.result?.error && <div className="text-red-500 text-[10px] mt-1">{toolCall.result.error}</div>}
    </div>
  );
}
