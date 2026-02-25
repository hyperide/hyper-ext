import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { authFetch } from '@/utils/authFetch';
import type {
  GitHubAppInstallation,
  GitHubAppInstallationsResponse,
  GitHubAppStatusResponse,
  GitHubAppInstallUrlResponse,
} from '../types';

interface UseGitHubAppInstallationsResult {
  installations: GitHubAppInstallation[];
  loading: boolean;
  error: string | null;
  configured: boolean;
  refetch: () => Promise<void>;
  removeInstallation: (installationId: number) => Promise<boolean>;
  getInstallUrl: () => Promise<string | null>;
}

export function useGitHubAppInstallations(): UseGitHubAppInstallationsResult {
  const [installations, setInstallations] = useState<GitHubAppInstallation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const { accessToken, isLoading: authLoading } = useAuthStore();

  const fetchStatus = useCallback(async () => {
    try {
      const response = await authFetch('/api/github-app/status');
      if (response.ok) {
        const data: GitHubAppStatusResponse = await response.json();
        setConfigured(data.configured);
        return data.configured;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const fetchInstallations = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await authFetch('/api/github-app/installations');

      if (!response.ok) {
        if (response.status === 401) {
          setError('Session expired. Please refresh the page.');
        } else if (response.status === 503) {
          setError('GitHub App is not configured');
        } else {
          setError('Failed to fetch installations');
        }
        return;
      }

      const data: GitHubAppInstallationsResponse = await response.json();
      setInstallations(data.installations);
    } catch {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  }, []);

  const refetch = useCallback(async () => {
    // Don't fetch while auth is still loading
    if (authLoading) {
      return;
    }
    if (!accessToken) {
      setLoading(false);
      return;
    }
    const isConfigured = await fetchStatus();
    if (isConfigured) {
      await fetchInstallations();
    } else {
      setLoading(false);
    }
  }, [fetchStatus, fetchInstallations, authLoading, accessToken]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const removeInstallation = useCallback(async (installationId: number): Promise<boolean> => {
    try {
      const response = await authFetch(`/api/github-app/installations/${installationId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setInstallations((prev) =>
          prev.filter((inst) => inst.installationId !== installationId)
        );
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const getInstallUrl = useCallback(async (): Promise<string | null> => {
    try {
      const response = await authFetch('/api/github-app/install-url');
      if (response.ok) {
        const data: GitHubAppInstallUrlResponse = await response.json();
        return data.url;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  return {
    installations,
    loading,
    error,
    configured,
    refetch,
    removeInstallation,
    getInstallUrl,
  };
}
