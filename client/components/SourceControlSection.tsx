import {
  IconChevronDown,
  IconFile,
  IconFileCode,
  IconFileMinus,
  IconFilePlus,
  IconGitBranch,
  IconPlayerStop,
  IconRefresh,
} from '@tabler/icons-react';
import cn from 'clsx';
import { useCallback, useEffect, useRef } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { useCanvasEngine } from '@/lib/canvas-engine';
import { useEditorStore } from '@/stores/editorStore';
import { type GitFileStatus, useGitStore } from '@/stores/gitStore';
import { authFetch } from '@/utils/authFetch';

interface SourceControlSectionProps {
  /** Whether the section content is collapsed */
  collapsed?: boolean;
  /** Callback when collapse toggle is clicked */
  onToggleCollapse?: () => void;
  /** Whether to show the header (default: true) */
  showHeader?: boolean;
  /** Whether we're in code mode (skip mode switching on file click) */
  isCodeMode?: boolean;
  /** Custom class for the container */
  className?: string;
}

function getStatusIcon(status: GitFileStatus['status']) {
  switch (status) {
    case 'A':
    case '?':
      return <IconFilePlus className="w-3.5 h-3.5 text-green-500" stroke={1.5} />;
    case 'D':
      return <IconFileMinus className="w-3.5 h-3.5 text-red-500" stroke={1.5} />;
    case 'M':
      return <IconFileCode className="w-3.5 h-3.5 text-yellow-500" stroke={1.5} />;
    default:
      return <IconFile className="w-3.5 h-3.5 text-muted-foreground" stroke={1.5} />;
  }
}

function getStatusLabel(status: GitFileStatus['status']) {
  switch (status) {
    case 'A':
      return 'Added';
    case 'D':
      return 'Deleted';
    case 'M':
      return 'Modified';
    case 'R':
      return 'Renamed';
    case '?':
      return 'Untracked';
    case '!':
      return 'Ignored';
    default:
      return 'Unknown';
  }
}

