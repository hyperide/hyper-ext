import { useEffect, useMemo } from 'react';
import { useEditorStore } from '@/stores/editorStore';

export const DEFAULT_RIGHT_SIDEBAR_WIDTH = 234;

/**
 * Computes the effective right sidebar width based on editor state.
 * Sets `--right-sidebar-width` CSS variable on `:root` so that
 * fixed-positioned elements (e.g. ConnectionStatus) can avoid overlapping the sidebar.
 * Removes the variable on unmount.
 *
 * @returns the computed width in px (0 when sidebar is hidden)
 */
export function useRightSidebarWidth(isCodeEditorMode: boolean, sidebarsHidden: boolean, commentsSidebarWidth: number) {
  const isAIChatOpen = useEditorStore((s) => s.isAIChatOpen);
  const isAIChatDocked = useEditorStore((s) => s.isAIChatDocked);
  const aiChatSidebarWidth = useEditorStore((s) => s.aiChatSidebarWidth);
  const showComments = useEditorStore((s) => s.showComments);

  const width = useMemo(() => {
    if (isCodeEditorMode || sidebarsHidden) return 0;
    if (isAIChatDocked && isAIChatOpen) return aiChatSidebarWidth;
    if (showComments) return commentsSidebarWidth;
    return DEFAULT_RIGHT_SIDEBAR_WIDTH;
  }, [
    isCodeEditorMode,
    sidebarsHidden,
    isAIChatDocked,
    isAIChatOpen,
    aiChatSidebarWidth,
    showComments,
    commentsSidebarWidth,
  ]);

  useEffect(() => {
    document.documentElement.style.setProperty('--right-sidebar-width', `${width}px`);
    return () => {
      document.documentElement.style.removeProperty('--right-sidebar-width');
    };
  }, [width]);

  return width;
}
