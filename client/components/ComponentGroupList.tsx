/**
 * ComponentGroupList — shared UI component for rendering ComponentGroup[].
 *
 * Renders groups with dirPath headers (tilde icon) and component buttons
 * with active/loading states. Used in both SaaS LeftSidebar and VS Code Explorer.
 */

import { TID } from '@shared/data-testid-map';
import { IconCode, IconEye, IconFileCode, IconTilde } from '@tabler/icons-react';
import cn from 'clsx';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { usePlatformContext } from '@/lib/platform';
import type { ComponentGroup, ComponentListItem } from '../../lib/component-scanner/types';

interface ComponentGroupListProps {
  groups: ComponentGroup[];
  activeComponentPath: string | null;
  loadingComponentPath?: string | null;
  onComponentClick: (component: ComponentListItem) => void;
  onGoToVisual?: (component: ComponentListItem) => void;
  onOpenInEditor?: (component: ComponentListItem) => void;
  searchQuery?: string;
}

function HighlightedName({ name, query }: { name: string; query?: string }) {
  if (!query) return <>{name}</>;
  const idx = name.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{name}</>;
  return (
    <>
      {name.slice(0, idx)}
      <mark className="bg-yellow-300/50 text-inherit rounded-sm">{name.slice(idx, idx + query.length)}</mark>
      {name.slice(idx + query.length)}
    </>
  );
}

export function ComponentGroupList({
  groups,
  activeComponentPath,
  loadingComponentPath,
  onComponentClick,
  onGoToVisual,
  onOpenInEditor,
  searchQuery,
}: ComponentGroupListProps) {
  const isVSCode = usePlatformContext() === 'vscode-webview';

  return (
    <>
      {groups.map((group) => (
        <div key={group.dirPath} data-testid={TID.explorer.componentGroup(group.dirPath)} className="flex flex-col">
          <div className="flex items-center gap-1 pl-3">
            <IconTilde className="w-3.5 h-3.5 text-muted-foreground" stroke={1.5} />
            <span className="text-xs font-normal text-[#7A7A7A]">{group.dirPath}</span>
          </div>
          <div className="pl-6 flex flex-col">
            {group.components.map((component) => {
              const isActive = activeComponentPath === component.path;
              const isLoading = loadingComponentPath === component.path;
              return (
                <ContextMenu key={component.path}>
                  <ContextMenuTrigger asChild>
                    <button
                      type="button"
                      data-testid={TID.explorer.componentItem(component.name)}
                      className={cn(
                        'h-6 px-2 flex items-center gap-2 justify-start',
                        isVSCode ? 'rounded-none' : 'rounded',
                        {
                          'tree-item-selected': isActive && isVSCode,
                          'bg-blue-500/20 border border-blue-500/50 rounded': isActive && !isVSCode,
                          'hover:bg-muted': !isActive,
                          'opacity-70': isLoading,
                        },
                      )}
                      onClick={() => onComponentClick(component)}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <div className="animate-spin rounded-full h-3 w-3 border-b border-muted-foreground" />
                      ) : (
                        <IconCode className="w-3.5 h-3.5 shrink-0 text-muted-foreground" stroke={1.5} />
                      )}
                      <span
                        className={cn('text-xs', {
                          'font-semibold': isActive,
                          'text-foreground': !isActive,
                        })}
                      >
                        <HighlightedName name={component.name} query={searchQuery} />
                      </span>
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent data-testid="hyper-explorer-context-menu">
                    <ContextMenuItem
                      data-testid="hyper-explorer-ctx-go-to-visual"
                      onSelect={() => {
                        onGoToVisual?.(component) ?? onComponentClick(component);
                      }}
                    >
                      <IconEye className="w-3.5 h-3.5 mr-2" stroke={1.5} />
                      <span className="text-xs">Go to Visual</span>
                    </ContextMenuItem>
                    <ContextMenuItem
                      data-testid="hyper-explorer-ctx-open-in-editor"
                      onSelect={() => {
                        onOpenInEditor?.(component) ?? onComponentClick(component);
                      }}
                    >
                      <IconFileCode className="w-3.5 h-3.5 mr-2" stroke={1.5} />
                      <span className="text-xs">Open in Editor</span>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
