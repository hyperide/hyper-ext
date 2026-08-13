/**
 * @file Content-hasher TYPE for the B0 CAS guard (master spec §9.1 step 5, HYP-722 T1a)
 *
 * Accessed via: WriteTransaction (the injected `hasher`) and every realm that supplies one.
 * Assumptions: BROWSER-SAFE — this file has NO Node imports, so the shared `lib/` barrel (imported by
 *   the serverless/OPFS realm bundle) never pulls `node:crypto`. The default Node implementation lives
 *   in `content-hash.node.ts`; a browser/OPFS realm injects its own hasher (e.g. SubtleCrypto-backed).
 * Architecture: realms differ only in the transport beneath one shared contract (spec §9.1).
 */
import type { ContentHash } from './types';

/**
 * A content hasher — an equality witness for "is the on-disk content still the bytes we journaled".
 * It is NOT the §2.1 identity sourceHash (a git-blob hash); any collision-resistant content hash
 * satisfies the four-way CAS contract, so each realm supplies its own.
 */
export type ContentHasher = (content: string) => ContentHash;
