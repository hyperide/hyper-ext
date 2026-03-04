/**
 * JWT token expiry check for proactive refresh.
 * Decodes the payload without verifying the signature (client-side hint only).
 * The 401-retry fallback in authFetch handles any inaccuracy.
 */

const REFRESH_THRESHOLD_SECONDS = 60;

function decodeJwtPayload(token: string): { exp?: number } {
  const parts = token.split('.');
  if (parts.length !== 3) return {};

  const base64Url = parts[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const json = atob(base64);
  return JSON.parse(json);
}

/** Returns true when the token is expired or expires within 60 seconds. Null/empty tokens return false (nothing to refresh). */
export function isTokenExpiringSoon(token: string | null): boolean {
  if (!token) return false;

  try {
    const payload = decodeJwtPayload(token);
    if (typeof payload.exp !== 'number') return false;

    const nowSeconds = Math.floor(Date.now() / 1000);
    return payload.exp - nowSeconds < REFRESH_THRESHOLD_SECONDS;
  } catch {
    return false;
  }
}
