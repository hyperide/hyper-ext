/**
 * ComponentGroupList — shared UI component for rendering ComponentGroup[].
 *
 * Renders groups with dirPath headers (tilde icon) and component buttons
 * with active/loading states. Used in both SaaS LeftSidebar and VS Code Explorer.
 */

import { IconTilde } from '@tabler/icons-react';
import cn from 'clsx';
import type { ComponentGroup, ComponentListItem } from '../../lib/component-scanner/types';

interface ComponentGroupListProps {
  groups: ComponentGroup[];
  activeComponentPath: string | null;
  loadingComponentPath?: string | null;
  onComponentClick: (component: ComponentListItem) => void;
}

export function ComponentGroupList({
  groups,
  activeComponentPath,
  loadingComponentPath,
  onComponentClick,
}: ComponentGroupListProps) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.dirPath} className="flex flex-col">
          <div className="flex items-center gap-1 pl-3">
            <IconTilde
              className="w-3.5 h-3.5 text-muted-foreground"
              stroke={1.5}
            />
            <span className="text-xs font-normal text-[#7A7A7A]">
              {group.dirPath}
            </span>
          </div>
          <div className="pl-6 flex flex-col">
            {group.components.map((component) => {
              const isActive = activeComponentPath === component.path;
              const isLoading = loadingComponentPath === component.path;
              return (
                <button
                  key={component.path}
                  type="button"
                  className={cn(
                    'h-6 px-2 flex items-center gap-2 rounded justify-start',
                    {
                      'bg-blue-500/20 border border-blue-500/50': isActive,
                      'hover:bg-muted': !isActive,
                      'opacity-70': isLoading,
                    },
                  )}
                  onClick={() => onComponentClick(component)}
                  disabled={isLoading}
                >
                  {isLoading && (
                    <div className="animate-spin rounded-full h-3 w-3 border-b border-muted-foreground" />
                  )}
                  <span
                    className={cn('text-xs', {
                      'font-semibold text-foreground': isActive,
                      'text-foreground': !isActive,
                    })}
                  >
                    {component.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
