import { IconEye, IconLoader2 } from '@tabler/icons-react';
import cn from 'clsx';
import { useState } from 'react';
import type { DisplayToolCall } from '../../../shared/ai-chat-display';
import { EditFileDiff } from '../EditFileDiff';

function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function getToolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'read_file':
    case 'edit_file':
    case 'write_file':
    case 'delete_file':
      return str(input.path);
    case 'move_file':
      return `${str(input.sourcePath) || str(input.source)} → ${str(input.destPath) || str(input.destination)}`;
    case 'grep_search':
      return input.path ? `"${str(input.pattern)}" in ${str(input.path)}` : `"${str(input.pattern)}"`;
    case 'glob_search':
      return input.path ? `${str(input.pattern)} in ${str(input.path)}` : str(input.pattern);
    case 'bash_exec':
      return truncate(str(input.command), 80);
    case 'git_command': {
      const args = Array.isArray(input.args) ? input.args.join(' ') : str(input.args);
      return [str(input.command), args].filter(Boolean).join(' ');
    }
    case 'list_directory':
    case 'tree':
      return str(input.path);
    case 'browser_navigate':
      return str(input.url);
    case 'browser_click':
      return str(input.selector) || str(input.ref);
    case 'browser_type':
      return truncate(str(input.text), 60);
    case 'run_tests':
      return Array.isArray(input.testPaths) ? input.testPaths.join(', ') : str(input.testPaths);
    case 'brave_web_search':
      return str(input.query);
    case 'url_fetch':
      return str(input.url);
    case 'ask_user':
      return '';
    default: {
      if (name.startsWith('canvas_')) {
        return str(input.componentId) || str(input.name);
      }
      // Unknown tool: show first string value
      const first = Object.values(input).find((v) => typeof v === 'string');
      return typeof first === 'string' ? truncate(first, 80) : '';
    }
  }
}

interface ToolCallCardProps {
  toolCall: DisplayToolCall;
  onViewResult?: () => void;
}

export function ToolCallCard({ toolCall, onViewResult }: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const toolSummary = getToolSummary(toolCall.name, toolCall.input);

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
      {/* Compact argument summary — always visible */}
      {toolSummary && (
        <span className="block text-[10px] font-mono text-muted-foreground truncate mt-0.5">{toolSummary}</span>
      )}

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
