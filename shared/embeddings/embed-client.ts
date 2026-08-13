/**
 * @file Optional embedding client (HTTP wrapper, default backend BGE-M3).
 *
 * General-purpose reusable embedding client — NOT i18n-specific. Any semantic
 * feature (prop-name -> fake-data classification, locale-dir matching, etc.)
 * can construct one and degrade gracefully when the model is unavailable.
 *
 * Accessed via: Node hosts only (SaaS server & VS Code extension host) that
 *   want optional embeddings behind a pattern/heuristic fallback. Never
 *   constructed in the browser bundle.
 * Assumptions: the embed server is OPTIONAL. The client is health-gated and
 *   time-boxed; any failure (unreachable, non-200, malformed body, timeout)
 *   resolves to `null` rather than throwing, so callers degrade to their own
 *   fallback. No SDK — global `fetch` only (bun/Node ship it).
 *
 * Server contract (BAAI/bge-m3 Flask server, default :8080):
 *   GET  /health         -> { status: "ok" }
 *   POST /embed { texts } -> { embeddings: number[][] }   (MAX_BATCH_SIZE=32)
 */

/** Server-side default batch ceiling (MAX_BATCH_SIZE) — chunk requests to stay under it. */
const MAX_BATCH_SIZE = 32;
const DEFAULT_HEALTH_TIMEOUT_MS = 600;
const DEFAULT_EMBED_TIMEOUT_MS = 5000;

export interface EmbedClient {
  /**
   * Embed a list of texts. Returns L2-normalized dense vectors (one per text),
   * `[]` for empty input, or `null` if the model is unavailable / errored.
   * Never throws.
   */
  embed(texts: string[]): Promise<number[][] | null>;
}

export interface EmbedClientConfig {
  /** ms cap for the one-time GET /health probe. */
  healthTimeoutMs?: number;
  /** ms cap for each POST /embed request. */
  embedTimeoutMs?: number;
}

/** Strip trailing slashes so `${base}/embed` never doubles up. */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isNumberMatrix(value: unknown, expectedRows: number): value is number[][] {
  if (!Array.isArray(value) || value.length !== expectedRows) return false;
  return value.every((row) => Array.isArray(row) && row.length > 0 && row.every((n) => typeof n === 'number'));
}

/**
 * Build an embed client for `baseUrl` (e.g. `http://127.0.0.1:8080`). Returns
 * `null` when no usable base URL is given — i.e. embeddings are strictly opt-in
 * and the caller falls back to patterns. `globalThis.fetch` must exist
 * (it does in Node 18+/bun; absent in older/browser-stripped contexts).
 */
export function createEmbedClient(
  baseUrl: string | undefined | null,
  config: EmbedClientConfig = {},
): EmbedClient | null {
  if (!baseUrl || !baseUrl.trim()) return null;
  if (typeof fetch !== 'function') return null;

  const base = normalizeBaseUrl(baseUrl.trim());
  const healthTimeoutMs = config.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  const embedTimeoutMs = config.embedTimeoutMs ?? DEFAULT_EMBED_TIMEOUT_MS;

  // Cache the health verdict per client instance: a dead server stays dead for
  // this resolution; a live one is not re-probed on every batch.
  let healthy: boolean | null = null;

  async function probeHealth(): Promise<boolean> {
    if (healthy !== null) return healthy;
    try {
      const res = await fetchWithTimeout(`${base}/health`, { method: 'GET' }, healthTimeoutMs);
      healthy = res.ok;
    } catch {
      healthy = false;
    }
    return healthy;
  }

  async function embedBatch(texts: string[]): Promise<number[][] | null> {
    try {
      const res = await fetchWithTimeout(
        `${base}/embed`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ texts }),
        },
        embedTimeoutMs,
      );
      if (!res.ok) return null;
      const body = (await res.json()) as { embeddings?: unknown };
      if (!isNumberMatrix(body.embeddings, texts.length)) return null;
      return body.embeddings;
    } catch {
      return null;
    }
  }

  return {
    async embed(texts: string[]): Promise<number[][] | null> {
      if (texts.length === 0) return [];
      if (!(await probeHealth())) return null;

      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
        const chunk = texts.slice(i, i + MAX_BATCH_SIZE);
        const vecs = await embedBatch(chunk);
        if (vecs === null) return null;
        out.push(...vecs);
      }
      return out;
    },
  };
}
