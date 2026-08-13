/**
 * @file Guided "New component" dialog (HYP-1184).
 *
 * Accessed via: LeftSidebar's Pages/Components "+" affordances — rendered by
 *   BOTH the SaaS editor and the VS Code extension webview (LeftPanelApp), so
 *   every import here must be safe for the ext webview bundle (no SaaS-only
 *   contexts, no monaco; authFetch only behind the engine branch of
 *   create-component.ts).
 * Assumptions: audience is non-programmers — plain-language copy, no file
 *   system exposed (target folder is auto-picked from where similar
 *   components already live and shown as a caption only).
 */

import { TID } from '@shared/data-testid-map';
import { IconBox, IconLayoutDashboard, IconStack2 } from '@tabler/icons-react';
import cn from 'clsx';
import { useMemo, useState } from 'react';
import { resolveTargetDir } from '@shared/component-create/resolve-target-dir';
import { COMPONENT_KIND_META, COMPONENT_KINDS } from '@shared/component-create/types';
import type { ComponentKind, CreatedComponent } from '@shared/component-create/types';
import { validateComponentName } from '@shared/component-create/validate-name';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { ComponentGroup, SubProject } from '../../lib/component-scanner/types';

const KIND_ICONS: Record<ComponentKind, typeof IconBox> = {
  atom: IconBox,
  composite: IconStack2,
  page: IconLayoutDashboard,
};

export interface CreateComponentDialogProps {
  open: boolean;
  /** Kind preselected by the affordance that opened the dialog. */
  initialKind: ComponentKind;
  onClose: () => void;
  /** Existing groups per kind — used to auto-pick the target folder and for live name-collision checks. */
  atomGroups: ComponentGroup[];
  compositeGroups: ComponentGroup[];
  pageGroups: ComponentGroup[];
  /** Monorepo context (HYP-1184 review): page fallback dir derives from the active sub-project. */
  subProjects?: SubProject[];
  activeSubProjectPath?: string;
  /** Host call — resolves with the created file, throws with a plain-language message. */
  onCreate: (kind: ComponentKind, name: string, dirPath: string) => Promise<CreatedComponent>;
  /** Called after successful creation so the sidebar can refresh + open the new component. */
  onCreated: (component: CreatedComponent, kind: ComponentKind) => void;
}

export function CreateComponentDialog({
  open,
  initialKind,
  onClose,
  atomGroups,
  compositeGroups,
  pageGroups,
  subProjects,
  activeSubProjectPath,
  onCreate,
  onCreated,
}: CreateComponentDialogProps) {
  const [kind, setKind] = useState<ComponentKind>(initialKind);
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const groups = kind === 'atom' ? atomGroups : kind === 'composite' ? compositeGroups : pageGroups;
  const hasSrcDir = useMemo(
    () =>
      [...atomGroups, ...compositeGroups, ...pageGroups].some(
        (g) => g.dirPath === 'src' || g.dirPath.startsWith('src/'),
      ),
    [atomGroups, compositeGroups, pageGroups],
  );
  // Monorepo: pageGroups stay flat-empty by scanner design (pages render per
  // sub-project in the accordion), so the page fallback derives from the
  // active (or first supported) sub-project, mirroring its src/ layout.
  const pageFallbackDir = useMemo(() => {
    if (kind !== 'page' || pageGroups.length > 0) return undefined;
    const prefix = activeSubProjectPath ?? subProjects?.find((sp) => sp.supported)?.path;
    if (!prefix) return undefined;
    const subUsesSrc = [...atomGroups, ...compositeGroups].some((g) => g.dirPath.startsWith(`${prefix}/src/`));
    return `${prefix}/${subUsesSrc ? 'src/pages' : 'pages'}`;
  }, [kind, pageGroups, activeSubProjectPath, subProjects, atomGroups, compositeGroups]);
  const targetDir =
    pageFallbackDir ??
    resolveTargetDir({
      kind,
      groupDirs: groups.map((g) => ({ dirPath: g.dirPath, count: g.components.length })),
      hasSrcDir,
    });

  const nameError = validateComponentName(name);
  // Scanner names carry the .tsx extension ("Button.tsx") — strip before comparing.
  const normalizedName = name.trim().toLowerCase();
  const collision = groups.some((g) =>
    g.components.some((c) => c.name.replace(/\.tsx$/i, '').toLowerCase() === normalizedName),
  );
  const visibleError = touched || name ? nameError : null;
  const canSubmit = !nameError && !collision && !submitting;

  const reset = () => {
    setKind(initialKind);
    setName('');
    setTouched(false);
    setSubmitting(false);
    setSubmitError(null);
  };

  const handleSubmit = async () => {
    setTouched(true);
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const component = await onCreate(kind, name.trim(), targetDir);
      onCreated(component, kind);
      reset();
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent testId={TID.explorer.createComponentDialog} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New component</DialogTitle>
          <DialogDescription>
            Pick what you're building, give it a name — we'll create it and open it for you.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Component type">
          {COMPONENT_KINDS.map((option) => {
            const Icon = KIND_ICONS[option];
            const meta = COMPONENT_KIND_META[option];
            const selected = kind === option;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={TID.explorer.createComponentKind(option)}
                onClick={() => setKind(option)}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                  selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
                )}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" stroke={1.5} />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">{meta.label}</span>
                  <span className="text-xs text-muted-foreground">{meta.description}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="create-component-name" className="text-sm font-medium text-foreground">
            Name
          </label>
          <Input
            id="create-component-name"
            data-testid={TID.explorer.createComponentNameInput}
            value={name}
            placeholder={kind === 'page' ? 'DashboardPage' : kind === 'composite' ? 'ProfileCard' : 'Badge'}
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
              setSubmitError(null);
            }}
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSubmit();
            }}
          />
          {visibleError && <p className="text-xs text-destructive">{visibleError}</p>}
          {!visibleError && collision && (
            <p className="text-xs text-destructive">You already have a component with that name.</p>
          )}
          {!visibleError && !collision && (
            <p className="text-xs text-muted-foreground">
              Will be created in <span className="font-medium">{targetDir}/</span> — where your similar components live.
            </p>
          )}
          {submitError && <p className="text-xs text-destructive">{submitError}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button testId={TID.explorer.createComponentSubmit} onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
