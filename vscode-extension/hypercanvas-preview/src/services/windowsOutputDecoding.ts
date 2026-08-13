/**
 * @file windowsOutputDecoding — decode dev-server child-process output that may be in
 * the Windows OEM code page instead of UTF-8 (HYP-1140 follow-up).
 *
 * Accessed via: DevServerManager's stdout/stderr `data` handlers, and the
 * dependency-repair (`npm install`) child process handlers in the same file.
 *
 * Why this exists: `child_process.spawn(..., { shell: true })` on win32 launches
 * `cmd.exe`. When output is piped (our `stdio: ['pipe','pipe','pipe']`, no attached
 * console), cmd.exe's OWN text — e.g. `'npm' is not recognized as an internal or
 * external command` (or the Russian equivalent on a Russian-locale box) — is emitted
 * in the system's OEM code page (cp866, cp1251, …), NOT UTF-8. A prior attempt at this
 * fix (`chcp 65001>nul&`, since removed) assumed `chcp` could force UTF-8 for piped
 * output — it cannot: `chcp` reprograms the ACTIVE CONSOLE code page, which does not
 * apply when there is no attached console. Decoding those bytes as UTF-8 (plain
 * `data.toString()`) produced the reported mojibake (`�` replacement characters).
 *
 * Strategy instead: detect the box's actual OEM code page once (via a standalone
 * `chcp` query, not chained into the dev-server command), and decode with iconv-lite
 * ONLY when a chunk of raw bytes is not valid UTF-8 to begin with — most dev-server
 * output (Vite, Next.js, npm's own JSON/progress lines) already IS UTF-8, so this never
 * touches the common case.
 *
 * Two-mode chunk-boundary safety (review, two passes): a raw `data` event is not
 * guaranteed to end on a character boundary, for EITHER UTF-8 or a double-byte (DBCS)
 * Windows OEM code page (cp932/936/949/950 — Japanese/Chinese/Korean). {@link
 * StreamOutputDecoder} only pays for safety where it's actually needed:
 *  - The COMMON case (any non-win32 platform, or win32 with no OEM decode possible —
 *    code page unknown or already UTF-8/65001) uses a FAST path: hold back at most a
 *    few truncated UTF-8 trailing bytes and decode everything else immediately, same
 *    latency as the pre-fix `data.toString()`. There is no OEM-vs-UTF-8 ambiguity to
 *    resolve here, so there's nothing to gain from waiting for a line boundary.
 *  - ONLY when OEM decode is actually reachable (win32 + a real non-UTF-8 code page
 *    detected) does it use the SAFE path: buffer up to the last newline/carriage-return
 *    byte (always safe — `\n`/`\r` never appear as a non-final byte of a UTF-8 or DBCS
 *    multi-byte sequence, both are ASCII-transparent by design), then decode each
 *    complete LINE within that region independently, so one OEM-encoded line can't drag
 *    an adjacent valid-UTF-8 line into a wrong decode. A size cap bounds worst-case
 *    buffering for output that never emits a line break.
 * An earlier version of this file used the SAFE path unconditionally on every platform,
 * which held back partial-line interactive prompts (e.g. npm's "Ok to proceed? (y)")
 * indefinitely even where Windows/OEM decoding was never in play — a real review-caught
 * regression, fixed by only paying the buffering cost when it can possibly matter.
 */

import { spawn } from 'node:child_process';
import * as iconv from 'iconv-lite';

/**
 * UTF-8 structural validity check over raw bytes. Rejects the standard set of
 * structurally-invalid patterns: stray/missing continuation bytes, overlong encodings
 * (a multi-byte sequence encoding a codepoint that fits in fewer bytes — e.g. cp866's
 * `рАБ` = `E0 80 81` LOOKS like a 3-byte lead+continuation pair but is an overlong,
 * invalid encoding of U+0001), UTF-16 surrogate halves (U+D800-DFFF, never valid in
 * UTF-8), and codepoints beyond U+10FFFF. This is NOT a claim of zero false positives:
 * a genuinely structurally-VALID 2/3/4-byte UTF-8 sequence can still coincidentally be
 * the byte encoding of a short, unrelated OEM-code-page string (e.g. two adjacent
 * cp1251 Cyrillic letters can coincide with a valid 2-byte UTF-8 sequence) — that
 * collision is a fundamental limit of heuristic encoding detection from bytes alone,
 * not something structural validation can further close without a full
 * frequency/dictionary-based charset detector (out of scope here).
 */
