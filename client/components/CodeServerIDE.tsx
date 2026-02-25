import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '@/utils/authFetch';
import { useReconnectingEventSource } from '@/hooks/useReconnectingEventSource';
import { useAuthStore } from '@/stores/authStore';
import { useTheme } from '@/components/ThemeProvider';
import {
  IconLoader2,
  IconAlertCircle,
  IconRefresh,
} from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import cn from 'clsx';

interface CodeServerIDEProps {
  projectId: string;
  className?: string;
  onReady?: () => void;
  onError?: (error: string) => void;
  onActiveFileChange?: (filePath: string | null) => void;
  onOpenProjectSettings?: () => void;
  onGoToVisual?: (uniqId: string, elementType: string, filePath: string) => void;
}

type IDEState = 'starting' | 'loading' | 'ready' | 'error' | 'stopped';

interface IDEStatus {
  running: boolean;
  ideUrl: string | null;
  error?: string;
}

export function CodeServerIDE({
  projectId,
  className,
  onReady,
  onError,
  onActiveFileChange,
  onOpenProjectSettings,
  onGoToVisual,
}: CodeServerIDEProps) {
  const [state, setState] = useState<IDEState>('stopped');
  const [error, setError] = useState<string | null>(null);
  const [ideUrl, setIdeUrl] = useState<string | null>(null);
  const [sseUrl, setSseUrl] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const startRequestedRef = useRef(false);
  const { accessToken, logout, updateTheme } = useAuthStore();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const navigate = useNavigate();

  // Handle SSE status updates
  const handleSSEMessage = useCallback(
    (data: unknown) => {
      // Check for goToVisual event first
      const message = data as { type?: string; element?: { uniqId: string; elementType: string; filePath: string } };
      if (message.type === 'goToVisual' && message.element) {
        console.log('[IDE] Received goToVisual SSE event:', message.element);
        onGoToVisual?.(message.element.uniqId, message.element.elementType, message.element.filePath);
        return;
      }

      // Handle IDE status updates
      const status = data as IDEStatus;

      if (status.error) {
        setError(status.error);
        setState('error');
        onError?.(status.error);
        return;
      }

      if (status.running && status.ideUrl) {
        // Stop polling if running
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        setIdeUrl(status.ideUrl);
        // Only set loading if not already ready (don't reset after iframe loaded)
        setState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
      }
    },
    [onError, onGoToVisual]
  );

  // SSE connection for real-time status updates
  useReconnectingEventSource({
    url: sseUrl,
    withCredentials: true,
    onMessage: handleSSEMessage,
    onError: () => {
      // SSE failed, fall back to polling if we're starting
      if (state === 'starting' && !pollingRef.current) {
        startPolling();
      }
    },
  });

  // Start IDE
  const startIDE = useCallback(async () => {
    if (!projectId || startRequestedRef.current) return;
    startRequestedRef.current = true;

    setState('starting');
    setError(null);

    // Connect to SSE before starting (auth via httpOnly cookie)
    setSseUrl(`/api/projects/${projectId}/ide/status/stream`);

    try {
      const response = await authFetch(`/api/projects/${projectId}/ide/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: resolvedTheme }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to start IDE');
      }

      // SSE will notify us when IDE is ready
      // But also start polling as fallback
      startPolling();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start IDE';
      setError(message);
      setState('error');
      onError?.(message);
      startRequestedRef.current = false;
    }
  }, [projectId, onError, accessToken, resolvedTheme]);

  // Polling fallback (in case SSE doesn't work)
  const startPolling = useCallback(() => {
    if (!projectId || pollingRef.current) return;

    let attempts = 0;
    const maxAttempts = 300; // 5 minutes

    pollingRef.current = setInterval(async () => {
      attempts++;

      try {
        const response = await authFetch(`/api/projects/${projectId}/ide/status`);
        if (!response.ok) return;

        const status: IDEStatus = await response.json();

        if (status.running && status.ideUrl) {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          setIdeUrl(status.ideUrl);
          setState('loading');
        } else if (attempts >= maxAttempts) {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          setError('IDE startup timeout');
          setState('error');
          onError?.('IDE startup timeout');
        }
      } catch {
        // Continue polling
      }
    }, 2000); // Poll every 2 seconds (SSE is primary)
  }, [projectId, onError]);

  // Restart IDE
  const restartIDE = useCallback(async () => {
    startRequestedRef.current = false;
    setState('starting');
    setError(null);

    try {
      const response = await authFetch(`/api/projects/${projectId}/ide/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: resolvedTheme }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to restart IDE');
      }

      // SSE will notify us when IDE is ready
      startPolling();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to restart IDE';
      setError(message);
      setState('error');
      onError?.(message);
    }
  }, [projectId, startPolling, onError, resolvedTheme]);

  // Check status on mount and auto-start
  useEffect(() => {
    if (!projectId) return;

    const init = async () => {
      try {
        const response = await authFetch(`/api/projects/${projectId}/ide/status`);
        if (!response.ok) throw new Error('Failed to check status');

        const status: IDEStatus = await response.json();

        if (status.running && status.ideUrl) {
          // Connect to SSE for real-time updates (including goToVisual events)
          // Auth via httpOnly cookie
          setSseUrl(`/api/projects/${projectId}/ide/status/stream`);

          setIdeUrl(status.ideUrl);
          setState('loading');
        } else {
          startIDE();
        }
      } catch {
        startIDE();
      }
    };

    init();

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [projectId, startIDE]);

  // Listen for postMessage from code-server iframe (script is injected server-side in main.ts)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'hypercanvas:activeFileChange') {
        console.log('[IDE] Received activeFileChange:', event.data.path);
        onActiveFileChange?.(event.data.path);
      }
      if (event.data?.type === 'hypercanvas:navigateHome') {
        console.log('[IDE] Received navigateHome');
        navigate('/projects');
      }
      // UserMenu handlers
      if (event.data?.type === 'hypercanvas:logout') {
        console.log('[IDE] Received logout');
        logout();
        navigate('/login');
      }
      if (event.data?.type === 'hypercanvas:navigate') {
        console.log('[IDE] Received navigate:', event.data.path);
        navigate(event.data.path);
      }
      if (event.data?.type === 'hypercanvas:themeChange') {
        console.log('[IDE] Received themeChange:', event.data.theme);
        setTheme(event.data.theme);
        // Save to DB (which also updates IDE settings.json on server)
        updateTheme(event.data.theme).then(() => {
          // Reload IDE to apply new theme
          // nosemgrep: wildcard-postmessage-configuration -- iframe communication, origin varies between SaaS and VS Code webview
          iframeRef.current?.contentWindow?.postMessage({ type: 'hypercanvas:reloadIDE' }, '*');
        });
      }
      if (event.data?.type === 'hypercanvas:openProjectSettings') {
        console.log('[IDE] Received openProjectSettings');
        onOpenProjectSettings?.();
      }
      // IDE asks for current theme
      if (event.data?.type === 'hypercanvas:getTheme') {
        // nosemgrep: wildcard-postmessage-configuration -- iframe communication, origin varies between SaaS and VS Code webview
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'hypercanvas:currentTheme', theme },
          '*'
        );
      }
    };

    // nosemgrep: insufficient-postmessage-origin-validation -- message type is validated; origin varies between SaaS and VS Code webview contexts
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onActiveFileChange, navigate, logout, setTheme, updateTheme, onOpenProjectSettings, theme]);

  // Handle iframe load
  const handleIframeLoad = useCallback(() => {
    setState('ready');
    onReady?.();
  }, [onReady]);

  // Handle iframe error
  const handleIframeError = useCallback(() => {
    setError('Failed to load IDE');
    setState('error');
    onError?.('Failed to load IDE');
  }, [onError]);

  // Render loading state
  if (state === 'starting') {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center h-full bg-background',
          className
        )}
      >
        <IconLoader2 className="w-8 h-8 animate-spin text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Starting code-server IDE...</p>
        <p className="text-xs text-muted-foreground mt-2">This may take a few minutes</p>
      </div>
    );
  }

  // Render error state
  if (state === 'error') {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center h-full bg-background',
          className
        )}
      >
        <IconAlertCircle className="w-8 h-8 text-destructive mb-4" />
        <p className="text-destructive mb-4">{error || 'Failed to start IDE'}</p>
        <Button onClick={restartIDE} variant="outline">
          <IconRefresh className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  // Render stopped state
  if (state === 'stopped') {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center h-full bg-background',
          className
        )}
      >
        <p className="text-muted-foreground mb-4">IDE is not running</p>
        <Button onClick={startIDE}>Start IDE</Button>
      </div>
    );
  }

  // Render IDE iframe (with loading overlay for 'loading' state)
  return (
    <div className={cn('relative h-full', className)}>
      {/* Loading overlay while iframe is loading */}
      {state === 'loading' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background">
          <IconLoader2 className="w-8 h-8 animate-spin text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Loading IDE...</p>
        </div>
      )}

      {/* IDE iframe */}
      <iframe
        ref={iframeRef}
        src={ideUrl || undefined}
        data-code-server
        title="code-server IDE"
        className="w-full h-full border-0 bg-[#1e1e1e]"
        onLoad={handleIframeLoad}
        onError={handleIframeError}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}

export default CodeServerIDE;
