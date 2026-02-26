# Server Disconnection & Reconnection State Management

## Current Implementation Summary

### 1. Core Infrastructure

#### Network Store (`client/stores/networkStore.ts`)
- **Purpose**: Tracks browser online/offline state using `navigator.onLine`
- **Key exports**:
  - `useNetworkStore`: Zustand store with `isOnline` boolean state
  - `useIsOnline()`: Hook to access current online state
  - `useOnReconnect(callback)`: Hook that fires callback when transitioning from offline → online
- **Events monitored**: `window.online` and `window.offline` events
- **Behavior**: Stores browser's reported online state, provides hooks for reacting to reconnection

#### Auth Store (`client/stores/authStore.ts`)
- **Connection state fields**:
  - `connectionError: boolean` - Set when server is unreachable (transient issue)
  - `connectionRetryCount: number` - Incremented on each retry attempt
  - `sessionExpired: boolean` - Set for hard auth failures (token invalid/revoked)
- **Retry logic**:
  - `retryConnection()`: Increments retry count and calls `checkAuth()`
  - `resetConnectionRetries()`: Resets count to 0
  - `checkAuth()`: Performs auth validation with network error handling
  - Uses exponential backoff: 500ms, 1000ms, 2000ms (built-in)
- **Error discrimination**:
  - Network/Server errors (500+, NETWORK_ERROR): Sets `connectionError: true` (soft error)
  - Auth errors (TOKEN_INVALID, REVOKED, etc.): Sets `sessionExpired: true` (hard error)
  - Never logged in: Clears state silently (no UI)

#### Protected Route (`client/components/ProtectedRoute.tsx`)
- **Connection error UI**: Fixed position top-right corner badge
  - When offline: Shows "Offline" with pulsing amber indicator
  - When reconnecting: Shows "Reconnecting... (N/MAX_RETRIES)" with pulsing indicator
  - When exhausted: Shows "Server Unavailable" with red indicator + Manual Retry button
- **Retry strategy**: 
  - MAX_RETRIES = 3
  - RETRY_DELAYS = [2000, 5000, 10000] ms
  - Auto-retries scheduled based on attempt count
  - Resets on `navigator.online` event or tab visibility change
  - Manual retry available when exhausted
- **Content**: Still renders children while showing connection error (non-blocking)

### 2. SSE-based Reconnection

#### EventSource Hook (`client/hooks/useReconnectingEventSource.ts`)
- **Status states**: `'connected' | 'disconnected' | 'reconnecting'`
- **Reconnection triggers**:
  1. Auto-reconnect with exponential backoff on error (up to maxReconnectAttempts = 10)
  2. Tab becomes visible (document.visibilitychange event)
  3. Browser comes online (window.online event)
- **Exponential backoff**: baseDelay=1000ms × 2^attempt, max 30000ms with jitter
- **Features**:
  - Resets attempt counter when manual/visibility/network reconnect is triggered
  - Checks `navigator.onLine` before attempting connection
  - Callbacks: onOpen, onMessage, onError, onStatusChange
  - Automatic cleanup on unmount

#### Project SSE Hook (`client/pages/Editor/components/hooks/useProjectSSE.ts`)
- **Subscriptions**: 
  - Project stream: Receives project status updates
  - File watcher: Detects file changes
- **Status tracking**:
  - Returns `sseStatus` object with `projectStream` and `fileWatcher` states
  - Returns `isOnline` boolean from browser
  - Returns `pollStatus` for fallback polling when SSE fails
- **Fallback polling**: When SSE doesn't deliver data within 2s, polls `/api/docker/status/{projectId}` every 5s
- **Local online tracking**: Duplicates browser online/offline events for UI badge

### 3. UI Status Indicators

#### Canvas Editor Badge (`client/pages/Editor/CanvasEditor.tsx`)
- **Location**: Top-right corner of canvas area
- **Display conditions**:
  ```tsx
  {(!isOnline ||
    sseStatus.projectStream !== 'connected' ||
    sseStatus.fileWatcher !== 'connected') && (
    <Badge variant="destructive" className="animate-pulse">
      <IconCloudOff className="w-3 h-3" />
      <span>{!isOnline ? 'Offline' : 'Reconnecting...'}</span>
    </Badge>
  )}
  ```
- **Status text**:
  - "Offline" when browser is offline
  - "Reconnecting..." when either SSE connection is down
- **Styling**: Pulsing red destructive badge with cloud-off icon

#### Network Status Indicator Component (`client/components/NetworkStatusIndicator.tsx`)
- **Three variants**:
  1. `badge`: Small pill (e.g., in headers)
  2. `banner`: Full-width warning with optional retry button
  3. `inline`: Small inline text
