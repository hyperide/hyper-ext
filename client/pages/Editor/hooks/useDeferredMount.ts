import { useEffect } from 'react';

interface UseDeferredMountDeps {
  activeProjectStatus: string | undefined;
  isCodeEditorMode: boolean;
  iframeReady: boolean;
  codeServerReady: boolean;
  setIframeReady: (ready: boolean) => void;
  setCodeServerReady: (ready: boolean) => void;
  isAIChatDocked: boolean;
  setIsAIChatDocked: (docked: boolean) => void;
}

export function useDeferredMount(deps: UseDeferredMountDeps) {
  const {
    activeProjectStatus,
    isCodeEditorMode,
    iframeReady,
    codeServerReady,
    setIframeReady,
    setCodeServerReady,
    isAIChatDocked,
    setIsAIChatDocked,
  } = deps;

  useEffect(() => {
    if (activeProjectStatus !== 'running') return;
    if (isCodeEditorMode && !codeServerReady) {
      setCodeServerReady(true);
      return;
    }
    if (!isCodeEditorMode && !iframeReady) {
      setIframeReady(true);
      const timer = setTimeout(() => setCodeServerReady(true), 1000);
      return () => clearTimeout(timer);
    }
  }, [activeProjectStatus, isCodeEditorMode, codeServerReady, iframeReady, setIframeReady, setCodeServerReady]);

  useEffect(() => {
    if (isCodeEditorMode && isAIChatDocked) {
      setIsAIChatDocked(false);
    }
  }, [isCodeEditorMode, isAIChatDocked, setIsAIChatDocked]);
}
