/**
 * @file Nudge HUD state — mode, step sizes, visibility, current value
 *
 * Accessed via: Backing impl for the NudgeStatePort (client/lib/nudge). UI components depend
 *   on the port via useNudgeState/useNudgeActions and never import this store directly.
 * Assumptions: one store instance per JS realm. SaaS uses the shared `nudgeStore` singleton;
 *   the VS Code extension uses a per-webview instance from `createNudgeStore()`. Both are
 *   fronted by a NudgeStatePort so the components stay realm-agnostic.
 * Architecture: https://hyperide.github.io/reports/nudge-hud
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type NudgeMode = 'numeric' | 'token';
type NudgeTarget = 'alt' | 'shift';

/** Per-unit step defaults for no-modifier, alt, and shift */
const UNIT_DEFAULTS: Record<string, { base: number; alt: number; shift: number }> = {
  px: { base: 1, alt: 0.1, shift: 10 },
  rem: { base: 0.25, alt: 0.025, shift: 2.5 },
  em: { base: 0.25, alt: 0.025, shift: 2.5 },
  '%': { base: 1, alt: 0.1, shift: 10 },
};

interface PersistedSteps {
  altStep: number;
  shiftStep: number;
}

interface NudgeState {
  mode: NudgeMode;
  altStep: number;
  shiftStep: number;
  /** true when user has explicitly set altStep via the alt nudge key */
  customAltStep: boolean;
  /** true when user has explicitly set shiftStep via the shift nudge key */
  customShiftStep: boolean;
  editingTarget: NudgeTarget | null;
  highlightedTarget: NudgeTarget;
  visible: boolean;
  activeProperty: string | null;
  currentValue: string;
  projectId: string;
  /** Persisted per-project step overrides. Only stored, not exposed in UI state. */
  _savedSteps: Record<string, PersistedSteps>;

  // Actions
  show: (property: string, value: string) => void;
  hide: () => void;
  toggleMode: () => void;
  setAltStep: (step: number) => void;
  setShiftStep: (step: number) => void;
  startEditing: (target: NudgeTarget) => void;
  stopEditing: () => void;
  setHighlightedTarget: (target: NudgeTarget) => void;
  updateCurrentValue: (value: string) => void;
  setProjectId: (id: string) => void;
  saveForLater: () => void;
  getStepForModifiers: (shift: boolean, alt: boolean, unit: string) => number;
  reset: () => void;
}

const DEFAULT_ALT_STEP = 0.1;
const DEFAULT_SHIFT_STEP = 10;

const defaultState = {
  mode: 'numeric' as NudgeMode,
  altStep: DEFAULT_ALT_STEP,
  shiftStep: DEFAULT_SHIFT_STEP,
  customAltStep: false,
  customShiftStep: false,
  editingTarget: null as NudgeTarget | null,
  highlightedTarget: 'shift' as NudgeTarget,
  visible: false,
  activeProperty: null as string | null,
  currentValue: '',
  projectId: '',
  _savedSteps: {} as Record<string, PersistedSteps>,
};

export type NudgeStore = UseBoundStore<StoreApi<NudgeState>>;

/** State + action initializer, shared by the persisted singleton and per-realm instances. */
const nudgeInitializer = (set: StoreApi<NudgeState>['setState'], get: StoreApi<NudgeState>['getState']): NudgeState =>
  ({
    ...defaultState,

    show: (property, value) => {
      const { visible, activeProperty } = get();
      if (visible && activeProperty === property) {
        set({ currentValue: value });
      } else {
        set({ visible: true, activeProperty: property, currentValue: value });
      }
    },

    hide: () => {
      set({ visible: false, editingTarget: null });
    },

    toggleMode: () => {
      set((s) => ({ mode: s.mode === 'numeric' ? 'token' : 'numeric' }));
    },

    setAltStep: (step) => {
      set({ altStep: step, customAltStep: true });
    },

    setShiftStep: (step) => {
      set({ shiftStep: step, customShiftStep: true });
    },

    startEditing: (target) => {
      set({ editingTarget: target });
    },

    stopEditing: () => {
      set({ editingTarget: null });
    },

    setHighlightedTarget: (target) => {
      set({ highlightedTarget: target });
    },

    updateCurrentValue: (value) => {
      set({ currentValue: value });
    },

    setProjectId: (id) => {
      const { _savedSteps } = get();
      const saved = _savedSteps[id];
      if (saved) {
        set({
          projectId: id,
          altStep: saved.altStep,
          shiftStep: saved.shiftStep,
          customAltStep: true,
          customShiftStep: true,
        });
      } else {
        set({
          projectId: id,
          altStep: DEFAULT_ALT_STEP,
          shiftStep: DEFAULT_SHIFT_STEP,
          customAltStep: false,
          customShiftStep: false,
        });
      }
    },

    saveForLater: () => {
      const { projectId, altStep, shiftStep, _savedSteps } = get();
      if (!projectId) return;
      set({ _savedSteps: { ..._savedSteps, [projectId]: { altStep, shiftStep } } });
    },

    getStepForModifiers: (shift, alt, unit) => {
      const { altStep, shiftStep, customAltStep, customShiftStep } = get();
      const defaults = UNIT_DEFAULTS[unit] ?? UNIT_DEFAULTS.px;

      if (alt) {
        return customAltStep ? altStep : defaults.alt;
      }
      if (shift) {
        return customShiftStep ? shiftStep : defaults.shift;
      }
      return defaults.base;
    },

    reset: () => {
      set({
        mode: defaultState.mode,
        altStep: DEFAULT_ALT_STEP,
        shiftStep: DEFAULT_SHIFT_STEP,
        customAltStep: false,
        customShiftStep: false,
        editingTarget: null,
        highlightedTarget: 'shift',
        visible: false,
        activeProperty: null,
        currentValue: '',
        projectId: '',
      });
    },
  }) satisfies NudgeState;

/**
 * Create a fresh, NON-persisted nudge store. One per VS Code webview realm and one per test,
 * so realms/tests never share mutable state. The SaaS singleton below adds persistence.
 */
export function createNudgeStore(): NudgeStore {
  return create<NudgeState>()(nudgeInitializer);
}

/** SaaS shared singleton — persists per-project step overrides to localStorage. */
export const nudgeStore: NudgeStore = create<NudgeState>()(
  persist(nudgeInitializer, {
    name: 'nudge-config',
    storage: createJSONStorage(() => localStorage),
    partialize: (state) => ({ _savedSteps: state._savedSteps }),
  }),
);
