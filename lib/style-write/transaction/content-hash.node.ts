/**
 * @file Node default content hasher for the B0 CAS guard (master spec §9.1 step 5, HYP-722 T1a)
 *
 * Accessed via: the Node transaction entry (`run-style-write-transaction.ts` / the host realms that
 *   run on Node — server-backed SaaS, the VS Code extension host). NOT imported by the browser-safe
 *   barrel (`index.ts`) — that path keeps `node:crypto` out of the serverless/OPFS bundle.
 * Assumptions: Node runtime (`node:crypto` available). A non-Node realm injects its own hasher of the
 *   same `ContentHasher` shape (e.g. SubtleCrypto in a Worker).
 */
import { createHash } from 'node:crypto';
import type { ContentHasher } from './content-hash';
import type { ContentHash } from './types';

/** SHA-256 of the UTF-8 bytes of `content`, hex-encoded. The Node-realm default CAS hasher. */
export const hashContent: ContentHasher = (content: string): ContentHash =>
  createHash('sha256').update(content, 'utf8').digest('hex') as ContentHash;
