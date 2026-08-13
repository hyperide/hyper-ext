import { TID } from '@shared/data-testid-map';
import { IconChevronDown, IconPackage } from '@tabler/icons-react';
import cn from 'clsx';
import { useEffect, useRef, useState } from 'react';
import type { ComponentListItem, SubProject } from '../../../../lib/component-scanner/types';
import { ComponentGroupList } from '../../ComponentGroupList';

const SUB_PROJECT_COLORS = [
  { badge: 'bg-blue-500/20 text-blue-400 border border-blue-500/30', dot: 'bg-blue-400' },
  { badge: 'bg-green-500/20 text-green-400 border border-green-500/30', dot: 'bg-green-400' },
  { badge: 'bg-purple-500/20 text-purple-400 border border-purple-500/30', dot: 'bg-purple-400' },
  { badge: 'bg-orange-500/20 text-orange-400 border border-orange-500/30', dot: 'bg-orange-400' },
  { badge: 'bg-pink-500/20 text-pink-400 border border-pink-500/30', dot: 'bg-pink-400' },
  { badge: 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30', dot: 'bg-cyan-400' },
];

const UNSUPPORTED_COLOR = {
  badge: 'bg-muted text-muted-foreground border border-border',
  dot: 'bg-muted-foreground',
};

interface SubProjectAccordionProps {
  subProjects: SubProject[];
  activePath: string | null;
  loadingComponent: string | null;
  onComponentClick: (component: ComponentListItem) => void;
  searchQuery: string;
  currentSubProjectPath?: string | null;
}

export function SubProjectAccordion({
  subProjects,
  activePath,
  loadingComponent,
  onComponentClick,
  searchQuery,
  currentSubProjectPath,
}: SubProjectAccordionProps) {
  const supportedProjects = subProjects.filter((p) => p.supported);
  const currentRowRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const sp of subProjects) {
      initial[sp.path] = sp.path === currentSubProjectPath ? false : !sp.supported;
    }
    return initial;
  });

  useEffect(() => {
    if (!currentSubProjectPath) return;
    setCollapsed((prev) => {
      if (prev[currentSubProjectPath] === false) return prev;
      return { ...prev, [currentSubProjectPath]: false };
    });
  }, [currentSubProjectPath]);

  useEffect(() => {
    if (!currentSubProjectPath) return;
    if (!subProjects.some((sp) => sp.path === currentSubProjectPath)) return;
    currentRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentSubProjectPath, subProjects]);

  const toggleProject = (projectPath: string) => {
    setCollapsed((prev) => ({ ...prev, [projectPath]: !prev[projectPath] }));
  };

  const filterGroups = (groups: (typeof subProjects)[0]['atomGroups']) => {
    if (!searchQuery) return groups;
    return groups
      .map((g) => ({
        ...g,
        components: g.components.filter((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase())),
      }))
      .filter((g) => g.components.length > 0);
  };

  if (subProjects.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5 px-2">
      {subProjects.map((sp, idx) => {
        const color = sp.supported
          ? (SUB_PROJECT_COLORS[supportedProjects.indexOf(sp) % SUB_PROJECT_COLORS.length] ?? SUB_PROJECT_COLORS[0])
          : UNSUPPORTED_COLOR;
        const isCollapsed = collapsed[sp.path] ?? !sp.supported;
        const filteredAtoms = filterGroups(sp.atomGroups);
        const filteredComposites = filterGroups(sp.compositeGroups);
        const filteredPages = filterGroups(sp.pageGroups);
        const hasComponents = filteredAtoms.length > 0 || filteredComposites.length > 0 || filteredPages.length > 0;

        return (
          <div
            key={sp.path}
            ref={sp.path === currentSubProjectPath ? currentRowRef : undefined}
            className={cn('rounded-md overflow-hidden', idx > 0 && 'mt-1')}
          >
            {/* Sub-project header */}
            <button
              type="button"
              onClick={() => toggleProject(sp.path)}
              data-testid={
                sp.supported ? TID.explorer.subProject(sp.name) : TID.explorer.subProjectUnsupported(sp.name)
              }
              className="w-full flex items-center gap-1.5 px-1.5 py-1 hover:bg-muted/50 rounded-t-md transition-colors"
            >
              <IconChevronDown
                className={cn('w-3 h-3 transition-transform duration-150 shrink-0', {
                  'rotate-[-90deg]': isCollapsed,
                })}
                stroke={1.5}
              />
              <div className={cn('flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium', color.badge)}>
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', color.dot)} />
                <IconPackage className="w-2.5 h-2.5 shrink-0" stroke={1.5} />
                <span className="truncate max-w-[120px]">{sp.name}</span>
              </div>
              {!sp.supported && (
                <span className="text-[9px] text-muted-foreground truncate flex-1 text-left">
                  {sp.unsupportedReason}
                </span>
              )}
            </button>

            {/* Sub-project content */}
            {!isCollapsed && (
              <div className="pl-3 pr-1 pb-1.5 flex flex-col gap-1 border-l border-border/40 ml-2.5">
                {!sp.supported ? null : !hasComponents ? (
                  <p className="text-[10px] text-muted-foreground py-1 px-1">No components found</p>
                ) : (
                  <>
                    {filteredPages.length > 0 && (
                      <div className="flex flex-col gap-0.5 mt-1">
                        <span className="text-[9px] font-[510] text-muted-foreground uppercase tracking-wide px-1">
                          Pages
                        </span>
                        <ComponentGroupList
                          groups={filteredPages}
                          activeComponentPath={activePath}
                          loadingComponentPath={loadingComponent}
                          onComponentClick={onComponentClick}
                          searchQuery={searchQuery}
                        />
                      </div>
                    )}
                    {filteredAtoms.length > 0 && (
                      <div className="flex flex-col gap-0.5 mt-1">
                        <span className="text-[9px] font-[510] text-muted-foreground uppercase tracking-wide px-1">
                          Atoms
                        </span>
                        <ComponentGroupList
                          groups={filteredAtoms}
                          activeComponentPath={activePath}
                          loadingComponentPath={loadingComponent}
                          onComponentClick={onComponentClick}
                          searchQuery={searchQuery}
                        />
                      </div>
                    )}
                    {filteredComposites.length > 0 && (
                      <div className="flex flex-col gap-0.5 mt-1">
                        <span className="text-[9px] font-[510] text-muted-foreground uppercase tracking-wide px-1">
                          Components
                        </span>
                        <ComponentGroupList
                          groups={filteredComposites}
                          activeComponentPath={activePath}
                          loadingComponentPath={loadingComponent}
                          onComponentClick={onComponentClick}
                          searchQuery={searchQuery}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