export function isLikelyValidUtf8(buf: Buffer): boolean {
  let i = 0;
  while (i < buf.length) {
    const byte = buf[i];
    if (byte <= 0x7f) {
      i += 1;
      continue;
    }
    let continuationBytes: number;
    if ((byte & 0xe0) === 0xc0) {
      if (byte < 0xc2) return false; // 0xC0/0xC1 always overlong-encode a <0x80 codepoint
      continuationBytes = 1;
    } else if ((byte & 0xf0) === 0xe0) {
      continuationBytes = 2;
    } else if ((byte & 0xf8) === 0xf0) {
      if (byte > 0xf4) return false; // codepoint would exceed U+10FFFF
      continuationBytes = 3;
    } else {
      return false; // stray continuation byte or an invalid leading byte
    }
    if (i + continuationBytes >= buf.length) return false;
    const byte2 = buf[i + 1];
    if ((byte2 & 0xc0) !== 0x80) return false;
    if (byte === 0xe0 && byte2 < 0xa0) return false; // overlong 3-byte
    if (byte === 0xed && byte2 >= 0xa0) return false; // UTF-16 surrogate half
    if (byte === 0xf0 && byte2 < 0x90) return false; // overlong 4-byte
    if (byte === 0xf4 && byte2 > 0x8f) return false; // > U+10FFFF
    for (let j = 2; j <= continuationBytes; j++) {
      if ((buf[i + j] & 0xc0) !== 0x80) return false;
    }
    i += continuationBytes + 1;
  }
  return true;
}

/**
 * Pull the code page number out of `chcp`'s own confirmation line. That line is
 * ITSELF localized ("Active code page: 866" in English, a full Russian sentence on a
 * Russian-locale box) — so this does NOT match any fixed phrase, it just takes the
 * last run of 2-5 ASCII digits in the text. ASCII digits (0x30-0x39) are byte-identical
 * across every OEM code page and UTF-8, so this is safe to run on a `latin1`-decoded
 * string regardless of the surrounding text's real encoding.
 */
export function parseCodePageFromChcpOutput(raw: string): number | null {
  const match = raw.match(/(\d{2,5})\D*$/);
  return match ? Number(match[1]) : null;
}

/** Node's `child_process.spawn`, narrowed to the one overload {@link runChcpQuery} needs. */
type SpawnFn = (command: string, args: readonly string[], options: Record<string, unknown>) => ReturnType<typeof spawn>;

/** How long to wait for a single `chcp` invocation before giving up (review finding:
 * a hung `cmd.exe` — e.g. a blocking `AutoRun` registry script, which DOES run for
 * every `cmd /c` — must not wedge every future dev-server start on a dead promise). */
const CHCP_QUERY_TIMEOUT_MS = 2000;

/**
 * Run one `chcp` (no args) invocation via the given command/executable and resolve the
 * code page it reports, or `null` on any failure (spawn error, non-zero exit, no
 * parseable digits, or timeout). Extracted so {@link detectWindowsOemCodePage} can
 * retry with a different executable path without duplicating the spawn/collect/parse
 * wiring, and so tests can inject a fake `spawn` instead of depending on the ambient
 * OS actually having (or lacking) a real `chcp`.
 *
 * `useShell`: the absolute `%SystemRoot%\System32\chcp.com` path is a real executable
 * and needs no shell (also sidesteps a `cmd` `AutoRun` script polluting stdout, and any
 * quoting hazard if `SystemRoot` contains a space); the bare `chcp` PATH-resolved
 * fallback still needs a shell to resolve it as a `cmd.exe` built-in-adjacent command.
 *
 * Deliberately does NOT pass `windowsHide: true` (review finding, corrected — an
 * earlier version of this fix added it): `chcp` reports the code page of ITS OWN
 * console, and `windowsHide` maps to Win32's `CREATE_NO_WINDOW`, which means NO console
 * is allocated for the child at all — with no console, `chcp` has nothing to report and
 * the probe would always resolve `null`, silently defeating the entire fix. Spawned
 * from a non-console host (the VS Code extension host), Windows auto-allocates a
 * console for this console-subsystem child, which is what lets `chcp` answer at all —
 * that console defaults to the OS's OEM code page, which is the exact value this probe
 * needs. The tradeoff is a barely-perceptible console flash for this one diagnostic
 * call; accepted as the cost of the probe actually working, rather than "clean" and
 * permanently non-functional.
 */
