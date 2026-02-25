/**
 * Network error handling utilities
 *
 * Provides a custom NetworkError class and detection utilities
 * for distinguishing network failures from other errors.
 */

/**
 * Custom error class for network-related failures.
 * Use this when you want to explicitly mark an error as network-related.
 */
export class NetworkError extends Error {
  constructor(message = 'Network request failed', public originalError?: unknown) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Detects if an error is a network failure.
 *
 * Network errors typically occur when:
 * - User is offline
 * - Server is unreachable
 * - DNS resolution fails
 * - Connection times out
 * - CORS blocks the request (in some browsers)
 *
 * @param error - The error to check
 * @returns true if the error is likely a network failure
 */
export function isNetworkError(error: unknown): boolean {
  // Explicit NetworkError
  if (error instanceof NetworkError) {
    return true;
  }

  // TypeError from fetch when network fails
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('failed to fetch') ||
      msg.includes('network') ||
      msg.includes('networkerror') ||
      msg.includes('connection refused') ||
      msg.includes('load failed') || // Safari
      msg.includes('cancelled') // Safari on network change
    );
  }

  // DOMException for aborted requests (timeout/network)
  if (error instanceof DOMException) {
    return error.name === 'AbortError' || error.name === 'NetworkError';
  }

  // Check error message string
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('network') || msg.includes('offline') || msg.includes('fetch');
  }

  return false;
}

/**
 * Wraps fetch errors into NetworkError if applicable.
 *
 * Usage:
 * ```ts
 * const response = await fetch(url).catch(wrapNetworkError);
 * ```
 */
export function wrapNetworkError(error: unknown): never {
  if (isNetworkError(error)) {
    throw new NetworkError('Network request failed', error);
  }
  throw error;
}
