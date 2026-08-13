import { TID } from '@shared/data-testid-map';
import { IconChevronDown, IconComponents, IconPlus, IconRefresh, IconSearch } from '@tabler/icons-react';
import cn from 'clsx';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { ComponentGroup, ComponentListItem, SubProject } from '../../../../lib/component-scanner/types';
import { ComponentGroupList } from '../../ComponentGroupList';
import { SubProjectAccordion } from './SubProjectAccordion';

type SetupReason = 'no-ai-config' | 'no-paths' | 'empty-scan';

interface ComponentsSectionProps {
  collapsed: boolean;
  hasContent: boolean;
  atomGroups: ComponentGroup[];
  compositeGroups: ComponentGroup[];
  activePath: string | null;
  loadingComponent: string | null;
  onComponentClick: (component: ComponentListItem) => void;
  onToggle: () => void;
  onReload: () => void;
  isReloading: boolean;
  onCreateComponent?: () => void;
  setupReason?: SetupReason | null;
  isMonorepo?: boolean;
  subProjects?: SubProject[];
  currentSubProjectPath?: string | null;
}

export function ComponentsSection({
  collapsed,
  hasContent,
  isMonorepo,
  subProjects,
  atomGroups,
  compositeGroups,
  activePath,
  loadingComponent,
  onComponentClick,
  onToggle,
  onReload,
  isReloading,
  onCreateComponent,
  setupReason,
  currentSubProjectPath,
}: ComponentsSectionProps) {
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filterGroups = (groups: ComponentGroup[]) => {
    if (!searchQuery) return groups;
    return groups
      .map((group) => ({
        ...group,
        components: group.components.filter((comp) => comp.name.toLowerCase().includes(searchQuery.toLowerCase())),
      }))
      .filter((group) => group.components.length > 0);
  };

  const filteredAtoms = filterGroups(atomGroups);
  const filteredComposites = filterGroups(compositeGroups);
  const hasSearchResults = filteredAtoms.length > 0 || filteredComposites.length > 0;
  return (
    <div data-testid={TID.explorer.componentGroup('components')} className="h-full overflow-hidden flex flex-col">
      <div className="h-6 px-2 flex items-center justify-between bg-muted border-t border-border w-full shrink-0">
        <button type="button" onClick={onToggle} className="flex items-center gap-1 flex-1" disabled={!hasContent}>
          <IconChevronDown
            className={cn('w-3 h-3 transition-transform duration-200', {
              'rotate-[-90deg]': collapsed || !hasContent,
            })}
            stroke={1.5}
          />
          <IconComponents className="w-3.5 h-3.5" stroke={1.5} />
          <span
            className={cn('text-xs font-semibold', {
              'text-foreground': hasContent,
              'text-muted-foreground': !hasContent,
            })}
          >
            {hasContent ? 'Components' : 'No components'}
          </span>
        </button>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReload();
            }}
            disabled={isReloading}
            className={isReloading ? 'opacity-50' : ''}
          >
            <IconRefresh className={cn('w-4 h-4', { 'animate-spin': isReloading })} stroke={1.5} />
          </button>
          <button
            type="button"
            data-testid={TID.explorer.createComponentButton}
            title="New component"
            onClick={(e) => {
              e.stopPropagation();
              onCreateComponent?.();
            }}
          >
            <IconPlus className="w-4 h-4" stroke={1.5} />
          </button>
          {hasContent && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSearchVisible(!searchVisible);
              }}
            >
              <IconSearch className="w-4 h-4" stroke={1.5} />
            </button>
          )}
        </div>
      </div>
      {!collapsed && !hasContent && setupReason && (
        <div className="px-3 py-2">
          <p className="text-xs text-muted-foreground">
            {setupReason === 'no-paths' &&
              'No component paths configured. Add component directories to your project settings.'}
            {setupReason === 'empty-scan' && 'No components found in configured paths. Check your project structure.'}
            {setupReason === 'no-ai-config' &&
              'AI configuration not set up. Configure AI settings to enable component scanning.'}
          </p>
        </div>
      )}
      {!collapsed && hasContent && (
        <div className="flex-1 overflow-y-auto flex flex-col gap-2.5">
          {searchVisible && (
            <div className="h-6 px-2 bg-muted rounded flex items-center gap-1.5 mx-2 mt-2">
              <IconSearch className="w-3.5 h-3.5 text-muted-foreground" stroke={1.5} />
              <Input
                type="text"
                data-testid={TID.explorer.searchInput}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search components..."
                className="h-auto border-0 bg-transparent !text-[11px] text-foreground placeholder:text-muted-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
              />
            </div>
          )}
          {isMonorepo && subProjects && subProjects.length > 0 ? (
            <SubProjectAccordion
              subProjects={subProjects}
              activePath={activePath}
              loadingComponent={loadingComponent}
              onComponentClick={onComponentClick}
              searchQuery={searchQuery}
              currentSubProjectPath={currentSubProjectPath}
            />
          ) : (
            <div className="flex flex-col gap-1 px-2">
              {searchQuery && !hasSearchResults ? (
                <div data-testid="hyper-explorer-no-results" className="px-2 py-3 text-center">
                  <span className="text-xs text-muted-foreground">No components match "{searchQuery}"</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1">
                    <IconChevronDown className="w-2 h-2 text-muted-foreground" stroke={1.5} />
                    <span className="text-xs font-[510] text-[#7A7A7A]">Atom components</span>
                  </div>
                  <ComponentGroupList
                    groups={filteredAtoms}
                    activeComponentPath={activePath}
                    loadingComponentPath={loadingComponent}
                    onComponentClick={onComponentClick}
                    searchQuery={searchQuery}
                  />

                  <div className="flex items-center gap-1 mt-2">
                    <IconChevronDown className="w-2 h-2 text-muted-foreground" stroke={1.5} />
                    <span className="text-xs font-[510] text-[#7A7A7A]">Composite components</span>
                  </div>
                  <ComponentGroupList
                    groups={filteredComposites}
                    activeComponentPath={activePath}
                    loadingComponentPath={loadingComponent}
                    onComponentClick={onComponentClick}
                    searchQuery={searchQuery}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
