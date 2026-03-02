/**
 * Hook for managing floating panels state
 * Handles ComponentNavigatorPanel and InsertInstancePanel visibility and state
 */

import { useCallback, useEffect, useState } from 'react';
import type { CanvasEngine } from '@/lib/canvas-engine';
import { useOpenAIChat } from '@/lib/platform/PlatformContext';

interface UsePanelManagementProps {
  engine: CanvasEngine;
  selectedIds: string[];
}

interface UsePanelManagementReturn {
  elementY: number;
  panelOpenForId: string | null;
  showInsertPanel: boolean;
  selectedComponentType: string | null;
  selectedComponentFilePath: string | undefined;
  setElementY: React.Dispatch<React.SetStateAction<number>>;
  setSelectedComponentType: React.Dispatch<React.SetStateAction<string | null>>;
  handleClosePanel: () => void;
  handleOpenPanel: (id: string) => void;
  handleComponentClick: (componentType: string) => void;
  handleOpenInsertPanel: (componentType: string, componentFilePath?: string) => void;
  handleCreatePage: () => void;
  handleCreateComponent: () => void;
  handleElementPosition: (id: string, y: number) => void;
}

/**
 * Manages floating panels state (ComponentNavigator, InsertInstance)
 */
export function usePanelManagement({ engine, selectedIds }: UsePanelManagementProps): UsePanelManagementReturn {
  const openAIChat = useOpenAIChat();
  const [elementY, setElementY] = useState<number>(0);
  const [panelOpenForId, setPanelOpenForId] = useState<string | null>(null);
  const [showInsertPanel, setShowInsertPanel] = useState(false);
  const [selectedComponentType, setSelectedComponentType] = useState<string | null>(null);
  const [selectedComponentFilePath, setSelectedComponentFilePath] = useState<string | undefined>(undefined);

  // Close panel if selected element changes to a different one
  useEffect(() => {
    if (selectedIds[0] && selectedIds[0] !== panelOpenForId) {
      setPanelOpenForId(null);
      setShowInsertPanel(false);
    }
  }, [selectedIds, panelOpenForId]);

  const handleClosePanel = useCallback(() => {
    setPanelOpenForId(null);
    setShowInsertPanel(false);
    setSelectedComponentFilePath(undefined);
  }, []);

  const handleElementPosition = useCallback((_id: string, y: number) => {
    setElementY(y);
  }, []);

  const handleOpenPanel = useCallback(
    (id: string) => {
      engine.select(id);
      setPanelOpenForId(id);
      setShowInsertPanel(false);
    },
    [engine],
  );

  const handleComponentClick = useCallback((componentType: string) => {
    setSelectedComponentType(componentType);
    setSelectedComponentFilePath(undefined);
    setShowInsertPanel(true);
  }, []);

  const handleOpenInsertPanel = useCallback((componentType: string, componentFilePath?: string) => {
    setSelectedComponentType(componentType);
    setSelectedComponentFilePath(componentFilePath);
    setShowInsertPanel(true);
    setPanelOpenForId(null); // Close navigator if open
  }, []);

  const handleCreatePage = useCallback(() => {
    openAIChat({ prompt: 'Create a new page component', forceNewChat: true });
  }, [openAIChat]);

  const handleCreateComponent = useCallback(() => {
    openAIChat({ prompt: 'Create a new component', forceNewChat: true });
  }, [openAIChat]);

  return {
    elementY,
    panelOpenForId,
    showInsertPanel,
    selectedComponentType,
    selectedComponentFilePath,
    setElementY,
    setSelectedComponentType,
    handleClosePanel,
    handleOpenPanel,
    handleComponentClick,
    handleOpenInsertPanel,
    handleCreatePage,
    handleCreateComponent,
    handleElementPosition,
  };
}