function runChcpQuery(chcpCommand: string, useShell: boolean, spawnFn: SpawnFn = spawn): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    let settled = false;
    const settle = (result: number | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      const child = spawnFn(chcpCommand, [], {
        shell: useShell,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const timeout = setTimeout(() => {
        child.kill(); // don't leak a wedged probe process
        settle(null);
      }, CHCP_QUERY_TIMEOUT_MS);
      const chunks: Buffer[] = [];
      child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.on('error', () => {
        clearTimeout(timeout);
        settle(null);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          settle(null);
          return;
        }
        // latin1: byte-preserving 1:1 decode, safe here because we only hunt for
        // ASCII digit runs (see parseCodePageFromChcpOutput doc comment).
        settle(parseCodePageFromChcpOutput(Buffer.concat(chunks).toString('latin1')));
      });
    } catch {
      settle(null);
    }
  });
}

let cachedOemCodePageProbe: Promise<number | null> | null = null;

/**
 * Detect the active Windows OEM code page via a standalone `chcp` invocation (NOT
 * chained into the dev-server spawn — a separate, independent process).
 *
 * Tries the absolute path `%SystemRoot%\System32\chcp.com` FIRST, falling back to the
 * bare `chcp` (PATH-resolved) only if that fails. HYP-1140's whole premise is a broken
 * PATH (that's why `npm` itself didn't resolve) — a PATH broken enough to also hide
 * `System32` would make the bare-`chcp` probe fail in exactly the scenario this fix
 * targets, so the absolute path avoids depending on PATH being sane at all.
 *
 * Cached for the lifetime of the extension host process — but ONLY a successful
 * (non-null) result. A `null` (every attempt failed, or timed out) is treated as
 * transient and NOT cached, so the next call gets another chance rather than
 * permanently pinning "unknown" for the whole session over one spawn hiccup.
 *
 * Callers should NOT `await` this before spawning the dev server (review finding): on
 * a box where `chcp` genuinely hangs, that would add up to ~2 x CHCP_QUERY_TIMEOUT_MS
 * to EVERY dev-server start. `DevServerManager` fires this off and hands the *pending
 * promise* to `StreamOutputDecoder` (via a live accessor function), which treats
 * "not yet known" the same as "unknown" (plain UTF-8 decode) until it resolves.
 *
 * `spawnFn` is an injectable seam (default `child_process.spawn`) so tests can exercise
 * the full success/fallback/caching orchestration hermetically, without depending on
 * the ambient test-runner OS actually having a working `chcp`.
 */
export function detectWindowsOemCodePage(
  platform: NodeJS.Platform = process.platform,
  spawnFn: SpawnFn = spawn,
): Promise<number | null> {
  if (platform !== 'win32') return Promise.resolve(null);
  if (!cachedOemCodePageProbe) {
    const systemRoot = process.env.SystemRoot;
    const absoluteChcp = systemRoot ? `${systemRoot}\\System32\\chcp.com` : null;
    cachedOemCodePageProbe = (absoluteChcp ? runChcpQuery(absoluteChcp, false, spawnFn) : Promise.resolve(null))
      .then((result) => (result !== null ? result : runChcpQuery('chcp', true, spawnFn)))
      .then((result) => {
        if (result === null) cachedOemCodePageProbe = null; // let the next call retry
        return result;
      });
  }
  return cachedOemCodePageProbe;
}

/** Test-only: clear the memoized probe so each test starts from a clean cache. */
export function _resetWindowsOemCodePageCacheForTests(): void {
  cachedOemCodePageProbe = null;
}

/**
 * Decode ONE COMPLETE buffer of dev-server (or dependency-repair) child-process
 * output — "complete" meaning it does not end mid-way through a multi-byte character,
 * in EITHER UTF-8 or a double-byte (DBCS) OEM code page. A raw `data` event from a
 * child process stream is NOT guaranteed to be complete in this sense — callers wired
 * to a live stream MUST go through {@link StreamOutputDecoder}, which decides per-chunk
 * (fast path) or buffers to a safe boundary (safe path, only when OEM decode is
 * reachable) before calling this. Calling this directly on a possibly-truncated stream
 * chunk while OEM decode is reachable can mis-detect legitimate split UTF-8 as OEM
 * bytes, or corrupt a split double-byte OEM character — both were real review findings
 * (HYP-1140 follow-up), not hypotheticals.
 *
 * UTF-8 first, always — that covers non-Windows platforms and the common case where
 * the dev tool's own output already is UTF-8. Only falls back to iconv-lite when ALL
 * of: we're on win32, a real OEM code page was detected (not `null`/unknown, not
 * `65001` which just IS UTF-8), and the bytes fail the UTF-8 structural check. An
 * unrecognized code page name, or any decode error, falls back to plain UTF-8 rather
 * than throwing — this must never crash the log pipeline.
 */