- **Messages**:
  - Offline: "No internet connection" + "Check your network settings"
  - Server error: "Failed to connect to server" + "Will retry automatically when connection is restored"
- **Icon**: Wifi-off icon from @tabler/icons-react
- **Styling**: Amber color (warning) with dark mode support

### 4. Network-Aware Data Hooks

#### useNetworkAwareFetch (`client/hooks/useNetworkAwareFetch.ts`)
- **Features**:
  - Distinguishes network errors from server errors
  - Optional auto-retry on reconnect (`autoRetryOnReconnect` option)
  - Preserves stale data on network error (`keepDataOnNetworkError` option)
  - Uses `useOnReconnect()` for auto-retry trigger
- **Return value**:
  - `data`: Last fetched data
  - `error`: Error message
  - `isNetworkError`: Boolean flag
  - `isOffline`: Current offline state
  - `isLoading`: Loading flag
  - `refetch()`: Manual retry function

#### useNetworkAwarePolling (`client/hooks/useNetworkAwarePolling.ts`)
- **Key principle**: NEVER replaces data on error - only changes error state
- **Features**:
  - Pauses polling when offline
  - Auto-resumes polling when online
  - Preserves last successful data during network hiccups
  - Uses `useOnReconnect()` to trigger immediate poll on reconnection
- **Return value**: Same as useNetworkAwareFetch plus `poll()` and `clearError()`

### 5. Network Error Detection

#### networkError.ts (`client/utils/networkError.ts`)
- **Custom NetworkError class**: Explicit error type for network failures
- **Detection logic** checks for:
  - Custom NetworkError instances
  - TypeError with "failed to fetch", "network", "networkerror", "connection refused", "load failed", "cancelled"
  - DOMException with AbortError or NetworkError
  - Error message containing "network", "offline", or "fetch"
- **Helper functions**:
  - `isNetworkError(error)`: Detection utility
  - `wrapNetworkError(error)`: Wraps fetch errors as NetworkError

## Key Data Flows

### 1. Authentication Recovery on Network Error
```
User is authenticated → Network error occurs → connectionError set to true
→ ProtectedRoute shows top-right badge → Auto-retry on schedule OR online event
→ retryConnection() calls checkAuth() → Success: connectionError cleared, children render
→ Failure: Stays in retry loop or shows exhausted state
```

### 2. SSE Reconnection
```
SSE connection error → status changes to 'reconnecting'
→ Exponential backoff timer started
→ On error retry: attempt counter incremented
→ On visibility/online event: attempt counter reset, immediate reconnection attempted
→ On success: status changes to 'connected', attempt counter reset
```

### 3. Data Fetching During Network Issues
```
useNetworkAwareFetch tries to fetch → Network error detected
→ isNetworkError flag set, data preserved (if keepDataOnNetworkError: true)
→ User comes online OR manual refetch
→ useOnReconnect callback fires → fetch retried if autoRetryOnReconnect: true
```

## Key Files to Review

1. **Connection State Stores**:
   - `/Users/ultra/work/hyper-canvas-draft/client/stores/networkStore.ts`
   - `/Users/ultra/work/hyper-canvas-draft/client/stores/authStore.ts`

2. **UI Components**:
   - `/Users/ultra/work/hyper-canvas-draft/client/components/ProtectedRoute.tsx`
   - `/Users/ultra/work/hyper-canvas-draft/client/components/NetworkStatusIndicator.tsx`
   - `/Users/ultra/work/hyper-canvas-draft/client/pages/Editor/CanvasEditor.tsx` (line ~1053)

3. **SSE/EventSource**:
   - `/Users/ultra/work/hyper-canvas-draft/client/hooks/useReconnectingEventSource.ts`
   - `/Users/ultra/work/hyper-canvas-draft/client/pages/Editor/components/hooks/useProjectSSE.ts`

4. **Data Fetching Hooks**:
   - `/Users/ultra/work/hyper-canvas-draft/client/hooks/useNetworkAwareFetch.ts`
   - `/Users/ultra/work/hyper-canvas-draft/client/hooks/useNetworkAwarePolling.ts`

5. **Utilities**:
   - `/Users/ultra/work/hyper-canvas-draft/client/utils/networkError.ts`
   - `/Users/ultra/work/hyper-canvas-draft/client/utils/authFetch.ts`

## Notes

- Dual tracking of online state: browser `navigator.onLine` AND local store
- Three retry/reconnection mechanisms working together:
  1. Auth store: Explicit checkAuth() retries with finite attempts (MAX_RETRIES=3)
  2. SSE hook: Exponential backoff with unlimited attempts (maxReconnectAttempts=10)
  3. Network-aware hooks: Optional auto-retry on reconnect signal
- Tab visibility and online events reset retry counters to enable immediate reconnection
- No WebSocket implementation visible - only EventSource (SSE) for real-time updates
