import { useState, useEffect, useCallback } from "react";
import { useAuthStore } from "@/stores/authStore";
import { authFetch } from "@/utils/authFetch";
import type {
  GitHubOrganization,
  GitHubUser,
  OrganizationsResponse,
} from "../types";

interface UseGitHubOrganizationsResult {
  organizations: GitHubOrganization[];
  user: GitHubUser | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useGitHubOrganizations(): UseGitHubOrganizationsResult {
  const [organizations, setOrganizations] = useState<GitHubOrganization[]>([]);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { accessToken } = useAuthStore();

  const fetchOrganizations = useCallback(async () => {
    if (!accessToken) {
      setError("Not authenticated");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await authFetch("/api/github/organizations");

      if (!response.ok) {
        if (response.status === 401) {
          setError("Not authenticated with GitHub");
          return;
        }
        throw new Error("Failed to fetch organizations");
      }

      const data: OrganizationsResponse = await response.json();
      setOrganizations(data.organizations);
      setUser(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchOrganizations();
  }, [fetchOrganizations]);

  return {
    organizations,
    user,
    loading,
    error,
    refetch: fetchOrganizations,
  };
}
