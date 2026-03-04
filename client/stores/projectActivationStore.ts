import { create } from 'zustand';

interface ProjectActivationState {
  activatedProjectId: string | null;
  setActivatedProject: (id: string) => void;
}

/** Tracks which project has been activated via SSE. */
export const useProjectActivationStore = create<ProjectActivationState>((set) => ({
  activatedProjectId: null,
  setActivatedProject: (id) => set({ activatedProjectId: id }),
}));
