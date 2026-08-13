/**
 * @file Centered component picker shown in the Hyper Canvas empty-state.
 *
 * Accessed via: PreviewPanelApp renders this in place of the bare "No component selected" hint when
 *   `shouldShowComponentPicker` is true — i.e. no component is selected AND both side panels
 *   (Explorer + Inspector) are hidden. With no panel open it is the only place left to pick a
 *   component, so the available component list is surfaced centered in the canvas.
 * Invariants:
 *   - Renders the SAME scanner data the Inspector quick-list uses (atom / composite / PAGE groups);
 *     pages must be included or page-level entries (App.tsx) become unreachable with no panel open.
 *   - A click drives the normal selection pipeline (stateHub `currentComponent`) — identical to an
 *     Explorer/Inspector click — via the `onPick` callback wired in PreviewPanelApp.
 * Sibling: client/components/RightSidebar/ComponentQuickList.tsx (the narrow-sidebar variant). This
 *   one is a centered card for the panel-less canvas; the data shape and click contract are shared.
 */

import type { ComponentGroup } from '../../../../lib/component-scanner/types';
import { OverlayShell } from '@shared/components/overlays/OverlayShell';
import { TID } from '../shared/data-testid-map';

export interface PickerGroupsData {
  atomGroups: ComponentGroup[];
  compositeGroups: ComponentGroup[];
  pageGroups: ComponentGroup[];
}

/** True when at least one group carries a component (drives whether the picker is worth showing). */
export function hasPickerComponents(groups: PickerGroupsData | null | undefined): boolean {
  if (!groups) return false;
  return [groups.atomGroups, groups.compositeGroups, groups.pageGroups].some((list) =>
    list.some((group) => group.components.length > 0),
  );
}

/**
 * Gate for the canvas component picker. It replaces the bare "No component selected" hint ONLY when
 * there is no component to show, no side panel is open to pick from, and the project actually has
 * components — otherwise the plain hint (or an empty-project hint) stays.
 */
export function shouldShowComponentPicker(args: {
  showNoComponentHint: boolean;
  sidePanelsHidden: boolean;
  hasComponents: boolean;
}): boolean {
  return args.showNoComponentHint && args.sidePanelsHidden && args.hasComponents;
}

interface CanvasComponentPickerProps {
  groups: PickerGroupsData;
  onPick: (name: string, path: string) => void;
}

const SECTIONS: ReadonlyArray<{ title: string; key: keyof PickerGroupsData }> = [
  { title: 'Pages', key: 'pageGroups' },
  { title: 'Composite', key: 'compositeGroups' },
  { title: 'Atoms', key: 'atomGroups' },
];

export function CanvasComponentPicker({ groups, onPick }: CanvasComponentPickerProps) {
  return (
    <OverlayShell testId={TID.preview.componentPicker} ariaLive="polite">
      <div className="flex flex-col gap-3 w-[min(420px,80%)] max-h-[80%] p-5 rounded-[14px] bg-popover border border-border shadow-[0_2px_4px_rgba(0,0,0,0.15),0_2px_16px_rgba(0,0,0,0.15)]">
        <header className="text-center">
          <h2 className="m-0 text-base font-medium text-foreground">Select a component to preview</h2>
          <p className="mt-1 mb-0 text-xs text-muted-foreground">No panel open — pick one to render it</p>
        </header>
        <div className="flex flex-col gap-3 overflow-y-auto">
          {SECTIONS.map(({ title, key }) => (
            <PickerSection key={key} title={title} groups={groups[key]} onPick={onPick} />
          ))}
        </div>
      </div>
    </OverlayShell>
  );
}

function PickerSection({
  title,
  groups,
  onPick,
}: {
  title: string;
  groups: ComponentGroup[];
  onPick: (name: string, path: string) => void;
}) {
  const components = groups.flatMap((group) => group.components);
  if (components.length === 0) return null;
  return (
    <section>
      <p className="px-1 mb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">{title}</p>
      <div className="flex flex-col gap-0.5">
        {components.map((comp) => (
          <button
            key={comp.path}
            type="button"
            data-testid={TID.preview.componentPickerItem(comp.name)}
            className="w-full px-2 py-1 text-left text-xs rounded text-foreground truncate hover:bg-accent transition-colors"
            onClick={() => onPick(comp.name, comp.path)}
            title={comp.path}
          >
            {comp.name}
          </button>
        ))}
      </div>
    </section>
  );
}
