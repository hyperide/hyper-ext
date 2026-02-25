import { IconBrandGithub } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/utils/authFetch';

interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string | null;
}

interface GitHubAuthButtonProps {
  onAuthChange?: (authenticated: boolean) => void;
}

export default function GitHubAuthButton({ onAuthChange }: GitHubAuthButtonProps) {
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuthStatus = useCallback(async () => {
    setLoading(true);

    try {
      // authFetch handles token refresh automatically on 401
      const response = await authFetch('/api/github/user');

      if (!response.ok) {
        // GitHub token expired or invalid - user needs to re-authenticate with GitHub
        setUser(null);
        onAuthChange?.(false);
        return;
      }

      const data = await response.json();
      if (data.authenticated && data.user) {
        setUser(data.user);
        onAuthChange?.(true);
      } else {
        setUser(null);
        onAuthChange?.(false);
      }
    } catch (error) {
      console.error('[GitHubAuthButton] Error checking auth status:', error);
      setUser(null);
      onAuthChange?.(false);
    } finally {
      setLoading(false);
    }
  }, [onAuthChange]);

  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  // Re-check auth when window regains focus (token may have refreshed or expired)
  useEffect(() => {
    const handleFocus = () => {
      checkAuthStatus();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [checkAuthStatus]);

  const handleConnect = () => {
    // Save current location for redirect after OAuth
    sessionStorage.setItem('auth_redirect', window.location.pathname + window.location.search);

    // Redirect to GitHub OAuth (will link account if same email)
    window.location.href = '/api/auth/github';
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-gray-500">
        <IconBrandGithub className="w-4 h-4" />
        <span>Checking...</span>
      </div>
    );
  }

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <img src={user.avatar_url} alt={user.login} className="w-6 h-6 rounded-full" />
        <span className="text-sm font-medium">{user.name || user.login}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleConnect}
      className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-md hover:bg-gray-800 text-sm font-medium"
    >
      <IconBrandGithub className="w-4 h-4" />
      Connect GitHub
    </button>
  );
}