export function decodeChildOutput(data: Buffer, platform: NodeJS.Platform, oemCodePage: number | null): string {
  const shouldTryOemDecode =
    platform === 'win32' && oemCodePage !== null && oemCodePage !== 65001 && !isLikelyValidUtf8(data);
  if (!shouldTryOemDecode) {
    return data.toString('utf8');
  }
  const encodingName = `cp${oemCodePage}`;
  if (!iconv.encodingExists(encodingName)) {
    return data.toString('utf8');
  }
  try {
    return iconv.decode(data, encodingName);
  } catch {
    return data.toString('utf8');
  }
}

/**
 * How many trailing bytes of `buf` form the START of a UTF-8 multi-byte sequence that
 * is cut off at the end of the buffer (0 if the buffer doesn't end mid-sequence).
 * Scans backward at most 3 bytes (the longest possible "missing suffix" — a 4-byte
 * sequence whose lead byte is the very last byte needs 3 more).
 *
 * Used by {@link StreamOutputDecoder}'s FAST path (OEM decode not reachable — the
 * common case) to hold back only a truncated trailing sequence and decode everything
 * else immediately, and by its SAFE path's size-capped fallback (no newline seen for a
 * long stretch of output). This check is UTF-8-only / not DBCS-aware — on the fast
 * path that's fine (OEM decode isn't reachable there by construction); on the safe
 * path's size-cap fallback it means a double-byte OEM character split exactly at the
 * cap could rarely still corrupt — accepted as a narrow, documented edge case (a single
 * "line" of DBCS OEM output exceeding {@link STREAM_DECODER_SIZE_CAP} bytes with no
 * line break at all) rather than building a full DBCS lead-byte table (which turned out
 * to be genuinely ambiguous to hand-roll correctly — Shift-JIS trail-byte values
 * overlap lead-byte ranges — where an incremental iconv-lite decoder would be the
 * correct tool; out of scope for this fix).
 */
export function trailingIncompleteUtf8Length(buf: Buffer): number {
  for (let back = 1; back <= 3 && back <= buf.length; back++) {
    const byte = buf[buf.length - back];
    if ((byte & 0xc0) === 0x80) continue; // continuation byte — keep looking further back
    if (byte <= 0x7f) return 0; // ASCII — no multi-byte sequence in progress
    let expectedLength: number;
    if ((byte & 0xe0) === 0xc0) expectedLength = 2;
    else if ((byte & 0xf0) === 0xe0) expectedLength = 3;
    else if ((byte & 0xf8) === 0xf0) expectedLength = 4;
    else return 0; // not a valid UTF-8 lead byte — nothing legit to wait for
    return back < expectedLength ? back : 0;
  }
  return 0;
}

/** Bytes: `\n` and `\r` — the only characters guaranteed to never appear as a non-final
 * byte of a multi-byte sequence in UTF-8 or any DBCS/single-byte Windows OEM code page
 * (all are ASCII-transparent by design), so splitting on them is always safe regardless
 * of which encoding the bytes turn out to be. */
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/** Safety valve for the SAFE path with no line break at all (e.g. a long single JSON
 * blob): a held-back buffer this large is flushed via the UTF-8-only boundary check
 * instead of waiting indefinitely — bounds worst-case memory and latency. 8 KiB
 * comfortably covers ordinary log lines and progress updates without ever triggering
 * in practice. */
const STREAM_DECODER_SIZE_CAP = 8192;

/**
 * Stateful per-stream wrapper around {@link decodeChildOutput}: one instance per
 * physical child-process stream (stdout or stderr), constructed fresh for each spawned
 * child. Two modes, chosen fresh on every `push()` call from the CURRENT resolved code
 * page (see the file header comment for why):
 *  - FAST (OEM decode not reachable): hold back only a UTF-8-truncated tail (<=3 bytes)
 *    and decode everything else immediately — same latency as plain `data.toString()`.
 *  - SAFE (win32 + a real non-UTF-8 code page known): buffer up to the last `\n`/`\r`,
 *    then decode each complete LINE within that region independently, so one
 *    OEM-encoded line can't corrupt an adjacent valid-UTF-8 line in the same flush.
 *
 * `getOemCodePage` is a live accessor (not a fixed value) so a still-pending
 * `detectWindowsOemCodePage()` probe can resolve MID-STREAM without needing to
 * reconstruct the decoder: earlier chunks simply see "not yet known" (same as
 * "unknown", FAST path), later chunks see the real value once it lands.
 */
