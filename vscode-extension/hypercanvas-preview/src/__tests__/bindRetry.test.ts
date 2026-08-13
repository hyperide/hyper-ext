/**
 * @file HYP-954 — unit coverage for the bind-retry classification policy
 * (src/mcp/bindRetry.ts): which errno codes are worth a bounded retry, and the
 * jitter applied to the fixed backoff schedule. Kept separate from
 * HyperMcpServer-bind-retry.test.ts (the end-to-end retry-loop behavior) so the
 * classification rule itself is trivially testable without a mocked net.Server.
 */
import { describe, expect, it } from 'bun:test';
import { BIND_RETRY_BACKOFFS_MS, isRetryableBindError, withJitter } from '../mcp/bindRetry';

function errnoError(code: string): NodeJS.ErrnoException {
  const err = new Error(`simulated ${code}`) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe('isRetryableBindError', () => {
  it('retries EADDRINUSE, EAGAIN, ECONNRESET', () => {
    expect(isRetryableBindError(errnoError('EADDRINUSE'))).toBe(true);
    expect(isRetryableBindError(errnoError('EAGAIN'))).toBe(true);
    expect(isRetryableBindError(errnoError('ECONNRESET'))).toBe(true);
  });

  it('does NOT retry EACCES/EPERM — permission errors are not transient', () => {
    expect(isRetryableBindError(errnoError('EACCES'))).toBe(false);
    expect(isRetryableBindError(errnoError('EPERM'))).toBe(false);
  });

  it('does NOT retry an error with no errno code', () => {
    expect(isRetryableBindError(new Error('generic failure'))).toBe(false);
  });

  it('does NOT retry an unclassified/unknown errno code', () => {
    expect(isRetryableBindError(errnoError('ENOENT'))).toBe(false);
  });

  it('does NOT retry non-Error rejection values', () => {
    expect(isRetryableBindError('a plain string rejection')).toBe(false);
    expect(isRetryableBindError(undefined)).toBe(false);
  });
});

describe('BIND_RETRY_BACKOFFS_MS', () => {
  it('is the 250/500/1000 schedule the ticket specifies', () => {
    expect(BIND_RETRY_BACKOFFS_MS).toEqual([250, 500, 1000]);
  });
});

describe('withJitter', () => {
  it('stays within +/-20% of the base and never goes negative', () => {
    for (const base of BIND_RETRY_BACKOFFS_MS) {
      for (let i = 0; i < 50; i++) {
        const jittered = withJitter(base);
        expect(jittered).toBeGreaterThanOrEqual(0);
        expect(jittered).toBeGreaterThanOrEqual(base * 0.8);
        expect(jittered).toBeLessThanOrEqual(base * 1.2);
      }
    }
  });
});
