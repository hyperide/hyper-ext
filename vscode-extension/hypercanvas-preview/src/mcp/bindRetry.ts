/**
 * Bounded-retry classification for HyperMcpServer's loopback bind (HYP-954).
 *
 * Extracted from HyperMcpServer so the retry POLICY — which errno codes are worth
 * retrying, and the backoff schedule — is unit-testable in isolation, without
 * spinning up a real net.Server or racing real timers.
 *
 * Why classify at all instead of retrying everything: EACCES/EPERM (permission
 * denied — e.g. a local firewall/AV/sandbox refusing the loopback bind, the
 * dominant real-world cause per HYP-954's analysis) and any unclassified error
 * are not transient; retrying just delays the actionable failure toast. Only
 * EADDRINUSE/EAGAIN/ECONNRESET are worth a few bounded attempts.
 */

const RETRYABLE_CODES = new Set(['EADDRINUSE', 'EAGAIN', 'ECONNRESET']);

/** Backoff between successive bind attempts. 3 values -> up to 4 total attempts
 *  (1 initial + 3 retries), per HYP-954's acceptance criteria. */
export const BIND_RETRY_BACKOFFS_MS = [250, 500, 1000] as const;

export function isRetryableBindError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code !== undefined && RETRYABLE_CODES.has(code);
}

/** +/-20% jitter so multiple windows retrying the same transient condition at once
 *  don't all re-attempt in lockstep. */
export function withJitter(baseMs: number): number {
  const jitter = baseMs * 0.2 * (Math.random() * 2 - 1);
  return Math.max(0, baseMs + jitter);
}
