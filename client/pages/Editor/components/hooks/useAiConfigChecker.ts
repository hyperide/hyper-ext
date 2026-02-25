import { SetStateAction, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { authFetch } from '@/utils/authFetch';

export function useAiConfigChecker(
  setAiConfig: { (value: any): void; (arg0: null): void },
  setAiConfigChecked: (value: SetStateAction<boolean>) => void,
) {
  const { currentWorkspace } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (!currentWorkspace) {
      console.log('[Index] No workspace, skipping AI config check');
      setAiConfigChecked(true);
      return;
    }

    console.log('[Index] Checking AI config...');
    authFetch(`/api/ai-config?workspaceId=${currentWorkspace.id}`)
      .then((res) => {
        if (!res.ok) {
          if (res.status === 404) {
            // Config genuinely doesn't exist — redirect to setup
            console.log('[Index] No AI config found (404), redirecting to workspace settings');
            setAiConfig(null);
            navigate(`/workspaces/${currentWorkspace.slug}/settings`);
          } else {
            // Server error, auth error, etc. — don't redirect, skip check
            console.warn('[Index] AI config check failed with status:', res.status);
          }
          setAiConfigChecked(true);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data) {
          console.log('[Index] AI config loaded:', data);

          // Check if API key is set (check if apiKey exists and is not empty)
          if (!data.apiKey || data.apiKey === '' || data.apiKey === '...') {
            console.log('[Index] AI apiKey is not set, redirecting to workspace settings');
            setAiConfig(null);
            navigate(`/workspaces/${currentWorkspace.slug}/settings`);
          } else {
            setAiConfig(data);
          }
          setAiConfigChecked(true);
        }
      })
      .catch((err) => {
        // Network error — don't redirect to settings, just skip the check
        console.error('[Index] Failed to load AI config:', err);
        setAiConfigChecked(true);
      });
  }, [currentWorkspace, setAiConfig, setAiConfigChecked, navigate]);
}
