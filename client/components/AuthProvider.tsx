import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useNetworkStore } from '@/stores/networkStore';

interface AuthProviderProps {
  children: React.ReactNode;
}

export default function AuthProvider({ children }: AuthProviderProps) {
  const { checkAuth, _hasHydrated } = useAuthStore();

  // Initialize network status tracking (online/offline events)
  useEffect(() => {
    return useNetworkStore.getState()._initialize();
  }, []);

  // Initialize unified connection status (subscribes to network + auth stores)
  useEffect(() => {
    return useConnectionStore.getState()._start();
  }, []);

  useEffect(() => {
    // Wait for Zustand persist to hydrate accessToken from sessionStorage
    // before calling checkAuth() - this prevents race condition where
    // checkAuth() reads accessToken as null before hydration completes
    if (_hasHydrated) {
      checkAuth();
    }
  }, [_hasHydrated, checkAuth]);

  // Optional: Show loading state while checking auth
  // For now, we let the ProtectedRoute handle loading state
  // This allows public pages to render immediately

  return <>{children}</>;
}
