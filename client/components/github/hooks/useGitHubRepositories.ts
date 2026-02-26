import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { authFetch } from '@/utils/authFetch';
import type { GitHubRepository, RepositoriesResponse } from '../types';

interface UseGitHubRepositoriesOptions {
  org?: string | null;
  search?: string;
  perPage?: number;
  enabled?: boolean;
  sort?: 'name' | 'created' | 'updated';
}

interface UseGitHubRepositoriesResult {
  repositories: GitHubRepository[];
  existingProjectIds: Record<string, string>;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  totalCount?: number;
  page: number;
  loadMore: () => void;
  refetch: () => Promise<void>;
}

export function useGitHubRepositories(options: UseGitHubRepositoriesOptions = {}): UseGitHubRepositoriesResult {
  const { org, search, perPage = 20, enabled = true, sort = 'name' } = options;

  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [existingProjectIds, setExistingProjectIds] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | undefined>();
  const [page, setPage] = useState(1);
  const { accessToken } = useAuthStore();

  // Track previous values to detect changes
  const prevOrgRef = useRef(org);
  const prevSearchRef = useRef(search);
  const hasFetchedRef = useRef(false);

  const fetchRepositories = useCallback(
    async (pageNum: number, append: boolean = false) => {
      if (!enabled || !accessToken) return;

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (org) params.set('org', org);
        if (search) params.set('search', search);
        params.set('page', pageNum.toString());
        params.set('perPage', perPage.toString());
        if (sort) params.set('sort', sort);

        const response = await authFetch(`/api/github/repositories?${params}`);

        if (!response.ok) {
          if (response.status === 401) {
            setError('Not authenticated with GitHub');
            return;
          }
          throw new Error('Failed to fetch repositories');
        }

        const data: RepositoriesResponse = await response.json();

        if (append) {
          setRepositories((prev) => [...prev, ...data.repositories]);
        } else {
          setRepositories(data.repositories);
        }

        setExistingProjectIds(data.existingProjectIds);
        setHasMore(data.hasMore);
        setTotalCount(data.totalCount);
        setPage(pageNum);
        hasFetchedRef.current = true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    },
    [org, search, perPage, enabled, accessToken, sort],
  );

  // Reset and fetch when org or search changes
  useEffect(() => {
    if (prevOrgRef.current !== org || prevSearchRef.current !== search) {
      prevOrgRef.current = org;
      prevSearchRef.current = search;
      setRepositories([]);
      setPage(1);
      // Mark as fetched to prevent the initial-fetch effect from double-firing
      hasFetchedRef.current = true;
      fetchRepositories(1, false);
    }
  }, [org, search, fetchRepositories]);

  // Initial fetch
  useEffect(() => {
    if (enabled && accessToken && !hasFetchedRef.current && !loading && !error) {
      fetchRepositories(1, false);
    }
  }, [enabled, accessToken, loading, error, fetchRepositories]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchRepositories(page + 1, true);
    }
  }, [loading, hasMore, page, fetchRepositories]);

  const refetch = useCallback(async () => {
    setRepositories([]);
    setPage(1);
    await fetchRepositories(1, false);
  }, [fetchRepositories]);

  return {
    repositories,
    existingProjectIds,
    loading,
    error,
    hasMore,
    totalCount,
    page,
    loadMore,
    refetch,
  };
}
