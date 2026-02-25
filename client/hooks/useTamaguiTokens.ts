import { useEffect, useState } from 'react';
import { authFetch } from '@/utils/authFetch';

interface TamaguiTokens {
  color: string[];
  size: string[];
  space: string[];
}

const DEFAULT_TOKENS: TamaguiTokens = {
  color: [],
  size: [],
  space: [],
};

/**
 * Hook to fetch Tamagui design tokens from the active project
 */
export function useTamaguiTokens() {
  const [tokens, setTokens] = useState<TamaguiTokens>(DEFAULT_TOKENS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchTokens() {
      try {
        setLoading(true);
        setError(null);

        const response = await authFetch('/api/tamagui/tokens');
        const data = await response.json();

        if (cancelled) return;

        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to fetch tokens');
        }

        setTokens(data.tokens);
      } catch (err) {
        if (cancelled) return;

        console.error('Failed to fetch Tamagui tokens:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        // Keep default empty tokens on error
        setTokens(DEFAULT_TOKENS);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchTokens();

    return () => {
      cancelled = true;
    };
  }, []);

  return { tokens, loading, error };
}
