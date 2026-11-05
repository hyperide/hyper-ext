import { rateAddress } from '../server/network-identity.mjs';
import { createHmac } from 'node:crypto';
import { Pool } from 'pg';
import { createMeasurementRepository } from '../server/measurement-repository.mjs';
let repository;
async function readBody(request) {
  const maximum = 32768;
  if (Number(request.headers['content-length'] ?? 0) > maximum)
    throw Object.assign(Error('Request is too large'), { status: 413 });
  if (request.body !== undefined) {
    const text = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
    if (Buffer.byteLength(text) > maximum) throw Object.assign(Error('Request is too large'), { status: 413 });
    return JSON.parse(text);
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) throw Object.assign(Error('Request is too large'), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export default async function measurements(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const send = (status, value) => {
    response.statusCode = status;
    response.end(JSON.stringify(value));
  };
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST');
    return send(405, { error: 'Method not allowed' });
  }
  const database = process.env.STATE_MEASUREMENTS_DATABASE_URL;
  const origin = process.env.STATE_MEASUREMENTS_ORIGIN,
    salt = process.env.STATE_MEASUREMENTS_RATE_SECRET;
  if (!database || !origin || !salt || salt.length < 32)
    return send(503, { error: 'Sharing is temporarily unavailable' });
  if (request.headers.origin && request.headers.origin !== origin) return send(403, { error: 'Origin not allowed' });
  if (request.method === 'POST' && request.headers.origin !== origin) return send(403, { error: 'Origin required' });
  if (!repository) {
    const pool = new Pool({
      connectionString: database,
      max: 2,
      connectionTimeoutMillis: 4000,
      idleTimeoutMillis: 10000,
      statement_timeout: 4000,
    });
    // pg-pool drops a failed idle client itself; without a listener its 'error' event would crash the function.
    pool.on('error', (error) => console.error('measurement pool: idle client failed', error.message));
    repository = createMeasurementRepository(pool);
  }
  try {
    if (request.method === 'GET') {
      const url = new URL(request.url, origin);
      const records = await repository.recent(url.searchParams.get('example'), url.searchParams.get('source'));
      return send(200, { records, trust: 'visitor' });
    }
    if (!String(request.headers['content-type'] ?? '').startsWith('application/json'))
      return send(415, { error: 'Expected JSON' });
    const address = rateAddress(request, process.env.VERCEL === '1');
    const rateKey = createHmac('sha256', salt).update(address).digest('hex');
    const result = await repository.record(await readBody(request), rateKey);
    return send(200, result);
  } catch (error) {
    const status = error?.status ?? error?.statusCode ?? (error instanceof TypeError || error instanceof SyntaxError ? 400 : 503);
    return send(status, {
      error:
        status === 503
          ? 'Sharing is temporarily unavailable'
          : status === 429
            ? 'Please wait before sharing another run'
            : status === 413
              ? 'Request is too large'
              : 'Invalid measurement',
    });
  }
}
