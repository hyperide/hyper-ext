/**
 * Unified connection status store
 *
 * Aggregates three signals (online, auth, sse) into a single derived status.
 * Runs exponential backoff with HEAD /api/ping health checks.
 * On recovery: refreshes auth, dispatches 'connection:recovered' for SSE reconnect.
 */

import { create } from 'zustand';
import { useAuthStore } from './authStore';
import { useNetworkStore } from './networkStore';

export type ConnectionSignal = 'online' | 'auth' | 'sse';
export type ConnectionStatus = 'connected' | 'offline' | 'reconnecting' | 'unavailable';

interface ConnectionState {
  signals: Record<ConnectionSignal, boolean>;
  status: ConnectionStatus;
  backoffMs: number;

  reportSignal: (signal: ConnectionSignal, connected: boolean) => void;
  retryNow: () => void;

  /** Internal — starts subscriptions & backoff loop. Returns cleanup. */
  _start: () => () => void;
}

const BASE_DELAY = 2000;
const MAX_DELAY = 300_000; // 5 min

function deriveStatus(signals: Record<ConnectionSignal, boolean>): ConnectionStatus {
  if (!signals.online) return 'offline';
  if (signals.online && signals.auth && signals.sse) return 'connected';
  return 'reconnecting';
}

export const useConnectionStore = create<ConnectionState>()((set, get) => {
  let backoffTimer: ReturnType<typeof setTimeout> | null = null;
  let pingInterval: ReturnType<typeof setInterval> | null = null;

  function clearTimers() {
    if (backoffTimer) {
      clearTimeout(backoffTimer);
      backoffTimer = null;
    }
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  }

  async function healthCheck() {
    const { signals } = get();
    if (signals.online && signals.auth && signals.sse) return; // already fine

    try {
      const res = await fetch('/api/ping', { method: 'HEAD' });
      if (!res.ok) throw new Error('ping failed');

      console.log('[Connection] Health check passed, recovering auth...');
      const authOk = await useAuthStore.getState().checkAuth({ isRetry: true });

      if (authOk) {
        // reportSignal will dispatch connection:recovered if auth was down
        get().reportSignal('auth', true);
      }
    } catch {
      console.log('[Connection] Health check failed');
    }
  }

  function scheduleBackoff() {
    clearTimers();
    const { signals, backoffMs } = get();

    // All good — nothing to schedule
    if (signals.online && signals.auth && signals.sse) return;
    // Offline — wait for browser online event, don't burn retries
    if (!signals.online) return;

    if (backoffMs >= MAX_DELAY) {
      // Cap reached — switch to unavailable + periodic ping
      set({ status: 'unavailable' });
      pingInterval = setInterval(healthCheck, MAX_DELAY);
      return;
    }

    backoffTimer = setTimeout(async () => {
      await healthCheck();

      const { signals: current } = get();
      if (!(current.online && current.auth && current.sse)) {
        // Still broken — escalate backoff
        const nextDelay = Math.min(get().backoffMs * 2, MAX_DELAY);
        set({ backoffMs: nextDelay });
        scheduleBackoff();
      }
    }, backoffMs);
  }

  function updateStatus() {
    const { signals, status: oldStatus } = get();
    const newStatus = deriveStatus(signals);
    const wasDisconnected = oldStatus !== 'connected';
    const nowConnected = newStatus === 'connected';

    set({ status: newStatus });

    if (nowConnected && wasDisconnected) {
      // Fully recovered — reset backoff, clear timers
      clearTimers();
      set({ backoffMs: BASE_DELAY });
      console.log('[Connection] All signals connected');
    } else if (!nowConnected && oldStatus === 'connected') {
      // Just went down — start backoff
      set({ backoffMs: BASE_DELAY });
      scheduleBackoff();
    }
  }

  return {
    signals: { online: true, auth: true, sse: true },
    status: 'connected',
    backoffMs: BASE_DELAY,

    reportSignal: (signal, connected) => {
      const { signals } = get();
      if (signals[signal] === connected) return;

      const wasAuthDown = !signals.auth;
      set({ signals: { ...signals, [signal]: connected } });
      updateStatus();

      // Auth recovered (from any source) → tell SSE to reconnect immediately
      if (signal === 'auth' && connected && wasAuthDown) {
        console.log('[Connection] Auth signal recovered, dispatching connection:recovered');
        window.dispatchEvent(new CustomEvent('connection:recovered'));
      }
    },

    retryNow: () => {
      clearTimers();
      set({ backoffMs: BASE_DELAY, status: 'reconnecting' });
      healthCheck().then(() => {
        const { signals } = get();
        if (!(signals.online && signals.auth && signals.sse)) {
          scheduleBackoff();
        }
      });
    },

    _start: () => {
      // Subscribe to networkStore (outside React)
      const unsubNetwork = useNetworkStore.subscribe((state) => {
        get().reportSignal('online', state.isOnline);

        if (state.isOnline) {
          // Came online — reset backoff and try immediately
          clearTimers();
          set({ backoffMs: BASE_DELAY });
          healthCheck().then(() => {
            const { signals } = get();
            if (!(signals.online && signals.auth && signals.sse)) {
              scheduleBackoff();
            }
          });
        }
      });

      // Subscribe to authStore.connectionError (outside React)
      const unsubAuth = useAuthStore.subscribe((state) => {
        get().reportSignal('auth', !state.connectionError);
      });

      // Visibility change — try immediately on tab focus
      const handleVisibility = () => {
        if (document.visibilityState === 'visible') {
          const { status } = get();
          if (status !== 'connected') {
            clearTimers();
            set({ backoffMs: BASE_DELAY });
            healthCheck().then(() => {
              const { signals } = get();
              if (!(signals.online && signals.auth && signals.sse)) {
                scheduleBackoff();
              }
            });
          }
        }
      };
      document.addEventListener('visibilitychange', handleVisibility);

      // Sync initial state
      get().reportSignal('online', useNetworkStore.getState().isOnline);
      get().reportSignal('auth', !useAuthStore.getState().connectionError);

      return () => {
        unsubNetwork();
        unsubAuth();
        document.removeEventListener('visibilitychange', handleVisibility);
        clearTimers();
      };
    },
  };
});
