import { create } from 'zustand';
import { loadPersistedState, savePersistedState } from '@/lib/storage';

interface EditorFile {
  path: string;
  content: string;
  originalContent: string; // For dirty tracking
}

type SplitOrientation = 'horizontal' | 'vertical';

export type ProjectRole = 'editor' | 'viewer';

interface EditorState {
  openFiles: Map<string, EditorFile>;
  activeFilePath: string | null;
  diffMode: boolean;
  showComments: boolean;
  isAddingComment: boolean;
  selectedCommentId: string | null;
  // Split view state
  splitViewEnabled: boolean;
  splitOrientation: SplitOrientation;
  // Project access role
  projectRole: ProjectRole | null;
  isReadonly: boolean;
  // AI Chat state
  isAIChatOpen: boolean;
  isAIChatDocked: boolean;
  aiChatSidebarWidth: number;
  aiChatInitialPrompt: string | undefined;
  aiChatForceNewChat: boolean;
  // Logs panel
  isLogsPanelOpen: boolean;
  // Left sidebar width
  leftSidebarWidth: number;

  // Actions
  openFile: (path: string, content: string, openInDiffMode?: boolean) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  markFileSaved: (path: string) => void;
  isFileDirty: (path: string) => boolean;
  getFile: (path: string) => EditorFile | undefined;
  closeAllFiles: () => void;
  setDiffMode: (enabled: boolean) => void;
  setShowComments: (show: boolean) => void;
  setIsAddingComment: (adding: boolean) => void;
  setSelectedCommentId: (id: string | null) => void;
  // Split view actions
  toggleSplitView: () => void;
  setSplitOrientation: (orientation: SplitOrientation) => void;
  // Project role actions
  setProjectRole: (role: ProjectRole | null) => void;
  // AI Chat actions
  setIsAIChatOpen: (open: boolean) => void;
  setIsAIChatDocked: (docked: boolean) => void;
  setAIChatSidebarWidth: (width: number) => void;
  openAIChat: (prompt?: string, forceNewChat?: boolean) => void;
  closeAIChat: () => void;
  clearAIChatPrompt: () => void;
  // Logs panel actions
  toggleLogsPanelWithDock: () => void;
  // Left sidebar width actions
  setLeftSidebarWidth: (width: number) => void;
}

// Load persisted state
const persistedState = loadPersistedState();