export function SourceControlSection({
  collapsed = false,
  onToggleCollapse,
  showHeader = true,
  isCodeMode = false,
  className,
}: SourceControlSectionProps) {
  const engine = useCanvasEngine();
  const {
    changedFiles,
    isLoadingChanges,
    fetchChangedFiles,
    commitMessage,
    flowState,
    commitError,
    setCommitMessage,
    generateCommitMessage,
    stopGeneration,
  } = useGitStore();
  const { openFile } = useEditorStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasLoadedRef = useRef(false);

  // Fetch changed files on mount (only once)
  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      fetchChangedFiles();
    }
  }, [fetchChangedFiles]);

  // Auto-generate commit message when section first appears (same pattern as PushPopover)
  useEffect(() => {
    if (flowState === 'idle') {
      generateCommitMessage();
    }
    // Only run on mount - component unmounts when section closes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus textarea after generation completes
  useEffect(() => {
    if (flowState === 'editing' && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [flowState]);

  const handleFileClick = useCallback(
    async (file: GitFileStatus) => {
      try {
        // Switch to code mode if we're in design/interact mode
        if (!isCodeMode) {
          engine.setMode('code');
        }

        // Fetch file content
        const response = await authFetch(`/api/files/read?path=${encodeURIComponent(file.path)}`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.content !== undefined) {
            // Open file in diff mode
            openFile(file.path, data.content, true);
          }
        }
      } catch (error) {
        console.error('[SourceControlSection] Failed to open file:', error);
      }
    },
    [isCodeMode, engine, openFile],
  );

  const handleStage = useCallback(
    async (filePath: string) => {
      try {
        const response = await authFetch('/api/git/stage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: [filePath] }),
        });
        if (response.ok) {
          fetchChangedFiles();
        }
      } catch (error) {
        console.error('[SourceControlSection] Failed to stage file:', error);
      }
    },
    [fetchChangedFiles],
  );

  const handleUnstage = useCallback(
    async (filePath: string) => {
      try {
        const response = await authFetch('/api/git/unstage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: [filePath] }),
        });
        if (response.ok) {
          fetchChangedFiles();
        }
      } catch (error) {
        console.error('[SourceControlSection] Failed to unstage file:', error);
      }
    },
    [fetchChangedFiles],
  );

  const stagedFiles = changedFiles.filter((f) => f.staged);
  const unstagedFiles = changedFiles.filter((f) => !f.staged);
  const hasContent = changedFiles.length > 0 || isLoadingChanges;

  return (
    <div className={cn('flex flex-col', className)}>
      {showHeader && (
        <div className="h-6 px-2 flex items-center justify-between bg-muted border-t border-border w-full shrink-0">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="flex items-center gap-1 flex-1"
            disabled={!hasContent}
          >
            <IconChevronDown
              className={cn('w-3 h-3 transition-transform duration-200', {
                'rotate-[-90deg]': collapsed || !hasContent,
              })}
              stroke={1.5}
            />
            <IconGitBranch className="w-3.5 h-3.5 text-orange-500" stroke={1.5} />
            <span
              className={cn('text-xs font-semibold', {
                'text-foreground': hasContent,
                'text-muted-foreground': !hasContent,
              })}
            >
              {hasContent ? 'Source Control' : 'No changes'}
            </span>
            {changedFiles.length > 0 && (
              <span className="text-xs text-muted-foreground ml-1">({changedFiles.length})</span>
            )}
          </button>
        </div>
      )}

      <div
        className={cn(
          'flex-1 overflow-y-auto transition-all duration-200',
          (collapsed || !hasContent) && 'h-0 overflow-hidden flex-none',
        )}
      >
        <div className="flex flex-col px-2 gap-2 py-2">
          {/* Commit message input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Commit Message</span>
              {flowState === 'generating' ? (
                <button
                  type="button"
                  onClick={stopGeneration}
                  className="h-5 px-1.5 text-[10px] flex items-center gap-1 rounded hover:bg-accent"
                >
                  <IconPlayerStop className="w-3 h-3" />
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => generateCommitMessage()}
                  disabled={flowState === 'pushing'}
                  className="h-5 px-1.5 text-[10px] flex items-center gap-1 rounded hover:bg-accent disabled:opacity-50"
                >
                  <IconRefresh className="w-3 h-3" />
                  Regenerate
                </button>
              )}
            </div>

            <Textarea
              ref={textareaRef}
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder={flowState === 'generating' ? 'Generating...' : 'Enter commit message...'}
              className="min-h-[60px] text-xs resize-none"
              disabled={flowState === 'generating' || flowState === 'pushing'}
            />

            {commitError && <p className="text-[10px] text-red-500">{commitError}</p>}
          </div>

          {/* File list */}
          {isLoadingChanges ? (
            <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
              <div className="animate-spin rounded-full h-3 w-3 border-b border-muted-foreground" />
              Loading changes...
            </div>
          ) : changedFiles.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2 py-2">No changes</p>
          ) : (
            <>
              {/* Staged changes */}
              {stagedFiles.length > 0 && (
                <div className="flex flex-col">
                  <div className="flex items-center gap-1 px-1 py-1">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase">
                      Staged Changes ({stagedFiles.length})
                    </span>
                  </div>
                  {stagedFiles.map((file) => (
                    <div
                      key={file.path}
                      className="group h-6 px-2 flex items-center gap-2 rounded hover:bg-accent w-full"
                    >
                      <button
                        type="button"
                        onClick={() => handleFileClick(file)}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left"
                        title={`${file.path} - ${getStatusLabel(file.status)}`}
                      >
                        {getStatusIcon(file.status)}
                        <span className="text-xs text-foreground truncate">{file.path.split('/').pop()}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUnstage(file.path);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-[10px] px-1 rounded hover:bg-muted text-muted-foreground"
                        title="Unstage"
                      >
                        −
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Changes (unstaged) */}
              {unstagedFiles.length > 0 && (
                <div className="flex flex-col">
                  <div className="flex items-center gap-1 px-1 py-1">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase">
                      Changes ({unstagedFiles.length})
                    </span>
                  </div>
                  {unstagedFiles.map((file) => (
                    <div
                      key={file.path}
                      className="group h-6 px-2 flex items-center gap-2 rounded hover:bg-accent w-full"
                    >
                      <button
                        type="button"
                        onClick={() => handleFileClick(file)}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left"
                        title={`${file.path} - ${getStatusLabel(file.status)}`}
                      >
                        {getStatusIcon(file.status)}
                        <span className="text-xs text-foreground truncate">{file.path.split('/').pop()}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStage(file.path);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-[10px] px-1 rounded hover:bg-muted text-muted-foreground"
                        title="Stage"
                      >
                        +
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
