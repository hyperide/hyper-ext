/** Trust only the active platform's transport metadata, not arbitrary proxy headers.
 * Vercel: https://vercel.com/docs/headers/request-headers
 * Outside Vercel, clients cannot replace the connected socket's peer address.
 */
export function rateAddress(request, onVercel) {
  const value = onVercel ? request.headers['x-vercel-forwarded-for'] : request.socket?.remoteAddress;
  return typeof value === 'string' && value ? value.split(',')[0].slice(0, 128) : 'unknown';
}
