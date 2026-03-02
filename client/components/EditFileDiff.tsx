import cn from 'clsx';
import { type Change, diffLines } from 'diff';
import { useMemo, useState } from 'react';

interface EditFileDiffProps {
  path: string;
  oldContent: string;
  newContent: string;
  contextLines?: number;
}

type SegmentType = 'context' | 'added' | 'removed' | 'collapsed';

interface Segment {
  type: SegmentType;
  lines: string[];
  collapsedCount?: number;
  originalIndex?: number;
}

function buildSegments(changes: Change[], contextLines: number, expandedSections: Set<number>): Segment[] {
  const segments: Segment[] = [];
  let collapsedIndex = 0;

  for (const change of changes) {
    const lines = change.value.split('\n');
    // Remove trailing empty line from split
    if (lines[lines.length - 1] === '') {
      lines.pop();
    }

    if (change.added) {
      segments.push({ type: 'added', lines });
    } else if (change.removed) {
      segments.push({ type: 'removed', lines });
    } else {
      // Context lines - may need collapsing
      if (lines.length <= contextLines * 2 + 1) {
        // Show all context if small enough
        segments.push({ type: 'context', lines });
      } else {
        const currentCollapsedIndex = collapsedIndex++;

        if (expandedSections.has(currentCollapsedIndex)) {
          // Show all lines if expanded
          segments.push({ type: 'context', lines });
        } else {
          // Show first N lines
          segments.push({
            type: 'context',
            lines: lines.slice(0, contextLines),
          });
          // Collapsed section
          const hiddenCount = lines.length - contextLines * 2;
          segments.push({
            type: 'collapsed',
            lines: [],
            collapsedCount: hiddenCount,
            originalIndex: currentCollapsedIndex,
          });
          // Show last N lines
          segments.push({
            type: 'context',
            lines: lines.slice(-contextLines),
          });
        }
      }
    }
  }

  return segments;
}

export function EditFileDiff({ path, oldContent, newContent, contextLines = 3 }: EditFileDiffProps) {
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());

  const segments = useMemo(() => {
    const changes = diffLines(oldContent, newContent);
    return buildSegments(changes, contextLines, expandedSections);
  }, [oldContent, newContent, contextLines, expandedSections]);

  const toggleExpand = (index: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <div className="font-mono text-xs">
      <div className="text-muted-foreground mb-1 flex items-center gap-1">
        <span>📄</span>
        <span>{path}</span>
      </div>
      <div className="bg-muted/30 rounded overflow-x-auto">
        {segments.map((segment, i) => (
          <DiffSegment
            // biome-ignore lint/suspicious/noArrayIndexKey: diff segments have no stable id
            key={i}
            segment={segment}
            onExpand={() => segment.originalIndex !== undefined && toggleExpand(segment.originalIndex)}
          />
        ))}
      </div>
    </div>
  );
}

interface DiffSegmentProps {
  segment: Segment;
  onExpand: () => void;
}

function DiffSegment({ segment, onExpand }: DiffSegmentProps) {
  if (segment.type === 'collapsed') {
    return (
      <button
        type="button"
        onClick={onExpand}
        className="w-full text-center py-0.5 bg-muted/50 text-muted-foreground hover:bg-muted cursor-pointer text-xs"
      >
        ··· {segment.collapsedCount} lines hidden ···
      </button>
    );
  }

  return (
    <>
      {segment.lines.map((line, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no stable id
          key={i}
          className={cn(
            'px-2 py-px',
            segment.type === 'added' && 'bg-green-500/20 text-green-700 dark:text-green-400',
            segment.type === 'removed' && 'bg-red-500/20 text-red-700 dark:text-red-400 line-through',
            segment.type === 'context' && 'text-foreground bg-transparent',
          )}
        >
          <span className="select-none opacity-50 mr-2">
            {segment.type === 'added' ? '+' : segment.type === 'removed' ? '-' : ' '}
          </span>
          {line || ' '}
        </div>
      ))}
    </>
  );
}
