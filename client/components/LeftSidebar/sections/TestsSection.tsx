import { IconChevronDown, IconPlayerPlayFilled, IconPlus, IconTestPipe } from '@tabler/icons-react';
import cn from 'clsx';
import { useState } from 'react';
import type { TestGroup } from '../../../../lib/component-scanner/types';

interface TestsSectionProps {
  collapsed: boolean;
  hasContent: boolean;
  testGroups: TestGroup[];
  isLoading: boolean;
  currentComponentPath: string | undefined;
  onToggle: () => void;
  onGenerateTests: () => void;
  onRunTests: () => void;
}

function getTestTypeLabel(type: string) {
  switch (type) {
    case 'unit':
      return 'Unit Tests';
    case 'e2e':
      return 'E2E Tests';
    case 'variants':
      return 'Test Variants';
    default:
      return type;
  }
}

export function TestsSection({
  collapsed,
  hasContent,
  testGroups,
  isLoading,
  currentComponentPath,
  onToggle,
  onGenerateTests,
  onRunTests,
}: TestsSectionProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['unit', 'e2e', 'variants']));

  const toggleGroup = (type: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  return (
    <div className="h-full overflow-hidden flex flex-col">
      <div className="h-6 px-2 flex items-center justify-between bg-muted border-t border-border w-full shrink-0">
        <button type="button" onClick={onToggle} className="flex items-center gap-1 flex-1" disabled={!hasContent}>
          <IconChevronDown
            className={cn('w-3 h-3 transition-transform duration-200', {
              'rotate-[-90deg]': collapsed || !hasContent,
            })}
            stroke={1.5}
          />
          <IconTestPipe className="w-3.5 h-3.5" stroke={1.5} />
          <span
            className={cn('text-xs font-semibold', {
              'text-foreground': hasContent,
              'text-muted-foreground': !hasContent,
            })}
          >
            {hasContent ? 'Tests' : 'No tests'}
          </span>
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!currentComponentPath) return;
              onGenerateTests();
            }}
            disabled={!currentComponentPath}
            className={cn('w-6 h-6 flex items-center justify-center rounded hover:bg-accent', {
              'opacity-50': !currentComponentPath,
            })}
            title="Generate tests for current component"
          >
            <IconPlus className="w-4 h-4" stroke={1.5} />
          </button>
          {hasContent && (
            <button
              type="button"
              title="Run tests"
              className={cn('w-6 h-6 flex items-center justify-center rounded hover:bg-accent', {
                'opacity-50': testGroups.length === 0,
              })}
              disabled={testGroups.length === 0}
              onClick={(e) => {
                e.stopPropagation();
                if (testGroups.length === 0) return;
                onRunTests();
              }}
            >
              <IconPlayerPlayFilled className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {!collapsed && (
        <div className="flex-1 overflow-y-auto flex flex-col">
          <div className="flex flex-col px-2 py-1">
            {!currentComponentPath ? (
              <p className="text-xs text-muted-foreground px-2 py-2">Load a component to see tests</p>
            ) : isLoading ? (
              <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                <div className="animate-spin rounded-full h-3 w-3 border-b border-muted-foreground" />
                Loading tests...
              </div>
            ) : testGroups.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-2">No tests found. Click + to generate.</p>
            ) : (
              <div className="flex flex-col">
                {testGroups.map((group) => (
                  <div key={group.type} className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.type)}
                      className="h-6 px-2 flex items-center gap-1 hover:bg-accent rounded"
                    >
                      <IconChevronDown
                        className={cn('w-2.5 h-2.5 transition-transform', {
                          'rotate-[-90deg]': !expandedGroups.has(group.type),
                        })}
                        stroke={1.5}
                      />
                      <span className="text-xs font-medium text-foreground">{getTestTypeLabel(group.type)}</span>
                      <span className="text-xs text-muted-foreground">({group.tests.length})</span>
                    </button>
                    {expandedGroups.has(group.type) && (
                      <div className="flex flex-col pl-4">
                        <div className="text-[10px] text-muted-foreground px-2 py-0.5 truncate">
                          {group.relativePath}
                        </div>
                        {group.tests.map((test) => (
                          <div
                            key={`${group.type}-${test.name}-${test.line}`}
                            className="h-5 px-2 flex items-center text-xs text-foreground truncate"
                            title={`${test.name} (line ${test.line})`}
                          >
                            <span className="truncate">{test.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