export class StreamOutputDecoder {
  private _pending: Buffer = Buffer.alloc(0);

  constructor(
    private readonly platform: NodeJS.Platform,
    private readonly getOemCodePage: () => number | null,
  ) {}

  /** Decode as much of `chunk` as is safe to decode now, carrying the rest forward. */
  push(chunk: Buffer): string {
    const combined = this._pending.length > 0 ? Buffer.concat([this._pending, chunk]) : chunk;
    const oemCodePage = this.getOemCodePage();
    const oemDecodeReachable = this.platform === 'win32' && oemCodePage !== null && oemCodePage !== 65001;

    if (!oemDecodeReachable) {
      return this._pushFast(combined);
    }
    return this._pushSafe(combined, oemCodePage);
  }

  /**
   * Decode any bytes still held back. Call once when the stream truly ends (process
   * `exit`) — nothing more is coming, so even a still-incomplete sequence is decoded
   * best-effort (matching plain `data.toString()`'s behavior on truncated input)
   * rather than silently dropped.
   */
  flush(): string {
    if (this._pending.length === 0) return '';
    const leftover = this._pending;
    this._pending = Buffer.alloc(0);
    return decodeChildOutput(leftover, this.platform, this.getOemCodePage());
  }

  /** FAST path body: hold back only a UTF-8-truncated tail, decode the rest now. */
  private _pushFast(combined: Buffer): string {
    const heldBackLength = trailingIncompleteUtf8Length(combined);
    const complete = heldBackLength > 0 ? combined.subarray(0, combined.length - heldBackLength) : combined;
    this._pending =
      heldBackLength > 0 ? Buffer.from(combined.subarray(combined.length - heldBackLength)) : Buffer.alloc(0);
    return decodeChildOutput(complete, this.platform, this.getOemCodePage());
  }

  /** SAFE path body: buffer to the last newline/carriage-return, decode per line. */
  private _pushSafe(combined: Buffer, oemCodePage: number): string {
    const lastLineFeed = combined.lastIndexOf(LINE_FEED);
    const lastCarriageReturn = combined.lastIndexOf(CARRIAGE_RETURN);
    const boundary = Math.max(lastLineFeed, lastCarriageReturn);
    if (boundary === -1) {
      if (combined.length >= STREAM_DECODER_SIZE_CAP) {
        return this._flushViaUtf8BoundaryFallback(combined, oemCodePage);
      }
      this._pending = combined; // no safe boundary yet — wait for more
      return '';
    }
    const complete = combined.subarray(0, boundary + 1);
    this._pending = Buffer.from(combined.subarray(boundary + 1));
    return this._decodePerLine(complete, oemCodePage);
  }

  /** Decode each `\n`/`\r`-terminated line in `buf` independently (review finding: a
   * single flush block can otherwise batch a valid-UTF-8 line together with an
   * OEM-encoded one and garble the wrong one). `buf` is guaranteed by the caller to end
   * exactly on a line boundary. */
  private _decodePerLine(buf: Buffer, oemCodePage: number): string {
    let out = '';
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      const byte = buf[i];
      if (byte === LINE_FEED || byte === CARRIAGE_RETURN) {
        out += decodeChildOutput(buf.subarray(start, i + 1), this.platform, oemCodePage);
        start = i + 1;
      }
    }
    return out;
  }

  /** Size-cap fallback: trim a UTF-8-unsafe trailing tail (not DBCS-aware — see
   * {@link trailingIncompleteUtf8Length}'s doc comment) and decode the rest. */
  private _flushViaUtf8BoundaryFallback(combined: Buffer, oemCodePage: number): string {
    const heldBackLength = trailingIncompleteUtf8Length(combined);
    const complete = heldBackLength > 0 ? combined.subarray(0, combined.length - heldBackLength) : combined;
    this._pending =
      heldBackLength > 0 ? Buffer.from(combined.subarray(combined.length - heldBackLength)) : Buffer.alloc(0);
    return decodeChildOutput(complete, this.platform, oemCodePage);
  }
}
