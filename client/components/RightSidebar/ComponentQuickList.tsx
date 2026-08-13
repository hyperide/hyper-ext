import { TID } from '@shared/data-testid-map';
import type { ComponentGroup } from '../../../lib/component-scanner/types';

interface Props {
  atomGroups: ComponentGroup[];
  compositeGroups: ComponentGroup[];
  pageGroups?: ComponentGroup[];
  onComponentClick?: (name: string, path: string) => void;
}

export function ComponentQuickList({ atomGroups, compositeGroups, pageGroups = [], onComponentClick }: Props) {
  return (
    <div data-testid={TID.inspector.componentQuickList} className="px-3 pb-4 space-y-3">
      {atomGroups.length > 0 && (
        <ComponentGroupSection title="Atoms" groups={atomGroups} onComponentClick={onComponentClick} />
      )}
      {compositeGroups.length > 0 && (
        <ComponentGroupSection title="Composite" groups={compositeGroups} onComponentClick={onComponentClick} />
      )}
      {pageGroups.length > 0 && (
        <ComponentGroupSection title="Pages" groups={pageGroups} onComponentClick={onComponentClick} />
      )}
    </div>
  );
}

function ComponentGroupSection({
  title,
  groups,
  onComponentClick,
}: {
  title: string;
  groups: ComponentGroup[];
  onComponentClick?: (name: string, path: string) => void;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 px-1 mb-1">{title}</p>
      <div className="space-y-0.5">
        {groups.flatMap((group) =>
          group.components.map((comp) => (
            <button
              key={comp.path}
              type="button"
              data-testid={TID.inspector.quickListItem(comp.name)}
              className="w-full text-left text-xs px-2 py-1 rounded hover:bg-muted transition-colors text-foreground truncate"
              onClick={() => onComponentClick?.(comp.name, comp.path)}
              title={comp.path}
            >
              {comp.name}
            </button>
          )),
        )}
      </div>
    </div>
  );
}
