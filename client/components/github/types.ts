export interface GitHubUser {
  login: string;
  avatar_url: string;
  name?: string | null;
  email?: string | null;
}

export interface GitHubOrganization {
  id: number;
  login: string;
  avatar_url: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  private: boolean;
  description: string | null;
  default_branch: string;
  owner: {
    login: string;
    avatar_url: string;
    type: 'User' | 'Organization';
  };
  created_at?: string;
  updated_at?: string;
}

export interface GitHubSettings {
  lastSelectedOrg: string | null;
  defaultCreateOrg: string | null;
}

export interface OrganizationsResponse {
  organizations: GitHubOrganization[];
  user: GitHubUser;
}

export interface RepositoriesResponse {
  repositories: GitHubRepository[];
  hasMore: boolean;
  totalCount?: number;
  existingProjectIds: Record<string, string>;
}

export interface CreateRepoData {
  name: string;
  description?: string;
  isPrivate: boolean;
  org?: string;
}

// GitHub App Installation types
export interface GitHubAppInstallation {
  id: string;
  installationId: number;
  accountLogin: string;
  accountType: 'User' | 'Organization';
  accountId: number;
  repositorySelection: 'all' | 'selected';
  permissions: Record<string, string>;
  suspendedAt: string | null;
  repositoryCount: number | null;
  suspended: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubAppInstallationsResponse {
  installations: GitHubAppInstallation[];
}

export interface GitHubAppStatusResponse {
  configured: boolean;
}

export interface GitHubAppInstallUrlResponse {
  url: string;
}
