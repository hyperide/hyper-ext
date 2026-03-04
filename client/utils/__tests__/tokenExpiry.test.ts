import { describe, expect, it, spyOn } from 'bun:test';
import { isTokenExpiringSoon } from '../tokenExpiry';

/** Build a fake JWT with the given payload. No real signature — we only decode payload. */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fakesig`;
}

function fakeJwtFromExp(secondsFromNow: number): string {
  const exp = Math.floor(Date.now() / 1000) + secondsFromNow;
  return fakeJwt({ exp, sub: 'user-1' });
}

describe('isTokenExpiringSoon', () => {
  it('returns false for null token', () => {
    expect(isTokenExpiringSoon(null)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isTokenExpiringSoon('')).toBe(false);
  });

  it('returns false for malformed token (not 3 parts)', () => {
    expect(isTokenExpiringSoon('not-a-jwt')).toBe(false);
    expect(isTokenExpiringSoon('two.parts')).toBe(false);
  });

  it('returns false for invalid base64 payload', () => {
    expect(isTokenExpiringSoon('a.!!!invalid!!!.c')).toBe(false);
  });

  it('returns false for valid base64 but non-JSON payload', () => {
    const notJson = `a.${btoa('this is not json')}.c`;
    expect(isTokenExpiringSoon(notJson)).toBe(false);
  });

  it('returns false when payload has no exp claim', () => {
    expect(isTokenExpiringSoon(fakeJwt({ sub: 'user-1' }))).toBe(false);
  });

  it('returns false when exp is not a number', () => {
    expect(isTokenExpiringSoon(fakeJwt({ exp: 'not-a-number' }))).toBe(false);
  });

  it('returns true when token is already expired', () => {
    expect(isTokenExpiringSoon(fakeJwtFromExp(-10))).toBe(true);
  });

  it('returns true when token expires within 60 seconds', () => {
    expect(isTokenExpiringSoon(fakeJwtFromExp(30))).toBe(true);
  });

  it('returns true at exactly 59 seconds remaining', () => {
    expect(isTokenExpiringSoon(fakeJwtFromExp(59))).toBe(true);
  });

  it('returns false when token has plenty of time', () => {
    expect(isTokenExpiringSoon(fakeJwtFromExp(300))).toBe(false);
  });

  it('returns false at exactly 60 seconds remaining', () => {
    // Use spyOn(Date, 'now') to freeze time — avoids flake at second boundary
    const frozenMs = 1700000000_000; // arbitrary fixed timestamp
    const spy = spyOn(Date, 'now').mockReturnValue(frozenMs);
    const exp = Math.floor(frozenMs / 1000) + 60; // exactly 60s from frozen "now"
    const token = fakeJwt({ exp, sub: 'user-1' });
    // 60 - 60 = 0, which is NOT < 60, so false
    expect(isTokenExpiringSoon(token)).toBe(false);
    spy.mockRestore();
  });

  it('handles base64url characters (- and _)', () => {
    // Force payload with chars that produce + and / in standard base64
    // by using a payload with specific bytes. The function should handle base64url.
    const payload = { exp: Math.floor(Date.now() / 1000) + 10, data: '>>>???' };
    const header = btoa(JSON.stringify({ alg: 'HS256' }));
    const bodyStd = btoa(JSON.stringify(payload));
    // Convert to base64url
    const bodyUrl = bodyStd.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${header}.${bodyUrl}.sig`;
    expect(isTokenExpiringSoon(token)).toBe(true);
  });
});