export const useEditorStore = create<EditorState>((set, get) => ({
  openFiles: new Map(),
  activeFilePath: persistedState.activeFilePath,
  diffMode: false,
  showComments: false,
  isAddingComment: false,
  selectedCommentId: null,
  splitViewEnabled: persistedState.splitViewEnabled ?? false,
  splitOrientation:
    persistedState.splitOrientation === 'horizontal' || persistedState.splitOrientation === 'vertical'
      ? persistedState.splitOrientation
      : 'horizontal',
  projectRole: null,
  isReadonly: false,
  // AI Chat state
  isAIChatOpen: false,
  isAIChatDocked: persistedState.isAIChatDocked ?? false,
  aiChatSidebarWidth: persistedState.aiChatSidebarWidth ?? 400,
  aiChatInitialPrompt: undefined,
  aiChatForceNewChat: false,
  // Logs panel
  isLogsPanelOpen: persistedState.isLogsPanelOpen ?? false,
  // Left sidebar width
  leftSidebarWidth: persistedState.leftSidebarWidth ?? 280,

  openFile: (path: string, content: string, openInDiffMode = false) => {
    set((state) => {
      const newOpenFiles = new Map(state.openFiles);

      // Add file if not already open
      if (!newOpenFiles.has(path)) {
        newOpenFiles.set(path, {
          path,
          content,
          originalContent: content,
        });
      }

      // Persist to localStorage
      const openFilePaths = Array.from(newOpenFiles.keys());
      savePersistedState({
        openFiles: openFilePaths,
        activeFilePath: path,
      });

      return {
        openFiles: newOpenFiles,
        activeFilePath: path,
        diffMode: openInDiffMode,
      };
    });
  },

  closeFile: (path: string) => {
    set((state) => {
      const newOpenFiles = new Map(state.openFiles);
      newOpenFiles.delete(path);

      let newActivePath = state.activeFilePath;

      // If closing active file, switch to another file
      if (newActivePath === path) {
        const remainingPaths = Array.from(newOpenFiles.keys());
        newActivePath = remainingPaths.length > 0 ? remainingPaths[0] : null;
      }

      // Persist to localStorage
      const openFilePaths = Array.from(newOpenFiles.keys());
      savePersistedState({
        openFiles: openFilePaths,
        activeFilePath: newActivePath,
      });

      return {
        openFiles: newOpenFiles,
        activeFilePath: newActivePath,
      };
    });
  },

  setActiveFile: (path: string) => {
    savePersistedState({ activeFilePath: path });
    set({ activeFilePath: path });
  },

  updateFileContent: (path: string, content: string) => {
    console.log('[editorStore] updateFileContent called:', {
      path,
      contentLength: content.length,
      contentPreview: content.substring(0, 50),
    });
    set((state) => {
      const newOpenFiles = new Map(state.openFiles);
      const file = newOpenFiles.get(path);

      if (file) {
        console.log(
          '[editorStore] Updating file in store. Old length:',
          file.content.length,
          'New length:',
          content.length,
        );
        newOpenFiles.set(path, {
          ...file,
          content,
        });
      } else {
        console.warn('[editorStore] File not found in openFiles:', path);
      }

      return { openFiles: newOpenFiles };
    });
  },

  markFileSaved: (path: string) => {
    set((state) => {
      const newOpenFiles = new Map(state.openFiles);
      const file = newOpenFiles.get(path);

      if (file) {
        newOpenFiles.set(path, {
          ...file,
          originalContent: file.content,
        });
      }

      return { openFiles: newOpenFiles };
    });
  },

  isFileDirty: (path: string) => {
    const file = get().openFiles.get(path);
    return file ? file.content !== file.originalContent : false;
  },

  getFile: (path: string) => {
    return get().openFiles.get(path);
  },

  closeAllFiles: () => {
    savePersistedState({
      openFiles: [],
      activeFilePath: null,
    });
    set({
      openFiles: new Map(),
      activeFilePath: null,
    });
  },

  setDiffMode: (enabled: boolean) => {
    set({ diffMode: enabled });
  },

  setShowComments: (show: boolean) => {
    set({ showComments: show });
  },

  setIsAddingComment: (adding: boolean) => {
    set({ isAddingComment: adding });
  },

  setSelectedCommentId: (id: string | null) => {
    set({ selectedCommentId: id, showComments: id !== null });
  },

  toggleSplitView: () => {
    const newEnabled = !get().splitViewEnabled;
    savePersistedState({ splitViewEnabled: newEnabled });
    set({ splitViewEnabled: newEnabled });
  },

  setSplitOrientation: (orientation: SplitOrientation) => {
    savePersistedState({ splitOrientation: orientation });
    set({ splitOrientation: orientation });
  },

  setProjectRole: (role: ProjectRole | null) => {
    set({ projectRole: role, isReadonly: role === 'viewer' });
  },

  // AI Chat actions
  setIsAIChatOpen: (open: boolean) => {
    set({ isAIChatOpen: open });
  },

  setIsAIChatDocked: (docked: boolean) => {
    savePersistedState({ isAIChatDocked: docked });
    set({ isAIChatDocked: docked });
  },

  setAIChatSidebarWidth: (width: number) => {
    const clampedWidth = Math.max(300, Math.min(600, width));
    savePersistedState({ aiChatSidebarWidth: clampedWidth });
    set({ aiChatSidebarWidth: clampedWidth });
  },

  openAIChat: (prompt?: string, forceNewChat = false) => {
    set({
      isAIChatOpen: true,
      aiChatInitialPrompt: prompt,
      aiChatForceNewChat: forceNewChat,
    });
  },

  closeAIChat: () => {
    set({ isAIChatOpen: false });
  },

  clearAIChatPrompt: () => {
    set({
      aiChatInitialPrompt: undefined,
      aiChatForceNewChat: false,
    });
  },

  toggleLogsPanelWithDock: () => {
    const newOpen = !get().isLogsPanelOpen;
    if (newOpen && !get().isAIChatDocked) {
      savePersistedState({ isLogsPanelOpen: newOpen, isAIChatDocked: true });
      set({ isLogsPanelOpen: newOpen, isAIChatDocked: true });
    } else {
      savePersistedState({ isLogsPanelOpen: newOpen });
      set({ isLogsPanelOpen: newOpen });
    }
  },

  setLeftSidebarWidth: (width: number) => {
    const clampedWidth = Math.max(200, Math.min(600, width));
    savePersistedState({ leftSidebarWidth: clampedWidth });
    set({ leftSidebarWidth: clampedWidth });
  },
}));
