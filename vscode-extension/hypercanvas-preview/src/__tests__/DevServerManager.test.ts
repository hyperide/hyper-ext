import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  clearOwnedDevServer,
  isProcessAlive,
  readOwnedDevServer,
  readOwnedDevServers,
  recordOwnedDevServer,
} from '../services/devServerOrphanRegistry';
import type { DevServerStatus } from '../types';

/**
 * DevServerManager test — focuses on log parsing, state machine,
 * and callback wiring. Does NOT test actual process spawning.
 *
 * Do NOT mock ProjectDetector — it loads fine without mocks and
 * a global mock would break ProjectDetector's own tests
 * (bun mock.module is global, not scoped per file).
 *
 * PreviewProxy reads iframe-*.js via fs.readFileSync AT IMPORT TIME, and those
 * files only exist next to the bundled output, not in src/. Previously this file
 * globally mock.module'd '../services/PreviewProxy' with a stub class — but that
 * mock is process-global and IRREVERSIBLE (bun's mock.restore does not undo
 * module mocks), so under a non-isolated run it leaked into
 * PreviewProxy.serving.test.ts, whose assertions need the REAL proxy (the stub
 * lacks setIsServing) — 3 spurious failures (HYP-579). The tests here never
 * instantiate PreviewProxy anyway; every case that needs a proxy injects its own
 * local `{ stop: mock() }` via Object.assign(manager, { _previewProxy }). So we
 * only need the import to succeed: stub readFileSync for iframe-* (spreading real
 * fs so every other read is untouched — AGENTS.md global-mock rule), exactly like
 * PreviewProxy.serving.test.ts does. The real module then imports cleanly and
 * nothing leaks.
 */
const realFs = await import('node:fs');
// Capture the ORIGINAL readFileSync before mock.module mutates the node:fs
// namespace in place. Calling `realFs.readFileSync` inside the factory would
// resolve to the MOCKED function (bun mutates the existing namespace object),
// recursing forever on any non-iframe read — dormant until a test reads a real
// file at runtime (e.g. the orphan-registry reap wiring below).
const origReadFileSync = realFs.readFileSync;
mock.module('node:fs', () => ({
  ...realFs,
  default: realFs,
  readFileSync: (file: string, enc?: unknown) => {
    if (typeof file === 'string' && file.includes('iframe-')) return '/* stub */';
    return origReadFileSync(file as string, enc as never);
  },
}));
const {
  anyDirtyDocIsViteConfig,
  appendScriptCliArgs,
  buildInstallCommand,
  buildMissingCommandHint,
  devScriptDeclaresPort,
  devScriptUsesWrapper,
  DevServerManager,
  isDynamicImportStalenessMessage,
  portInjectionArgs,
  shouldRepairDependencies,
  toShellCommandString,
} = await import('../services/DevServerManager');
const {
  decodeChildOutput,
  detectWindowsOemCodePage,
  isLikelyValidUtf8,
  parseCodePageFromChcpOutput,
  StreamOutputDecoder,
  trailingIncompleteUtf8Length,
  _resetWindowsOemCodePageCacheForTests,
} = await import('../services/windowsOutputDecoding');
const iconv = await import('iconv-lite');

describe('toShellCommandString (DEP0190: fold args into one string for shell:true spawn)', () => {
  it('joins a plain package-manager command and its args', () => {
    expect(toShellCommandString('npm', ['run', 'dev'])).toBe('npm run dev');
  });

  it('preserves injected --port CLI args', () => {
    expect(toShellCommandString('pnpm', ['dev', '--', '--port', '5173'])).toBe('pnpm dev -- --port 5173');
  });

  it('returns a bare command when there are no args', () => {
    expect(toShellCommandString('bun', [])).toBe('bun');
  });

  it('allows the punctuation that appears in real package-manager tokens', () => {
    expect(toShellCommandString('npm', ['run', 'dev:web'])).toBe('npm run dev:web');
    expect(toShellCommandString('pnpm', ['--filter', '@scope/pkg', 'dev'])).toBe('pnpm --filter @scope/pkg dev');
  });

  it('throws on a token containing whitespace or a shell metacharacter (no false-safety quoting)', () => {
    expect(() => toShellCommandString('npm', ['run', 'dev script'])).toThrow(/unsafe token/);
    expect(() => toShellCommandString('npm', ['run', 'dev&&rm'])).toThrow(/unsafe token/);
    expect(() => toShellCommandString('npm', ['run', 'dev$(whoami)'])).toThrow(/unsafe token/);
    expect(() => toShellCommandString('npm', ['run', 'dev`id`'])).toThrow(/unsafe token/);
    expect(() => toShellCommandString('npm', ['run', 'dev*'])).toThrow(/unsafe token/);
  });
});

describe('toShellCommandString (HYP-1140 follow-up: NO Windows chcp codepage prefix)', () => {
  // A prior version of this fix prefixed the win32 spawn command with `chcp
  // 65001>nul&` (via a since-removed `withWindowsUtf8CodepageFix` wrapper /
  // `buildSpawnShellCommand` entrypoint) to try to force cmd.exe's own text into
  // UTF-8. A REAL Windows repro (Russian locale) proved this both ineffective AND
  // regressive:
  //  - Ineffective: `chcp` reprograms the ACTIVE CONSOLE code page, which does not
  //    apply to this process's piped stdio (no attached console) — the mojibake was
  //    never actually fixed by the prefix. See ./windowsOutputDecoding for the real
  //    fix (detect the OEM code page, decode with iconv-lite on a UTF-8 decode
  //    failure).
  //  - Regressive: it turned a single `cmd /c "npm run dev"` into a COMPOUND command
  //    (`cmd /c "chcp 65001>nul&npm run dev"`), which silently changed cmd.exe's
  //    command-not-found exit code from 9009 to the ordinary 1 — breaking
  //    buildMissingCommandHint's exit-code-based detection for exactly the failure
  //    this hint exists to explain.
  // There is now no platform branch left anywhere in the command-building layer:
  // every spawn() callsite in DevServerManager calls toShellCommandString directly,
  // so the command sent to spawn() is always exactly this, on every platform.
  it('produces the plain command with no chcp prefix, on any platform', () => {
    expect(toShellCommandString('npm', ['run', 'dev'])).toBe('npm run dev');
    expect(toShellCommandString('npm', ['run', 'dev'])).not.toContain('chcp');
  });
});

describe('buildMissingCommandHint (HYP-1140: actionable PATH hint on command-not-found)', () => {
  // Design (review-driven, two rounds): errorMessage is a CONTROLLED string (Node's own
  // `spawn X ENOENT`, or something this file built) — matching it directly is always
  // trustworthy on its own. `logs` is ARBITRARY dev-server program output, so log TEXT is
  // used ONLY to best-effort name the binary, and ONLY once a corroborating exit code
  // (9009 Windows / 127 POSIX) has already confirmed a real command-not-found failure —
  // never from text alone. This is what every "detects the ... signature" test below
  // exercises: the exit code that would ACTUALLY accompany that shell text in production.

  it('detects the Windows cmd.exe "not recognized" signature (with its 9009 exit code) and names the binary', () => {
    const hint = buildMissingCommandHint(
      'Server failed to start',
      [
        { line: `'npm' is not recognized as an internal or external command,`, timestamp: 1, isError: true },
        { line: 'operable program or batch file.', timestamp: 1, isError: true },
      ],
      9009,
    );
    expect(hint).not.toBeNull();
    expect(hint).toContain('npm');
    expect(hint).toContain('PATH');
    expect(hint).toMatch(/restart VS Code/i);
  });

  it('detects the POSIX sh/bash "command not found" signature (with its 127 exit code)', () => {
    const hint = buildMissingCommandHint(
      'Server failed to start',
      [{ line: 'sh: bun: command not found', timestamp: 1, isError: true }],
      127,
    );
    expect(hint).not.toBeNull();
    expect(hint).toContain('bun');
    expect(hint).toContain('PATH');
  });

  it('detects the POSIX zsh "command not found: <cmd>" signature and names the BINARY, not the shell', () => {
    // Regression (review finding): zsh's own line ("zsh: command not found: bun") is also a
    // substring match for the sh/bash pattern, which would wrongly capture "zsh" — the shell
    // name — instead of "bun", the actual missing binary. The zsh pattern must be tried first.
    const hint = buildMissingCommandHint(
      'Server failed to start',
      [{ line: 'zsh: command not found: bun', timestamp: 1, isError: true }],
      127,
    );
    expect(hint).not.toBeNull();
    expect(hint).toContain('bun');
    expect(hint).not.toContain('"zsh"');
  });

  it('detects a bare Node spawn ENOENT error DIRECTLY from errorMessage — no exit code needed', () => {
    // The child 'error' handler path: a genuine Node-level spawn failure has no exit code
    // at all (the process never ran), so errorMessage itself must be trusted on its own.
    const hint = buildMissingCommandHint('spawn pnpm ENOENT', []);
    expect(hint).not.toBeNull();
    expect(hint).toContain('pnpm');
  });

  it('returns null for an unrelated failure — no hint pollution on ordinary errors', () => {
    expect(buildMissingCommandHint('Server startup timeout', [])).toBeNull();
    expect(
      buildMissingCommandHint('Failed to start', [
        { line: 'SyntaxError: Unexpected token', timestamp: 1, isError: true },
      ]),
    ).toBeNull();
  });

  it('is NOT fooled by "command not found" appearing in log text WITHOUT a corroborating exit code', () => {
    // A healthy script probing for an optional tool ("foo: command not found" as
    // informational output) must not attach a misleading PATH hint to some LATER,
    // unrelated failure (e.g. a startup timeout) just because the phrase appears
    // somewhere in the buffer. Log text alone — without exitCode 127/9009 — never counts.
    expect(
      buildMissingCommandHint('Server startup timeout', [
        { line: 'checking for optional tool...', timestamp: 1, isError: false },
        { line: 'ncu: command not found — skipping optional check', timestamp: 1, isError: true },
      ]),
    ).toBeNull();
  });

  it('fires on the Windows cmd.exe exit code (9009) even when the message text cannot be parsed', () => {
    // Locale-independence (review finding): chcp 65001 fixes the ENCODING of cmd.exe's text,
    // not its LANGUAGE. A non-English cmd.exe (e.g. the Russian-locale box HYP-1140 was
    // reported from) never matches the English patterns above, but its exit code (9009) is
    // locale-independent and must still surface an (unnamed) actionable hint.
    const hint = buildMissingCommandHint(
      'Server failed to start',
      [
        {
          line: '"npm" не является внутренней или внешней командой, исполняемой программой или пакетным файлом.',
          timestamp: 1,
          isError: true,
        },
      ],
      9009,
    );
    expect(hint).not.toBeNull();
    expect(hint).toContain('PATH');
    expect(hint).toMatch(/restart VS Code/i);
  });

  it('fires on the POSIX exit code (127) even with no matching text at all', () => {
    const hint = buildMissingCommandHint('Server failed to start', [], 127);
    expect(hint).not.toBeNull();
    expect(hint).toContain('the required command');
  });

  it('an unrelated exit code does not force a hint on ordinary errors', () => {
    expect(buildMissingCommandHint('Server startup timeout', [], 1)).toBeNull();
    expect(buildMissingCommandHint('Server startup timeout', [], null)).toBeNull();
  });

  it('never names "chcp" even when it is the one that fails to resolve', () => {
    // This predates removal of the `chcp 65001>nul&` spawn prefix (see the
    // toShellCommandString describe block above): when that prefix was still chained
    // into the dev-server command, a PATH broken enough that even System32\chcp.com
    // couldn't resolve made cmd.exe emit its "not recognized" line for "chcp" BEFORE
    // the real command's line. The prefix is gone now, so this line can no longer
    // appear from OUR injection — kept as cheap, still-correct defense in case a
    // user's own dev script happens to invoke `chcp` itself. Naming "chcp" in that
    // case would confuse the user about something they never asked to run themselves.
    const hint = buildMissingCommandHint(
      'Server failed to start',
      [{ line: `'chcp' is not recognized as an internal or external command,`, timestamp: 1, isError: true }],
      9009,
    );
    expect(hint).not.toBeNull();
    expect(hint).toContain('the required command');
    expect(hint).not.toContain('"chcp"');
  });

  it('skips PAST a "chcp" match to find the REAL binary later in the same buffer (regression: first-match-wins used to lock onto "chcp")', () => {
    // Review finding: when chcp.com itself fails to resolve, cmd.exe emits BOTH lines,
    // in order — chcp's own failure, then the real command's. A naive first-match
    // lookup stopped at line 1 and never saw line 2's real binary name. The fix walks
    // every match per pattern category and skips "chcp" specifically.
    const hint = buildMissingCommandHint(
      'Server failed to start',
      [
        { line: `'chcp' is not recognized as an internal or external command,`, timestamp: 1, isError: true },
        { line: 'operable program or batch file.', timestamp: 1, isError: true },
        { line: `'npm' is not recognized as an internal or external command,`, timestamp: 2, isError: true },
        { line: 'operable program or batch file.', timestamp: 2, isError: true },
      ],
      9009,
    );
    expect(hint).not.toBeNull();
    expect(hint).toContain('"npm"');
    expect(hint).not.toContain('"chcp"');
  });

  it('does not trigger shouldRepairDependencies — the enriched, hinted message must never look like a native-binding failure', () => {
    // Review finding: _waitForReady now rethrows the SPECIFIC `_error` (which can be
    // this hint's own output, e.g. "spawn cmd.exe ENOENT — Could not find ... PATH...")
    // instead of the old generic "Server failed to start". Pin that this text can never
    // be mistaken for the unrelated native-binding-repair signatures shouldRepairDependencies
    // checks for — a false match there would trigger a pointless full dependency reinstall
    // for a broken-PATH failure that reinstalling can't fix.
    const hint = buildMissingCommandHint('spawn cmd.exe ENOENT', []);
    expect(hint).not.toBeNull();
    const enrichedMessage = `spawn cmd.exe ENOENT — ${hint}`;
    expect(shouldRepairDependencies(enrichedMessage, [])).toBe(false);
  });
});

describe('windowsOutputDecoding (HYP-1140 follow-up: decode the ACTUAL bytes, not just fix the prefix)', () => {
  describe('isLikelyValidUtf8', () => {
    it('accepts plain ASCII', () => {
      expect(isLikelyValidUtf8(Buffer.from('npm run dev', 'utf8'))).toBe(true);
    });

    it('accepts real UTF-8-encoded multi-byte (Cyrillic) text', () => {
      expect(isLikelyValidUtf8(Buffer.from('не является внутренней командой', 'utf8'))).toBe(true);
    });

    it('rejects cp866-encoded Cyrillic bytes — NOT structurally valid UTF-8', () => {
      const cp866Bytes = iconv.encode('не является внутренней командой', 'cp866');
      expect(isLikelyValidUtf8(cp866Bytes)).toBe(false);
    });

    it('rejects overlong encodings (review finding: cp866 "рАБ" = E0 80 81 looked like valid UTF-8 structure)', () => {
      // E0 80 81 has the right byte-count SHAPE (3-byte lead + 2 continuation bytes)
      // but overlong-encodes U+0001 — real UTF-8 encoders never produce this.
      expect(isLikelyValidUtf8(Buffer.from([0xe0, 0x80, 0x81]))).toBe(false);
      expect(isLikelyValidUtf8(Buffer.from([0xc0, 0x80]))).toBe(false); // 0xC0 always overlong
      expect(isLikelyValidUtf8(Buffer.from([0xc1, 0xbf]))).toBe(false); // 0xC1 always overlong
      expect(isLikelyValidUtf8(Buffer.from([0xf0, 0x80, 0x80, 0x80]))).toBe(false); // overlong 4-byte
    });

    it('rejects UTF-16 surrogate halves (never valid in UTF-8)', () => {
      expect(isLikelyValidUtf8(Buffer.from([0xed, 0xa0, 0x80]))).toBe(false); // U+D800
    });

    it('rejects codepoints beyond U+10FFFF', () => {
      expect(isLikelyValidUtf8(Buffer.from([0xf5, 0x80, 0x80, 0x80]))).toBe(false);
      expect(isLikelyValidUtf8(Buffer.from([0xf4, 0x90, 0x80, 0x80]))).toBe(false);
    });

    it('still accepts real multi-byte UTF-8 across all sequence lengths after the stricter checks', () => {
      expect(isLikelyValidUtf8(Buffer.from('не является внутренней командой ➜ 🚀 日本語', 'utf8'))).toBe(true);
    });
  });

  describe('parseCodePageFromChcpOutput', () => {
    it('parses the English confirmation line', () => {
      expect(parseCodePageFromChcpOutput('Active code page: 65001\r\n')).toBe(65001);
    });

    it('parses a differently-worded (localized) confirmation line by taking the trailing digit run', () => {
      // `chcp`'s own confirmation text is ALSO localized (a Russian-locale box prints a
      // full Russian sentence, not "Active code page: ...") — this must not assume any
      // fixed English phrase.
      expect(parseCodePageFromChcpOutput('Текущая кодовая страница: 866\r\n')).toBe(866);
    });

    it('returns null when no digits are present', () => {
      expect(parseCodePageFromChcpOutput('unexpected garbage output')).toBeNull();
    });
  });

  describe('detectWindowsOemCodePage', () => {
    // Fake ChildProcess-like object for the injectable `spawnFn` seam (review P2:
    // hermetic success/fallback/caching coverage instead of depending on the ambient
    // test-runner OS actually having — or lacking — a real `chcp`).
    function makeFakeChcpChild(): EventEmitter & { stdout: EventEmitter; kill: ReturnType<typeof mock> } {
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; kill: ReturnType<typeof mock> };
      child.stdout = new EventEmitter();
      child.kill = mock(() => true);
      return child;
    }

    let originalSystemRoot: string | undefined;
    beforeEach(() => {
      originalSystemRoot = process.env.SystemRoot;
      process.env.SystemRoot = 'C:\\Windows'; // exercise the absolute-path branch deterministically
    });
    afterEach(() => {
      _resetWindowsOemCodePageCacheForTests();
      if (originalSystemRoot === undefined) {
        delete process.env.SystemRoot;
      } else {
        process.env.SystemRoot = originalSystemRoot;
      }
    });

    it('returns null immediately on non-win32 without spawning anything', async () => {
      const spawnFn = mock(() => makeFakeChcpChild() as unknown as ReturnType<typeof spawn>);
      expect(await detectWindowsOemCodePage('darwin', spawnFn)).toBeNull();
      expect(await detectWindowsOemCodePage('linux', spawnFn)).toBeNull();
      expect(spawnFn).not.toHaveBeenCalled();
    });

    it('resolves via the absolute %SystemRoot%\\System32\\chcp.com path, without a shell, when it succeeds', async () => {
      const spawnFn = mock((command: string, _args: readonly string[], options: Record<string, unknown>) => {
        expect(command).toBe('C:\\Windows\\System32\\chcp.com');
        expect(options.shell).toBe(false); // real executable — no shell needed
        // Review regression, corrected: `windowsHide: true` maps to CREATE_NO_WINDOW,
        // which prevents ANY console from being allocated — `chcp` then has nothing to
        // report and the probe always resolves null, silently defeating the whole fix.
        // Must NEVER be set here again.
        expect(options.windowsHide).toBeUndefined();
        const child = makeFakeChcpChild();
        queueMicrotask(() => {
          child.stdout.emit('data', Buffer.from('Active code page: 866\r\n'));
          child.emit('close', 0);
        });
        return child as unknown as ReturnType<typeof spawn>;
      });
      expect(await detectWindowsOemCodePage('win32', spawnFn)).toBe(866);
      expect(spawnFn).toHaveBeenCalledTimes(1);
    });

    it('falls back to bare `chcp` (via a shell) when the absolute path fails', async () => {
      const spawnFn = mock((command: string, _args: readonly string[], options: Record<string, unknown>) => {
        const child = makeFakeChcpChild();
        if (command === 'C:\\Windows\\System32\\chcp.com') {
          queueMicrotask(() => child.emit('error', new Error('ENOENT')));
        } else {
          expect(command).toBe('chcp');
          expect(options.shell).toBe(true);
          queueMicrotask(() => {
            child.stdout.emit('data', Buffer.from('Active code page: 1251\r\n'));
            child.emit('close', 0);
          });
        }
        return child as unknown as ReturnType<typeof spawn>;
      });
      expect(await detectWindowsOemCodePage('win32', spawnFn)).toBe(1251);
      expect(spawnFn).toHaveBeenCalledTimes(2);
    });

    it('treats a non-zero exit code as failure (not a false digit match from stray AutoRun output)', async () => {
      const spawnFn = mock(() => {
        const child = makeFakeChcpChild();
        queueMicrotask(() => {
          child.stdout.emit('data', Buffer.from('some unrelated AutoRun output 42\r\n'));
          child.emit('close', 1);
        });
        return child as unknown as ReturnType<typeof spawn>;
      });
      expect(await detectWindowsOemCodePage('win32', spawnFn)).toBeNull();
    });

    it('caches a successful result — a second call does not spawn again', async () => {
      const spawnFn = mock(() => {
        const child = makeFakeChcpChild();
        queueMicrotask(() => {
          child.stdout.emit('data', Buffer.from('Active code page: 65001\r\n'));
          child.emit('close', 0);
        });
        return child as unknown as ReturnType<typeof spawn>;
      });
      expect(await detectWindowsOemCodePage('win32', spawnFn)).toBe(65001);
      expect(await detectWindowsOemCodePage('win32', spawnFn)).toBe(65001);
      expect(spawnFn).toHaveBeenCalledTimes(1);
    });

    it('does NOT cache a null result — the next call retries', async () => {
      const spawnFn = mock(() => {
        const child = makeFakeChcpChild();
        queueMicrotask(() => child.emit('error', new Error('ENOENT')));
        return child as unknown as ReturnType<typeof spawn>;
      });
      expect(await detectWindowsOemCodePage('win32', spawnFn)).toBeNull();
      expect(await detectWindowsOemCodePage('win32', spawnFn)).toBeNull();
      // Two attempts (absolute + fallback) per outer call, times two outer calls.
      expect(spawnFn).toHaveBeenCalledTimes(4);
    });

    it('resolves null (and kills the wedged child) instead of hanging forever when chcp never responds', async () => {
      // Review High finding: a hung cmd.exe (e.g. a blocking AutoRun script) must not
      // wedge every future dev-server start on a promise that never settles.
      let killedChild: ReturnType<typeof makeFakeChcpChild> | null = null;
      const spawnFn = mock(() => {
        const child = makeFakeChcpChild();
        killedChild = child;
        // Never emits 'close' or 'error' — simulates a wedged process.
        return child as unknown as ReturnType<typeof spawn>;
      });
      const result = await detectWindowsOemCodePage('win32', spawnFn);
      expect(result).toBeNull();
      expect(killedChild).not.toBeNull();
      expect((killedChild as unknown as { kill: ReturnType<typeof mock> }).kill).toHaveBeenCalled();
    }, 10_000);

    it('fails soft (resolves null, never throws/rejects) against the REAL spawn on a non-Windows test machine', async () => {
      // Complements the hermetic tests above with one real-process check: forcing
      // platform='win32' with the default (real) spawnFn exercises actual OS process
      // failure, not just our own fake. Only meaningful on a non-Windows test machine
      // (real Windows CI would have a genuine `chcp`) — gate rather than assert
      // something platform-dependent as if it were universal.
      if (process.platform === 'win32') return;
      await expect(detectWindowsOemCodePage('win32')).resolves.toBeNull();
    });
  });

  describe('decodeChildOutput — the REAL HYP-1140 regression: literal cp866 bytes decode to readable Russian text', () => {
    // This is the exact string from the CTO's Windows repro (HYP-1140), encoded here
    // with iconv-lite exactly as cmd.exe would actually emit it on a Russian-locale
    // box (cp866) when output is piped (no attached console — chcp cannot help).
    const REPORTED_TEXT =
      '"npm" не является внутренней или внешней командой, исполняемой программой или файлом сценария.';

    it('decodes cp866-encoded bytes to the correct, readable Russian text on win32 with a detected non-UTF-8 code page', () => {
      const cp866Bytes = iconv.encode(REPORTED_TEXT, 'cp866');
      const decoded = decodeChildOutput(cp866Bytes, 'win32', 866);
      expect(decoded).toBe(REPORTED_TEXT);
      expect(decoded).not.toContain('�'); // no U+FFFD replacement characters (the reported mojibake)
    });

    it('leaves already-valid UTF-8 bytes alone even when a non-UTF-8 code page was detected', () => {
      const utf8Bytes = Buffer.from(REPORTED_TEXT, 'utf8');
      expect(decodeChildOutput(utf8Bytes, 'win32', 866)).toBe(REPORTED_TEXT);
    });

    it('decodes as plain UTF-8 (garbled but not throwing) when the code page is unknown (null)', () => {
      const cp866Bytes = iconv.encode(REPORTED_TEXT, 'cp866');
      expect(() => decodeChildOutput(cp866Bytes, 'win32', null)).not.toThrow();
      expect(decodeChildOutput(cp866Bytes, 'win32', null)).not.toBe(REPORTED_TEXT);
    });

    it('decodes as plain UTF-8 on non-win32 platforms regardless of a detected code page', () => {
      const cp866Bytes = iconv.encode(REPORTED_TEXT, 'cp866');
      expect(decodeChildOutput(cp866Bytes, 'darwin', 866)).not.toBe(REPORTED_TEXT);
    });

    it('decodes as plain UTF-8 when the detected code page is 65001 (already UTF-8)', () => {
      const utf8Bytes = Buffer.from(REPORTED_TEXT, 'utf8');
      expect(decodeChildOutput(utf8Bytes, 'win32', 65001)).toBe(REPORTED_TEXT);
    });

    it('falls back to UTF-8 for an unrecognized code page number rather than throwing', () => {
      const cp866Bytes = iconv.encode(REPORTED_TEXT, 'cp866');
      expect(() => decodeChildOutput(cp866Bytes, 'win32', 999999)).not.toThrow();
    });
  });

  describe('trailingIncompleteUtf8Length', () => {
    it('returns 0 for a complete ASCII buffer', () => {
      expect(trailingIncompleteUtf8Length(Buffer.from('npm run dev', 'utf8'))).toBe(0);
    });

    it('returns 0 for a buffer ending on a complete multi-byte character', () => {
      expect(trailingIncompleteUtf8Length(Buffer.from('Local: ➜', 'utf8'))).toBe(0);
    });

    it('returns 1 for a buffer ending on a lone 2-byte lead byte', () => {
      // 'Ж' (U+0416) is 2 bytes: 0xD0 0x96. Keep only the lead byte.
      const full = Buffer.from('Ж', 'utf8');
      expect(trailingIncompleteUtf8Length(full.subarray(0, 1))).toBe(1);
    });

    it('returns 1 for a buffer ending on a lone 3-byte lead byte, and 2 for lead+1 continuation', () => {
      // '➜' (U+279C) is 3 bytes: 0xE2 0x9E 0x9C.
      const full = Buffer.from('➜', 'utf8');
      expect(trailingIncompleteUtf8Length(full.subarray(0, 1))).toBe(1);
      expect(trailingIncompleteUtf8Length(full.subarray(0, 2))).toBe(2);
    });

    it('returns 1/2/3 for a truncated 4-byte sequence (emoji) at each incomplete depth', () => {
      // '🚀' (U+1F680) is 4 bytes.
      const full = Buffer.from('🚀', 'utf8');
      expect(full.length).toBe(4);
      expect(trailingIncompleteUtf8Length(full.subarray(0, 1))).toBe(1);
      expect(trailingIncompleteUtf8Length(full.subarray(0, 2))).toBe(2);
      expect(trailingIncompleteUtf8Length(full.subarray(0, 3))).toBe(3);
    });

    it('does not hold back a genuinely malformed tail (no legit lead byte within reach)', () => {
      // Three bare continuation bytes with no lead byte in range — not a real truncated
      // sequence, nothing legitimate to wait for.
      expect(trailingIncompleteUtf8Length(Buffer.from([0x80, 0x80, 0x80]))).toBe(0);
    });
  });

  describe('StreamOutputDecoder — line-buffered decode (review P1, second pass: DBCS OEM code pages also corrupted per-chunk)', () => {
    describe('FAST path (OEM decode not reachable — non-win32, or win32 with unknown/UTF-8 code page)', () => {
      // Review High finding, second pass: an earlier version of this file used the
      // line-buffered SAFE path unconditionally on every platform, which held back
      // partial-line interactive prompts (npm's "Ok to proceed? (y)", etc.) INDEFINITELY
      // even where Windows/OEM decoding was never in play. The FAST path decodes as
      // soon as a character completes, matching the pre-fix `data.toString()` latency.

      it('decodes plain ASCII immediately, with no line boundary needed, on darwin', () => {
        const decoder = new StreamOutputDecoder('darwin', () => null);
        expect(decoder.push(Buffer.from('Ok to proceed? (y) ', 'utf8'))).toBe('Ok to proceed? (y) ');
      });

      it('decodes plain ASCII immediately on win32 when the code page is unknown (null) or already UTF-8 (65001)', () => {
        for (const getOemCodePage of [() => null, () => 65001]) {
          const decoder = new StreamOutputDecoder('win32', getOemCodePage);
          expect(decoder.push(Buffer.from('Ok to proceed? (y) ', 'utf8'))).toBe('Ok to proceed? (y) ');
        }
      });

      it('reassembles UTF-8 split mid-character across two push() calls WITHOUT waiting for a newline', () => {
        const bytes = Buffer.from('Ж', 'utf8'); // 0xD0 0x96
        const decoder = new StreamOutputDecoder('darwin', () => null);
        expect(decoder.push(Buffer.from(bytes.subarray(0, 1)))).toBe(''); // truncated, held back
        expect(decoder.push(Buffer.from(bytes.subarray(1)))).toBe('Ж'); // completes immediately, no \n needed
      });

      it('reassembles a 4-byte emoji split across three push() calls, one byte at a time', () => {
        const text = 'build 🚀 done'; // deliberately no trailing newline
        const bytes = Buffer.from(text, 'utf8');
        const decoder = new StreamOutputDecoder('win32', () => null);
        let out = '';
        for (const byte of bytes) {
          out += decoder.push(Buffer.from([byte]));
        }
        expect(out).toBe(text);
      });

      it('flush() is a no-op when nothing is pending; decodes a still-held-back tail best-effort otherwise', () => {
        const decoder = new StreamOutputDecoder('darwin', () => null);
        expect(decoder.flush()).toBe('');
        const bytes = Buffer.from('➜', 'utf8'); // 0xE2 0x9E 0x9C
        expect(decoder.push(Buffer.from(bytes.subarray(0, 1)))).toBe('');
        expect(decoder.flush()).toBe(Buffer.from(bytes.subarray(0, 1)).toString('utf8')); // best-effort, matches plain toString()
        expect(decoder.flush()).toBe(''); // draining is one-shot
      });
    });

    describe('SAFE path (win32 + a real non-UTF-8 code page detected)', () => {
      it('reassembles UTF-8 text split MID-CHARACTER across two push() calls — the exact regression the review caught', () => {
        const text = '➜ Local: http://localhost:5173/\n';
        const bytes = Buffer.from(text, 'utf8');
        // Split inside the first character's multi-byte sequence ('➜' is 3 bytes) — well
        // before the trailing newline, so nothing is decoded until the second push.
        const chunk1 = Buffer.from(bytes.subarray(0, 2));
        const chunk2 = Buffer.from(bytes.subarray(2));

        // codePage=866 (a detected non-UTF-8 code page) is the exact condition that
        // triggered the regression: deciding UTF-8-vs-OEM on the truncated first chunk
        // would misclassify it as OEM bytes and garble it.
        const decoder = new StreamOutputDecoder('win32', () => 866);
        const out1 = decoder.push(chunk1);
        const out2 = decoder.push(chunk2);
        expect(out1).toBe(''); // nothing complete yet — no line boundary in chunk1
        expect(out2).toBe(text);
        expect(out1 + out2).not.toContain('�');
      });

      it('reassembles a DBCS (double-byte) OEM character split mid-character — CP932/936/949/950, a review P1 repro', () => {
        // Splitting a Shift-JIS/GBK/UHC/Big5 double-byte character produced replacement
        // characters under the old per-chunk decoder. Line-buffering fixes this WITHOUT
        // needing any DBCS-specific boundary logic — nothing is decoded until a full
        // line (ending in the trailing '\n') has arrived, so the arbitrary split point
        // never matters.
        const cases: Array<[number, string]> = [
          [932, '日本語\n'],
          [936, '中文\n'],
          [949, '한국어\n'],
          [950, '中文\n'],
        ];
        for (const [codePage, text] of cases) {
          const bytes = iconv.encode(text, `cp${codePage}`);
          const mid = Math.max(1, Math.floor(bytes.length / 2));
          const decoder = new StreamOutputDecoder('win32', () => codePage);
          const out =
            decoder.push(Buffer.from(bytes.subarray(0, mid))) + decoder.push(Buffer.from(bytes.subarray(mid)));
          expect(out).toBe(text);
        }
      });

      it('decodes single-byte OEM (cp866) text correctly across arbitrary chunk splits', () => {
        const text = '"npm" не является внутренней или внешней командой, исполняемой программой или файлом сценария.\n';
        const cp866Bytes = iconv.encode(text, 'cp866');
        const mid = Math.floor(cp866Bytes.length / 2);

        const decoder = new StreamOutputDecoder('win32', () => 866);
        const out =
          decoder.push(Buffer.from(cp866Bytes.subarray(0, mid))) + decoder.push(Buffer.from(cp866Bytes.subarray(mid)));
        expect(out).toBe(text);
      });

      it('decodes a MIXED block (one valid-UTF-8 line + one OEM-encoded line in the SAME chunk) correctly on BOTH lines', () => {
        // Review finding: deciding UTF-8-vs-OEM for a whole flushed block (rather than
        // per line) would garble whichever line is in the minority. Two lines arriving
        // together in one raw `data` chunk is realistic (e.g. cmd.exe's own two-line
        // "not recognized" / "operable program or batch file" message alongside a
        // preceding valid-UTF-8 tool line).
        const utf8Line = 'Starting dev server ➜\n';
        const oemLine = '"npm" не является внутренней командой\n';
        const combined = Buffer.concat([Buffer.from(utf8Line, 'utf8'), iconv.encode(oemLine, 'cp866')]);

        const decoder = new StreamOutputDecoder('win32', () => 866);
        const out = decoder.push(combined);
        expect(out).toBe(utf8Line + oemLine);
        expect(out).not.toContain('�');
      });

      it('holds back an entire chunk with no line boundary at all, until flush() or a later newline', () => {
        const bytes = Buffer.from('Ж', 'utf8'); // 0xD0 0x96, no trailing newline — but OEM decode IS
        // reachable here (unlike the FAST-path equivalent test), so the SAFE path buffers
        // to a line boundary rather than decoding as soon as the character completes.
        const decoder = new StreamOutputDecoder('win32', () => 866);
        expect(decoder.push(Buffer.from(bytes.subarray(0, 1)))).toBe('');
        expect(decoder.push(Buffer.from(bytes.subarray(1)))).toBe(''); // still no \n/\r — nothing flushed yet
        expect(decoder.flush()).toBe('Ж');
      });

      it('flushes on `\\r` (carriage-return progress lines), not only `\\n`', () => {
        const decoder = new StreamOutputDecoder('win32', () => 866);
        expect(decoder.push(Buffer.from('Downloading... 42%\r', 'utf8'))).toBe('Downloading... 42%\r');
        expect(decoder.push(Buffer.from('Downloading... 87%\r', 'utf8'))).toBe('Downloading... 87%\r');
      });

      it('falls back to the UTF-8-boundary size cap for a very long single line with no newline', () => {
        // A held-back buffer this large is flushed via trailingIncompleteUtf8Length
        // instead of buffering forever — bounds worst-case memory/latency.
        const longLine = 'x'.repeat(9000); // exceeds the 8 KiB cap, no line break anywhere
        const decoder = new StreamOutputDecoder('win32', () => 866);
        const out = decoder.push(Buffer.from(longLine, 'utf8'));
        expect(out.length).toBe(9000);
        expect(out).toBe(longLine);
        expect(decoder.flush()).toBe(''); // nothing left held back
      });

      it('flush() is a no-op (empty string) when nothing is pending', () => {
        const decoder = new StreamOutputDecoder('win32', () => 866);
        decoder.push(Buffer.from('complete line\n', 'utf8'));
        expect(decoder.flush()).toBe('');
      });

      it('flush() decodes a still-held-back tail best-effort (process exited mid-line) instead of dropping it', () => {
        const bytes = Buffer.from('no newline yet', 'utf8');
        const decoder = new StreamOutputDecoder('win32', () => 866);
        expect(decoder.push(bytes)).toBe(''); // held back, no line boundary
        expect(decoder.flush()).toBe('no newline yet');
        expect(decoder.flush()).toBe(''); // draining is one-shot
      });
    });

    it('switches from FAST to SAFE mid-stream once a pending OEM code page probe resolves', () => {
      // Proves the live-accessor design (review finding: the probe must not block
      // spawn): the decoder reads getOemCodePage() FRESH on every push(), so a
      // still-resolving detectWindowsOemCodePage() promise can flip the mode partway
      // through a stream without needing to reconstruct the decoder.
      const box: { value: number | null } = { value: null };
      const decoder = new StreamOutputDecoder('win32', () => box.value);
      // Before the probe resolves: FAST path, decodes immediately, no newline needed.
      expect(decoder.push(Buffer.from('booting...', 'utf8'))).toBe('booting...');
      // Probe resolves.
      box.value = 866;
      // After: SAFE path — a line with no newline is now held back until flush/boundary.
      expect(decoder.push(Buffer.from('partial', 'utf8'))).toBe('');
      expect(decoder.flush()).toBe('partial');
    });
  });
});

describe('decode -> buildMissingCommandHint pipeline (HYP-1140 end-to-end)', () => {
  it('produces a readable, non-garbled hint from cp866-encoded Russian "not recognized" output at exit code 9009', () => {
    // Proves the FULL pipeline (decode, then hint) works together, not just each piece
    // in isolation — this is the closest a unit test gets to the CTO's actual repro:
    // real cp866 bytes in, a readable hint out.
    const REPORTED_TEXT =
      '"npm" не является внутренней или внешней командой, исполняемой программой или файлом сценария.';
    const cp866Bytes = iconv.encode(REPORTED_TEXT, 'cp866');
    const decodedLine = decodeChildOutput(cp866Bytes, 'win32', 866);
    expect(decodedLine).toBe(REPORTED_TEXT);

    const hint = buildMissingCommandHint(
      'Server failed to start',
      [{ line: decodedLine, timestamp: Date.now(), isError: true }],
      9009,
    );
    expect(hint).not.toBeNull();
    expect(hint).not.toContain('�');
    expect(hint).toContain('PATH');
    expect(hint).toMatch(/restart VS Code/i);
    // The Windows "not recognized" pattern is English-only, so no binary name is
    // parsed out of Russian text — but the exit code alone still produces a readable,
    // generic hint instead of the old opaque "Server failed to start".
    expect(hint).toContain('the required command');
  });
});

describe('anyDirtyDocIsViteConfig (dirty vite.config guard for the best-effort dedupe patch)', () => {
  const ROOT = '/proj';
  it('returns true when a dirty doc is a vite.config candidate under the project root', () => {
    expect(anyDirtyDocIsViteConfig(ROOT, ['/proj/vite.config.ts'])).toBe(true);
    expect(anyDirtyDocIsViteConfig(ROOT, ['/proj/vite.config.mts'])).toBe(true);
    expect(anyDirtyDocIsViteConfig(ROOT, ['/proj/src/App.tsx', '/proj/vite.config.js'])).toBe(true);
  });

  it('returns false when no dirty doc is a vite.config (so the patch proceeds)', () => {
    expect(anyDirtyDocIsViteConfig(ROOT, [])).toBe(false);
    expect(anyDirtyDocIsViteConfig(ROOT, ['/proj/src/App.tsx', '/proj/package.json'])).toBe(false);
  });

  it('does not match a vite.config OUTSIDE the project root (different project / parent dir)', () => {
    expect(anyDirtyDocIsViteConfig(ROOT, ['/other/vite.config.ts'])).toBe(false);
    expect(anyDirtyDocIsViteConfig(ROOT, ['/proj/sub/vite.config.ts'])).toBe(false);
  });

  it('matches a case-mismatched path on a case-insensitive FS (macOS/Windows) — no clobber of the dirty buffer', () => {
    // VS Code can report the project root and an open doc with different casing for the SAME file.
    // On a case-insensitive FS the guard MUST still fire (a miss = silent persist of unsaved edits).
    expect(anyDirtyDocIsViteConfig('/Proj', ['/proj/vite.config.ts'], true)).toBe(true);
    expect(anyDirtyDocIsViteConfig(ROOT, ['/proj/VITE.CONFIG.TS'], true)).toBe(true);
    // On a case-sensitive FS the differently-cased path is genuinely a different file → no match.
    expect(anyDirtyDocIsViteConfig('/Proj', ['/proj/vite.config.ts'], false)).toBe(false);
    // A genuine match holds regardless of the flag.
    expect(anyDirtyDocIsViteConfig(ROOT, ['/proj/vite.config.ts'], false)).toBe(true);
  });
});

describe('devScriptDeclaresPort', () => {
  it('detects a CLI --port / -p flag (the only reliable pin)', () => {
    expect(devScriptDeclaresPort('vite dev --port 3000')).toBe(true);
    expect(devScriptDeclaresPort('vite dev --port=3000')).toBe(true);
    expect(devScriptDeclaresPort('next dev -p 4000')).toBe(true);
    expect(devScriptDeclaresPort('next dev -p=4000')).toBe(true);
  });

  it('does NOT treat env-var port declarations as a pin (Vite ignores them; inline env overrides ours)', () => {
    expect(devScriptDeclaresPort('PORT=3000 vite')).toBe(false);
    expect(devScriptDeclaresPort('VITE_PORT=5180 vite')).toBe(false);
    expect(devScriptDeclaresPort('cross-env PORT=3001 react-scripts start')).toBe(false);
  });

  it('returns false when the script leaves the port to us', () => {
    expect(devScriptDeclaresPort('vite dev')).toBe(false);
    expect(devScriptDeclaresPort('next dev')).toBe(false);
    expect(devScriptDeclaresPort('remix vite:dev')).toBe(false);
    expect(devScriptDeclaresPort('')).toBe(false);
    // Must not false-positive on unrelated flags or substrings.
    expect(devScriptDeclaresPort('vite dev --open --host')).toBe(false);
    expect(devScriptDeclaresPort('node --import tsx server.ts')).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // ADVERSARIAL (HYP-462 audit): probe the regex for the false-positives /
  // false-negatives named in the audit brief. The blast radius is small — a
  // false positive only means we skip injecting --port and rely on stdout
  // port-detection (_maybeUpdatePortFromOutput) instead, which usually self-heals.
  // These are documented as expectations of the CURRENT behaviour, not bugs.
  describe('adversarial edge cases', () => {
    it('does not match flags that merely START with -p (--public, --print)', () => {
      // `-p` branch requires (^|\s)-p, so the leading `--` of --public/--print blocks it.
      expect(devScriptDeclaresPort('vite --public 3000')).toBe(false);
      expect(devScriptDeclaresPort('tsx --print 3')).toBe(false);
    });

    it('does not match --port with no following number', () => {
      expect(devScriptDeclaresPort('vite dev --port')).toBe(false);
      expect(devScriptDeclaresPort('vite dev --port --host')).toBe(false);
      expect(devScriptDeclaresPort('vite dev --port=')).toBe(false);
    });

    it('does not match -p used as a non-port flag (project/path) with a non-digit value', () => {
      // tsc -p tsconfig.json, tsx watch -p ./dir — value is not a digit, so no match.
      expect(devScriptDeclaresPort('tsc -p tsconfig.json')).toBe(false);
      expect(devScriptDeclaresPort('tsx watch -p ./src')).toBe(false);
    });

    it('does not match a flag whose name merely embeds "port"', () => {
      // --port-prefix / --portal would only match if followed directly by [=\s]+\d.
      expect(devScriptDeclaresPort('my-cli --port-prefix 80')).toBe(false);
      expect(devScriptDeclaresPort('my-cli --portal 3000')).toBe(false);
    });

    // KNOWN/ACCEPTED false positives — documenting that they DO trigger a skip.
    // Not worth fixing (would require shell parsing); blast radius is benign
    // because stdout port-detection recovers the real bound port.
    it('FALSE POSITIVE (accepted): --port belonging to a co-process under concurrently', () => {
      // The --port here belongs to a sidecar proxy, not the dev server, but the
      // regex cannot tell. We skip injection; stdout detection saves us.
      expect(devScriptDeclaresPort('concurrently "vite" "node proxy.js --port 9000"')).toBe(true);
    });

    it('FALSE POSITIVE (accepted): --port inside a quoted, unrelated value', () => {
      expect(devScriptDeclaresPort('vite dev --config "server --port 3000"')).toBe(true);
    });

    it('matches -p directly after a shell separator (&&, ;)', () => {
      // (^|\s) only allows start-of-string or whitespace before -p, so a -p glued
      // to a separator without a space is NOT matched. Documenting the boundary.
      expect(devScriptDeclaresPort('build && next -p 4000')).toBe(true); // space before -p
      expect(devScriptDeclaresPort('build &&next -p 4000')).toBe(true); // still has space before -p
    });
  });
});

describe('devScriptUsesWrapper', () => {
  // HYP-547: monorepo task runners (nx, turbo, pnpm -r, …) wrap the real dev
  // process. A `--port` appended to `bun run dev` reaches the WRAPPER (nx/bun),
  // not the underlying vite/next/astro, so it never binds the port we asked for.
  // Detecting the wrapper lets start() skip the blind injection and fall back to
  // stdout port auto-detection (_maybeUpdatePortFromOutput), which works because
  // vite still prints `http://localhost:PORT`.
  it('detects nx task-runner wrappers', () => {
    expect(devScriptUsesWrapper('nx run conloca-website:dev --outputStyle=stream')).toBe(true);
    expect(devScriptUsesWrapper('nx run @conloca/conloca-app:dev')).toBe(true);
    expect(devScriptUsesWrapper('nx run-many --target=dev')).toBe(true);
    expect(devScriptUsesWrapper('nx dev my-app')).toBe(true);
  });

  it('detects turbo wrappers', () => {
    expect(devScriptUsesWrapper('turbo run dev')).toBe(true);
    expect(devScriptUsesWrapper('turbo dev --filter=web')).toBe(true);
  });

  it('detects pnpm recursive / filtered wrappers', () => {
    expect(devScriptUsesWrapper('pnpm -r dev')).toBe(true);
    expect(devScriptUsesWrapper('pnpm --recursive run dev')).toBe(true);
    expect(devScriptUsesWrapper('pnpm --filter web dev')).toBe(true);
  });

  it('detects yarn workspace wrappers', () => {
    expect(devScriptUsesWrapper('yarn workspace web dev')).toBe(true);
    expect(devScriptUsesWrapper('yarn workspaces foreach run dev')).toBe(true);
  });

  it('detects lerna and npm-run-all wrappers', () => {
    expect(devScriptUsesWrapper('lerna run dev')).toBe(true);
    expect(devScriptUsesWrapper('npm-run-all -p dev:*')).toBe(true);
    expect(devScriptUsesWrapper('run-p dev:client dev:server')).toBe(true);
    expect(devScriptUsesWrapper('run-s build dev')).toBe(true);
  });

  it('returns false for direct dev-server invocations', () => {
    expect(devScriptUsesWrapper('vite dev')).toBe(false);
    expect(devScriptUsesWrapper('vite')).toBe(false);
    expect(devScriptUsesWrapper('next dev')).toBe(false);
    expect(devScriptUsesWrapper('remix vite:dev')).toBe(false);
    expect(devScriptUsesWrapper('astro dev')).toBe(false);
    expect(devScriptUsesWrapper('react-scripts start')).toBe(false);
    expect(devScriptUsesWrapper('')).toBe(false);
    // Must not false-positive on substrings: a component named "turbofan",
    // a flag --next, a path containing nx, etc.
    expect(devScriptUsesWrapper('vite dev --turbofan')).toBe(false);
    expect(devScriptUsesWrapper('node ./scripts/lernaesque.js')).toBe(false);
  });
});

describe('portInjectionArgs', () => {
  // HYP-547: the actual decision start() makes. Tested as a pure function so the
  // wiring (not just the predicate) is covered without spawning a process.
  it('injects --port for direct vite', () => {
    expect(portInjectionArgs('vite', 'vite dev', 5173)).toEqual(['--port', '5173']);
  });

  it('injects --port for direct remix', () => {
    expect(portInjectionArgs('remix', 'remix vite:dev', 5173)).toEqual(['--port', '5173']);
  });

  it('injects -p for direct nextjs', () => {
    expect(portInjectionArgs('nextjs', 'next dev', 3000)).toEqual(['-p', '3000']);
  });

  it('injects --port for direct webpack', () => {
    expect(portInjectionArgs('webpack', 'webpack serve', 3000)).toEqual(['--port', '3000']);
  });

  it('injects nothing for cra (reads PORT env var)', () => {
    expect(portInjectionArgs('cra', 'react-scripts start', 3000)).toEqual([]);
  });

  it('injects nothing for bun type', () => {
    expect(portInjectionArgs('bun', 'bun run server.ts', 3000)).toEqual([]);
  });

  it('skips injection when the script already declares its own port', () => {
    expect(portInjectionArgs('vite', 'vite dev --port 4000', 5173)).toEqual([]);
    expect(portInjectionArgs('nextjs', 'next dev -p 4001', 3000)).toEqual([]);
  });

  it('skips injection for an nx-wrapped vite dev script (the HYP-547 bug)', () => {
    // Without the wrapper guard this returned ['--port','5173'], which got
    // appended after `bun run dev` and clobbered onto nx instead of vite.
    expect(portInjectionArgs('vite', 'nx run conloca-website:dev --outputStyle=stream', 5173)).toEqual([]);
  });

  it('skips injection for a turbo-wrapped nextjs dev script', () => {
    expect(portInjectionArgs('nextjs', 'turbo run dev --filter=web', 3000)).toEqual([]);
  });
});

describe('isDynamicImportStalenessMessage', () => {
  // HYP-758 / task #38: Bun emits a "not a dynamic import" line when HMR falls out of sync
  // for a module that was not bundled as a dynamic import. The predicate must match it (and
  // the generic "HMR stale" variant) while rejecting normal log output so we don't
  // restart the server on every build line.
  it('matches the Bun "not a dynamic import" signature (exact phrase)', () => {
    expect(isDynamicImportStalenessMessage('[HMR] /src/App.tsx is not a dynamic import')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(isDynamicImportStalenessMessage('NOT A DYNAMIC IMPORT in module')).toBe(true);
    expect(isDynamicImportStalenessMessage('HMR STALE: /src/Component.tsx')).toBe(true);
  });

  it('matches the "HMR stale" variant', () => {
    expect(isDynamicImportStalenessMessage('[vite] HMR stale — full reload required')).toBe(true);
  });

  it('does not match ordinary HMR update lines', () => {
    expect(isDynamicImportStalenessMessage('[vite] hmr update /src/App.tsx')).toBe(false);
    expect(isDynamicImportStalenessMessage('page reload /src/App.tsx')).toBe(false);
    expect(isDynamicImportStalenessMessage('compiled successfully')).toBe(false);
    expect(isDynamicImportStalenessMessage('waiting for a connection...')).toBe(false);
    expect(isDynamicImportStalenessMessage('')).toBe(false);
  });
});

describe('DevServerManager', () => {
  let manager: InstanceType<typeof DevServerManager>;

  beforeEach(() => {
    manager = new DevServerManager('/test-project');
  });

  describe('initial state', () => {
    it('starts with stopped status', () => {
      const state = manager.getState();
      expect(state.status).toBe('stopped');
      expect(state.port).toBeUndefined();
      expect(state.url).toBeUndefined();
    });

    it('has empty logs', () => {
      expect(manager.getLogs()).toEqual([]);
      expect(manager.hasErrors).toBe(false);
    });

    it('has no runtime error', () => {
      expect(manager.runtimeError).toBeNull();
    });
  });

  describe('callbacks', () => {
    it('onStatusChange fires on status updates', async () => {
      const cb = mock();
      manager.onStatusChange(cb);

      // Trigger via stop() which calls _updateStatus('stopped')
      await manager.stop();
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'stopped' }));
    });

    it('onRuntimeErrorChange fires on setRuntimeError', () => {
      const cb = mock();
      manager.onRuntimeErrorChange(cb);

      const err = { message: 'Cannot read property', stack: 'at App.tsx:10' };
      manager.setRuntimeError(err as never);
      expect(cb).toHaveBeenCalledWith(err);
      expect(manager.runtimeError).toEqual(err);

      manager.setRuntimeError(null);
      expect(cb).toHaveBeenCalledWith(null);
      expect(manager.runtimeError).toBeNull();
    });
  });

  describe('stop', () => {
    it('stops the preview proxy before terminating the dev server process', async () => {
      const events: string[] = [];
      const proxy = {
        stop: mock(() => {
          events.push('proxy.stop');
        }),
      };
      const proc = {
        killed: false,
        kill: mock((signal: string) => {
          events.push(`process.kill:${signal}`);
          proc.killed = true;
          return true;
        }),
        once: mock((event: string, callback: () => void) => {
          expect(event).toBe('exit');
          queueMicrotask(callback);
          return proc;
        }),
      };

      Object.assign(manager, {
        _previewProxy: proxy,
        _process: proc,
        _port: 5173,
      });

      await manager.stop();

      expect(events).toEqual(['proxy.stop', 'process.kill:SIGTERM']);
    });

    it('does not let an old stop clear a replacement process', async () => {
      let resolveOldExit: (() => void) | null = null;
      const oldProxy = { stop: mock() };
      const oldProc = {
        killed: false,
        kill: mock(() => {
          oldProc.killed = true;
          return true;
        }),
        once: mock((_event: string, callback: () => void) => {
          resolveOldExit = callback;
          return oldProc;
        }),
      };
      Object.assign(manager, {
        _previewProxy: oldProxy,
        _process: oldProc,
        _port: 5173,
      });

      const stopPromise = manager.stop();
      await Promise.resolve();

      const replacementProxy = { stop: mock() };
      const replacementProc = {
        killed: false,
        kill: mock(() => true),
        once: mock(() => replacementProc),
      };
      Object.assign(manager, {
        _previewProxy: replacementProxy,
        _process: replacementProc,
        _port: 5174,
      });

      resolveOldExit?.();
      await stopPromise;

      expect(oldProxy.stop).toHaveBeenCalled();
      expect(replacementProxy.stop).not.toHaveBeenCalled();
      expect((manager as unknown as { _process: unknown })._process).toBe(replacementProc);
      expect((manager as unknown as { _port: number })._port).toBe(5174);
    });
  });

  describe('setProjectPath', () => {
    it('stops the old server and clears project-scoped state', async () => {
      const proxy = { stop: mock() };
      const proc = {
        killed: false,
        kill: mock(() => {
          proc.killed = true;
          return true;
        }),
        once: mock((_event: string, callback: () => void) => {
          queueMicrotask(callback);
          return proc;
        }),
      };
      Object.assign(manager, {
        _previewProxy: proxy,
        _process: proc,
        _port: 5173,
      });
      manager.setRuntimeError({ message: 'old error' } as never);
      (manager as unknown as { _appendLog(text: string): void })._appendLog('old log\n');

      await manager.setProjectPath('/next-project');

      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(proxy.stop).toHaveBeenCalled();
      expect(manager.runtimeError).toBeNull();
      expect(manager.getLogs()).toEqual([]);
      expect((manager as unknown as { _projectPath: string })._projectPath).toBe('/next-project');
    });

    // HYP-420: an explicitly pinned sub-project path must survive start()'s
    // _syncProjectPathWithWorkspace, which would otherwise reset it to the VS Code
    // workspace folder (the monorepo root, which has no runnable dev script).
    it('pins the path so _syncProjectPathWithWorkspace does not reset it', async () => {
      await manager.setProjectPath('/repo/targets/conloca-app');
      expect((manager as unknown as { _projectPathPinned: boolean })._projectPathPinned).toBe(true);

      await (manager as unknown as { _syncProjectPathWithWorkspace(): Promise<void> })._syncProjectPathWithWorkspace();

      expect((manager as unknown as { _projectPath: string })._projectPath).toBe('/repo/targets/conloca-app');
    });
  });

  describe('clearLogs', () => {
    it('clears log buffer and resets error flag', () => {
      // We need to access _appendLog indirectly. Use the callback to verify.
      const logCb = mock();
      manager.onLogsUpdate(logCb);

      manager.clearLogs();
      expect(manager.getLogs()).toEqual([]);
      expect(manager.hasErrors).toBe(false);
      expect(logCb).toHaveBeenCalledWith([], false);
    });
  });

  describe('log parsing via _appendLog', () => {
    // _appendLog is private, but we can test it through the start() flow
    // or by accessing it via prototype. For unit testing, we'll use
    // the prototype trick since we can't easily mock spawn.

    function appendLog(mgr: InstanceType<typeof DevServerManager>, text: string) {
      // Access private method for testing
      (mgr as unknown as { _appendLog(text: string): void })._appendLog(text);
    }

    it('splits text into lines and creates log entries', () => {
      appendLog(manager, 'line1\nline2\n');
      const logs = manager.getLogs();
      expect(logs).toHaveLength(2);
      expect(logs[0].line).toBe('line1');
      expect(logs[1].line).toBe('line2');
    });

    it('detects error patterns', () => {
      const errorCb = mock();
      manager.onError(errorCb);

      appendLog(manager, 'error TS2345: Argument of type...\n');
      expect(manager.hasErrors).toBe(true);
      expect(manager.getLogs()[0].isError).toBe(true);
      expect(errorCb).toHaveBeenCalled();
    });

    it('resets hasErrors on success pattern', () => {
      appendLog(manager, 'error TS2345: something\n');
      expect(manager.hasErrors).toBe(true);

      appendLog(manager, 'compiled successfully\n');
      expect(manager.hasErrors).toBe(false);
    });

    it('trims log buffer to MAX_LOG_ENTRIES', () => {
      // Append 250 lines (MAX_LOG_ENTRIES = 200)
      const lines = `${Array.from({ length: 250 }, (_, i) => `line-${i}`).join('\n')}\n`;
      appendLog(manager, lines);
      expect(manager.getLogs().length).toBeLessThanOrEqual(200);
    });

    it('notifies onLogsUpdate callback', () => {
      const logCb = mock();
      manager.onLogsUpdate(logCb);

      appendLog(manager, 'hello\n');
      expect(logCb).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ line: 'hello' })]), false);
    });
  });

  describe('_buildCommand', () => {
    function buildCommand(mgr: InstanceType<typeof DevServerManager>, pm: string, script: string) {
      return (
        mgr as unknown as { _buildCommand(pm: string, script: string): { cmd: string; args: string[] } }
      )._buildCommand(pm, script);
    }

    function buildCommandWithScriptArgs(pm: 'npm' | 'yarn' | 'pnpm' | 'bun', args: string[]) {
      const command = buildCommand(manager, pm, 'dev');
      appendScriptCliArgs(command, pm, args);
      return command;
    }

    it('builds npm command', () => {
      expect(buildCommand(manager, 'npm', 'dev')).toEqual({ cmd: 'npm', args: ['run', 'dev'] });
    });

    it('builds bun command', () => {
      expect(buildCommand(manager, 'bun', 'dev')).toEqual({ cmd: 'bun', args: ['run', 'dev'] });
    });

    it('builds pnpm command', () => {
      expect(buildCommand(manager, 'pnpm', 'dev')).toEqual({ cmd: 'pnpm', args: ['run', 'dev'] });
    });

    it('builds yarn command (no run)', () => {
      expect(buildCommand(manager, 'yarn', 'dev')).toEqual({ cmd: 'yarn', args: ['dev'] });
    });

    it('uses npm argument separator for script CLI args', () => {
      expect(buildCommandWithScriptArgs('npm', ['--port', '5173'])).toEqual({
        cmd: 'npm',
        args: ['run', 'dev', '--', '--port', '5173'],
      });
    });

    it('passes pnpm script CLI args without a literal separator', () => {
      expect(buildCommandWithScriptArgs('pnpm', ['--port', '5173'])).toEqual({
        cmd: 'pnpm',
        args: ['run', 'dev', '--port', '5173'],
      });
    });

    it('passes yarn script CLI args without a literal separator', () => {
      expect(buildCommandWithScriptArgs('yarn', ['--port', '5173'])).toEqual({
        cmd: 'yarn',
        args: ['dev', '--port', '5173'],
      });
    });

    it('passes bun script CLI args without a literal separator', () => {
      expect(buildCommandWithScriptArgs('bun', ['--port', '5173'])).toEqual({
        cmd: 'bun',
        args: ['run', 'dev', '--port', '5173'],
      });
    });
  });

  describe('dependency repair detection', () => {
    it('detects missing rolldown optional native binding crashes', () => {
      expect(shouldRepairDependencies("Cannot find module '@rolldown/binding-darwin-arm64'", [])).toBe(true);
    });

    it('does not repair ordinary syntax errors', () => {
      expect(shouldRepairDependencies('Unexpected token in client/pages/Index.tsx', [])).toBe(false);
    });

    it('builds package-manager install commands for dependency repair', () => {
      expect(buildInstallCommand('pnpm')).toEqual({ cmd: 'pnpm', args: ['install', '--force'] });
      expect(buildInstallCommand('npm')).toEqual({ cmd: 'npm', args: ['install'] });
      expect(buildInstallCommand('yarn')).toEqual({ cmd: 'yarn', args: ['install'] });
      expect(buildInstallCommand('bun')).toEqual({ cmd: 'bun', args: ['install'] });
    });
  });

  describe('dispose', () => {
    it('does not throw when called on fresh instance', () => {
      expect(() => manager.dispose()).not.toThrow();
    });
  });

  describe('_waitForReady preserves an already-described error (HYP-1140 review: no clobbering)', () => {
    function transition(mgr: InstanceType<typeof DevServerManager>, to: DevServerStatus, error?: string) {
      (mgr as unknown as { transition(to: DevServerStatus, error?: string): boolean }).transition(to, error);
    }

    function waitForReady(mgr: InstanceType<typeof DevServerManager>, timeout: number): Promise<void> {
      return (mgr as unknown as { _waitForReady(timeout: number): Promise<void> })._waitForReady(timeout);
    }

    it('rethrows the specific `_error` verbatim when status is already `error` (child "error" handler already ran)', async () => {
      // Mirrors production: child.on('error') already transitioned to 'error' with a
      // fully-described, hinted message BEFORE _waitForReady's poll loop notices.
      transition(manager, 'starting');
      transition(
        manager,
        'error',
        'spawn pnpm ENOENT — Could not find "pnpm" on your PATH. If you just installed it, fully restart VS Code (a reload is not enough) so it picks up the updated PATH.',
      );

      await expect(waitForReady(manager, 50)).rejects.toThrow(/Could not find "pnpm" on your PATH/);
    });

    it('falls back to the generic "Server failed to start" when status is `stopped` (a clean exit, no prior specific error)', async () => {
      transition(manager, 'starting');
      transition(manager, 'stopped');

      await expect(waitForReady(manager, 50)).rejects.toThrow('Server failed to start');
    });
  });

  describe('_describeStartFailure (HYP-1140)', () => {
    function describeStartFailure(
      mgr: InstanceType<typeof DevServerManager>,
      rawMessage: string,
      exitCode: number | null = null,
    ): string {
      return (
        mgr as unknown as { _describeStartFailure(rawMessage: string, exitCode?: number | null): string }
      )._describeStartFailure(rawMessage, exitCode);
    }

    it('passes a raw message through unchanged when no hint applies', () => {
      expect(describeStartFailure(manager, 'Server startup timeout')).toBe('Server startup timeout');
    });

    it('appends the hint to the returned message without dropping the raw text', () => {
      const result = describeStartFailure(manager, 'spawn npm ENOENT');
      expect(result).toContain('spawn npm ENOENT');
      expect(result).toContain('Could not find "npm" on your PATH');
    });

    it('also pushes the hint through the log pipeline (onLogsUpdate) as an ERROR entry — review finding: DevServerState.error alone is not read by the auto-start path, and an unflagged line would disagree with the diagnostics UI', () => {
      const logCb = mock();
      manager.onLogsUpdate(logCb);

      describeStartFailure(manager, 'spawn bun ENOENT');

      expect(logCb).toHaveBeenCalled();
      const [newEntries, hasErrors] = logCb.mock.calls[logCb.mock.calls.length - 1] as [
        Array<{ line: string; isError: boolean }>,
        boolean,
      ];
      const hintEntry = newEntries.find((entry) => entry.line.includes('Could not find "bun" on your PATH'));
      expect(hintEntry).toBeDefined();
      expect(hintEntry?.isError).toBe(true);
      expect(hasErrors).toBe(true);
      expect(manager.hasErrors).toBe(true);
    });
  });

  describe('_transitionToStoppedUnlessErrorAlready (HYP-1140 review: exit must not clobber a described error)', () => {
    function transition(mgr: InstanceType<typeof DevServerManager>, to: DevServerStatus, error?: string) {
      (mgr as unknown as { transition(to: DevServerStatus, error?: string): boolean }).transition(to, error);
    }

    function transitionToStoppedUnlessErrorAlready(mgr: InstanceType<typeof DevServerManager>): void {
      (mgr as unknown as { _transitionToStoppedUnlessErrorAlready(): void })._transitionToStoppedUnlessErrorAlready();
    }

    it("does NOT clobber an already-described \"error\" state (mirrors child.on('exit') firing after child.on('error'))", () => {
      transition(manager, 'starting');
      transition(manager, 'error', 'spawn npm ENOENT — Could not find "npm" on your PATH...');

      transitionToStoppedUnlessErrorAlready(manager);

      expect(manager.getState().status).toBe('error');
      expect(manager.getState().error).toContain('Could not find "npm" on your PATH');
    });

    it('transitions to "stopped" normally when there is no prior "error" state (the ordinary clean-exit path)', () => {
      transition(manager, 'starting');

      transitionToStoppedUnlessErrorAlready(manager);

      expect(manager.getState().status).toBe('stopped');
    });
  });

  describe('recompile gate', () => {
    function appendLog(mgr: InstanceType<typeof DevServerManager>, text: string) {
      (mgr as unknown as { _appendLog(text: string): void })._appendLog(text);
    }

    function fireRecompileDetector(mgr: InstanceType<typeof DevServerManager>, text: string) {
      // Mirrors the path in the stdout/stderr handlers — they call
      // _maybeResolveRecompileGate(clean) on every chunk.
      (mgr as unknown as { _maybeResolveRecompileGate(text: string): void })._maybeResolveRecompileGate(text);
    }

    it('awaitRecompile is a no-op when no gate is armed', async () => {
      // Should resolve immediately
      await manager.awaitRecompile();
    });

    it('arm gate → fire compiled successfully → ready resolves', async () => {
      manager.armRecompileGate();

      let resolved = false;
      const wait = manager.awaitRecompile().then(() => {
        resolved = true;
      });

      // Microtask flush: gate is armed, awaiter must NOT be resolved yet
      await Promise.resolve();
      expect(resolved).toBe(false);

      fireRecompileDetector(manager, 'webpack 5.89.0 compiled successfully in 412 ms\n');
      await wait;
      expect(resolved).toBe(true);
    });

    it('ignores chunks without `compiled successfully`', async () => {
      manager.armRecompileGate();

      let resolved = false;
      const wait = manager.awaitRecompile().then(() => {
        resolved = true;
      });

      fireRecompileDetector(manager, 'wait until bundle finished\n');
      await Promise.resolve();
      expect(resolved).toBe(false);

      fireRecompileDetector(manager, 'compiled successfully\n');
      await wait;
      expect(resolved).toBe(true);
    });

    it('re-arming releases the previous gate so old awaiters do not deadlock', async () => {
      manager.armRecompileGate();
      const firstWait = manager.awaitRecompile();

      // Re-arm; previous gate should be released.
      manager.armRecompileGate();
      await firstWait; // must not hang

      // Fresh gate is still pending — fire to release.
      fireRecompileDetector(manager, 'compiled successfully\n');
      await manager.awaitRecompile();
    });

    it('case-insensitive match — Webpack capitalizes the line in CRA 5', async () => {
      manager.armRecompileGate();
      fireRecompileDetector(manager, 'Compiled successfully!\n');
      await manager.awaitRecompile();
    });

    it('logs flowing through _appendLog do not accidentally release the gate', async () => {
      // _appendLog only buffers/categorizes — it must NOT advance the gate.
      // The gate is driven only by stdout/stderr handlers via _maybeResolveRecompileGate.
      manager.armRecompileGate();

      appendLog(manager, 'compiled successfully\n');
      // Race the gate against a microtask; gate must still be pending.
      const settled = await Promise.race([manager.awaitRecompile().then(() => 'resolved'), Promise.resolve('pending')]);
      expect(settled).toBe('pending');
    });

    // HYP-370 Phase 3 — recompile surfaced as an explicit sub-state so consumers
    // can tell stable-serving (`running`) from mid-recompile WITHOUT reaching into
    // the recompile-gate promise.
    describe('recompiling sub-state (HYP-370 Phase 3)', () => {
      function transition(mgr: InstanceType<typeof DevServerManager>, to: DevServerStatus, error?: string) {
        (mgr as unknown as { transition(to: DevServerStatus, error?: string): boolean }).transition(to, error);
      }

      it('getState().recompiling reflects the gate: false → armed=true → released=false', async () => {
        // Force `running` so the reported state isolates the recompiling flag.
        transition(manager, 'starting');
        transition(manager, 'running');

        expect(manager.getState().recompiling).toBe(false);

        manager.armRecompileGate();
        expect(manager.getState().status).toBe('running'); // status unchanged — additive
        expect(manager.getState().recompiling).toBe(true);

        fireRecompileDetector(manager, 'compiled successfully\n');
        await manager.awaitRecompile();
        expect(manager.getState().recompiling).toBe(false);
      });

      it('onStatusChange fires with recompiling:true on arm and recompiling:false on release', async () => {
        transition(manager, 'starting');
        transition(manager, 'running');

        const cb = mock();
        manager.onStatusChange(cb);

        manager.armRecompileGate();
        expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'running', recompiling: true }));

        cb.mockClear();
        fireRecompileDetector(manager, 'compiled successfully\n');
        await manager.awaitRecompile();
        expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'running', recompiling: false }));
      });

      it('re-arming keeps recompiling:true (the new patch supersedes, still mid-recompile)', async () => {
        transition(manager, 'starting');
        transition(manager, 'running');

        manager.armRecompileGate();
        manager.armRecompileGate(); // supersede
        expect(manager.getState().recompiling).toBe(true);

        fireRecompileDetector(manager, 'compiled successfully\n');
        await manager.awaitRecompile();
        expect(manager.getState().recompiling).toBe(false);
      });

      it('recompiling is false when no gate has ever been armed', () => {
        expect(manager.getState().recompiling).toBe(false);
      });

      it('recompiling is false once the server leaves `running`, even if a gate is still armed', () => {
        // A gate armed while running, then a crash/stop leaves _recompileGate non-null.
        // The reported sub-state must NOT claim "recompiling" when we are no longer
        // serving — "mid-recompile" only means anything while running.
        transition(manager, 'starting');
        transition(manager, 'running');
        manager.armRecompileGate();
        expect(manager.getState().recompiling).toBe(true);

        transition(manager, 'stopped'); // process exited / user stopped
        expect(manager.getState().status).toBe('stopped');
        expect(manager.getState().recompiling).toBe(false);
      });
    });
  });

  describe('status transition guard (HYP-370 Phase 2)', () => {
    // The status field is now a guarded machine: only legal edges (plus idempotent
    // self-loops) are applied + published; illegal cross-state jumps are no-ops and
    // do NOT fire onStatusChange. Drive the private transition() directly.
    function transition(mgr: InstanceType<typeof DevServerManager>, to: DevServerStatus, error?: string) {
      (mgr as unknown as { transition(to: DevServerStatus, error?: string): boolean }).transition(to, error);
    }
    function statusOf(mgr: InstanceType<typeof DevServerManager>) {
      return mgr.getState().status;
    }

    it('rejects an illegal cross-state jump (stopped -> running without starting) and does NOT fire onStatusChange', () => {
      const cb = mock();
      manager.onStatusChange(cb);

      expect(statusOf(manager)).toBe('stopped');
      transition(manager, 'running');

      expect(statusOf(manager)).toBe('stopped'); // status unchanged
      expect(cb).not.toHaveBeenCalled(); // listeners not notified
    });

    it('rejects running <- error and starting <- running jumps too', () => {
      const cb = mock();
      manager.onStatusChange(cb);

      // error -> running is illegal
      transition(manager, 'starting');
      transition(manager, 'error', 'boom');
      cb.mockClear();
      transition(manager, 'running');
      expect(statusOf(manager)).toBe('error');
      expect(cb).not.toHaveBeenCalled();
    });

    it('applies a legal transition path and fires onStatusChange with the payload', () => {
      const cb = mock();
      manager.onStatusChange(cb);

      transition(manager, 'starting');
      expect(statusOf(manager)).toBe('starting');
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'starting' }));

      cb.mockClear();
      transition(manager, 'running');
      expect(statusOf(manager)).toBe('running');
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'running' }));
    });

    it('preserves the error payload on a legal -> error transition (getState().error)', () => {
      transition(manager, 'starting');
      transition(manager, 'error', 'spawn failed');
      const state = manager.getState();
      expect(state.status).toBe('error');
      expect(state.error).toBe('spawn failed');
    });

    it('startup crash path: starting -> stopped (exit) -> error (catch) still surfaces the error', () => {
      // A dev command that exits before readiness: the exit handler sets `stopped`,
      // then start()'s catch surfaces the failure as `error`. stopped -> error must
      // be legal so the UI keeps the failure state + message (regression guard).
      const cb = mock();
      manager.onStatusChange(cb);

      transition(manager, 'starting');
      transition(manager, 'stopped'); // process exited during _waitForReady
      cb.mockClear();
      transition(manager, 'error', 'Server failed to start');

      const state = manager.getState();
      expect(state.status).toBe('error');
      expect(state.error).toBe('Server failed to start');
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', error: 'Server failed to start' }));
    });

    it('allows the stopped -> stopped self-loop to re-publish (idempotent, contract-preserving)', () => {
      const cb = mock();
      manager.onStatusChange(cb);

      expect(statusOf(manager)).toBe('stopped');
      transition(manager, 'stopped');
      expect(statusOf(manager)).toBe('stopped');
      // Self-loop is legal — matches today's always-fire behavior on stop() of a fresh instance
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'stopped' }));
    });
  });

  describe('port auto-detection via _maybeUpdatePortFromOutput', () => {
    function firePortDetector(mgr: InstanceType<typeof DevServerManager>, text: string) {
      (mgr as unknown as { _maybeUpdatePortFromOutput(text: string): void })._maybeUpdatePortFromOutput(text);
    }

    it('updates proxy target when dev server binds to a different port than assigned', () => {
      const setTargetPort = mock();
      const proxy = { setTargetPort };
      Object.assign(manager, { _previewProxy: proxy, _port: 5174 });

      // Bun.serve output: "http://localhost:3000"
      firePortDetector(manager, '✨ CMS dev server running at http://localhost:3000');

      expect(setTargetPort).toHaveBeenCalledWith(3000);
      expect((manager as unknown as { _port: number })._port).toBe(3000);
    });

    it('does not call setTargetPort when detected port matches assigned port', () => {
      const setTargetPort = mock();
      Object.assign(manager, { _previewProxy: { setTargetPort }, _port: 5173 });

      firePortDetector(manager, 'Local: http://localhost:5173/');

      expect(setTargetPort).not.toHaveBeenCalled();
    });

    it('is a no-op when _portDetected is already true', () => {
      const setTargetPort = mock();
      Object.assign(manager, { _previewProxy: { setTargetPort }, _port: 5174, _portDetected: true });

      firePortDetector(manager, 'http://localhost:3000');

      expect(setTargetPort).not.toHaveBeenCalled();
    });

    it('is a no-op when no port pattern in output', () => {
      const setTargetPort = mock();
      Object.assign(manager, { _previewProxy: { setTargetPort }, _port: 5174 });

      firePortDetector(manager, 'TypeScript watch started');

      expect(setTargetPort).not.toHaveBeenCalled();
    });

    it('matches 127.0.0.1 as well as localhost', () => {
      const setTargetPort = mock();
      Object.assign(manager, { _previewProxy: { setTargetPort }, _port: 5174 });

      firePortDetector(manager, 'Listening on http://127.0.0.1:3000');

      expect(setTargetPort).toHaveBeenCalledWith(3000);
    });

    it('only fires once — subsequent output does not re-update the port', () => {
      const setTargetPort = mock();
      Object.assign(manager, { _previewProxy: { setTargetPort }, _port: 5174 });

      firePortDetector(manager, 'http://localhost:3000');
      firePortDetector(manager, 'http://localhost:4000');

      expect(setTargetPort).toHaveBeenCalledTimes(1);
      expect(setTargetPort).toHaveBeenCalledWith(3000);
    });

    it('ignores Node/Bun debugger WebSocket URLs (ws://127.0.0.1:9229)', () => {
      const setTargetPort = mock();
      Object.assign(manager, { _previewProxy: { setTargetPort }, _port: 5174 });

      firePortDetector(manager, 'Debugger listening on ws://127.0.0.1:9229/uuid');

      expect(setTargetPort).not.toHaveBeenCalled();
    });

    it('detects low-numbered ports like :80', () => {
      const setTargetPort = mock();
      Object.assign(manager, { _previewProxy: { setTargetPort }, _port: 5174 });

      firePortDetector(manager, 'Server listening at http://localhost:80');

      expect(setTargetPort).toHaveBeenCalledWith(80);
    });

    it('rejects port > 65535', () => {
      const setTargetPort = mock();
      Object.assign(manager, { _previewProxy: { setTargetPort }, _port: 5174 });

      firePortDetector(manager, 'Running at http://localhost:65536');

      expect(setTargetPort).not.toHaveBeenCalled();
    });
  });

  // HYP-758 / task #38: _maybeRestartOnStaleness.
  // The detector fires on the Bun HMR-staleness signature and calls restart() once.
  // It must: (a) only fire when running, (b) skip benign lines, (c) cap at
  // HMR_STALENESS_RESTART_CAP restarts per episode, (d) reset the cap when the
  // episode window expires so a later independent event is not permanently blocked.
  describe('HMR staleness auto-restart (_maybeRestartOnStaleness)', () => {
    type PrivatesHmr = {
      _status: DevServerStatus;
      _hmsRestartsThisEpisode: number;
      _hmrLastRestartAt: number;
      _hmrStalenessGaveUp: boolean;
      _maybeRestartOnStaleness(text: string): void;
    };

    function fireHmr(mgr: InstanceType<typeof DevServerManager>, text: string) {
      (mgr as unknown as PrivatesHmr)._maybeRestartOnStaleness(text);
    }
    function transition(mgr: InstanceType<typeof DevServerManager>, to: DevServerStatus) {
      (mgr as unknown as { transition(to: DevServerStatus): boolean }).transition(to, undefined);
    }
    function setStatus(mgr: InstanceType<typeof DevServerManager>, status: DevServerStatus) {
      (mgr as unknown as PrivatesHmr)._status = status;
    }

    it('calls restart() when the staleness signature fires while running', async () => {
      const restartMock = mock(() => Promise.resolve(manager.getState()));
      Object.assign(manager, { restart: restartMock });
      setStatus(manager, 'running');

      fireHmr(manager, '[HMR] /src/App.tsx is not a dynamic import');

      // restart is fire-and-forget via void; let microtasks settle
      await Promise.resolve();
      expect(restartMock).toHaveBeenCalledTimes(1);
    });

    it('does NOT call restart() for a benign line', async () => {
      const restartMock = mock(() => Promise.resolve(manager.getState()));
      Object.assign(manager, { restart: restartMock });
      setStatus(manager, 'running');

      fireHmr(manager, '[vite] hmr update /src/App.tsx');
      await Promise.resolve();
      expect(restartMock).not.toHaveBeenCalled();
    });

    it('does NOT call restart() when status is not running (staleness is a post-boot condition)', async () => {
      const restartMock = mock(() => Promise.resolve(manager.getState()));
      Object.assign(manager, { restart: restartMock });

      for (const status of ['stopped', 'starting', 'error'] as DevServerStatus[]) {
        setStatus(manager, status);
        fireHmr(manager, '[HMR] /src/App.tsx is not a dynamic import');
        await Promise.resolve();
      }
      expect(restartMock).not.toHaveBeenCalled();
    });

    it('stops auto-restarting once the cap is reached (exactly cap restarts, then sticky give-up)', async () => {
      const restartMock = mock(() => Promise.resolve(manager.getState()));
      Object.assign(manager, { restart: restartMock });
      setStatus(manager, 'running');

      const STALENESS_LINE = '[HMR] /src/App.tsx is not a dynamic import';
      // Fire 10 times — only exactly HMR_STALENESS_RESTART_CAP (3) restarts should happen
      for (let i = 0; i < 10; i++) {
        fireHmr(manager, STALENESS_LINE);
      }
      await Promise.resolve();
      // Exactly cap restarts, not more, not zero.
      expect(restartMock.mock.calls.length).toBe(3);
    });

    it('give-up is sticky — time-window expiry does NOT re-arm restarts while give-up is set', async () => {
      const restartMock = mock(() => Promise.resolve(manager.getState()));
      Object.assign(manager, { restart: restartMock });
      setStatus(manager, 'running');
      const priv = manager as unknown as PrivatesHmr;

      // Hit the cap
      priv._hmsRestartsThisEpisode = 3;
      priv._hmrStalenessGaveUp = true;
      // Mark last restart as well outside the episode window
      priv._hmrLastRestartAt = Date.now() - 70_000;

      // A staleness event — give-up is sticky, must NOT restart
      fireHmr(manager, '[HMR] /src/App.tsx is not a dynamic import');
      await Promise.resolve();
      expect(restartMock).not.toHaveBeenCalled();
    });

    it('give-up clears on a successful running transition so future episodes get a fresh budget', async () => {
      const restartMock = mock(() => Promise.resolve(manager.getState()));
      Object.assign(manager, { restart: restartMock });
      const priv = manager as unknown as PrivatesHmr;

      // Simulate give-up state
      priv._hmsRestartsThisEpisode = 3;
      priv._hmrStalenessGaveUp = true;

      // Simulate a successful server restart (transition to running clears the give-up)
      transition(manager, 'starting');
      transition(manager, 'running');

      // Now a new staleness event should be handled again
      fireHmr(manager, '[HMR] /src/App.tsx is not a dynamic import');
      await Promise.resolve();
      expect(restartMock).toHaveBeenCalledTimes(1);
    });

    it('resets the counter (not the give-up) when the episode window expires before cap is hit', async () => {
      const restartMock = mock(() => Promise.resolve(manager.getState()));
      Object.assign(manager, { restart: restartMock });
      setStatus(manager, 'running');
      const priv = manager as unknown as PrivatesHmr;

      // Cap not yet hit, but some restarts consumed
      priv._hmsRestartsThisEpisode = 2;
      priv._hmrStalenessGaveUp = false;
      // Mark the last restart as well outside the episode window
      priv._hmrLastRestartAt = Date.now() - 70_000;

      // A new staleness event should reset the counter and restart
      fireHmr(manager, '[HMR] /src/App.tsx is not a dynamic import');
      await Promise.resolve();
      expect(restartMock).toHaveBeenCalledTimes(1);
    });
  });

  // Orphan-reap-on-reload: a detached dev server orphaned by a window
  // reload still holds its port; the next start must reap OUR recorded pid before
  // picking a port. These tests exercise the manager's wiring to the registry —
  // the registry's own behavior is covered in services/__tests__/devServerOrphanRegistry.test.ts.
  describe('orphan reap wiring', () => {
    const REAP_PROJECT = '/orphan-reap-project';
    const spawnedPids: number[] = [];

    function spawnSleeper(): number {
      // `sleep` is a clean killable leaf; detached → its own process group (the
      // reaper kills the group via -pid). Avoid process.execPath: under bun that is
      // the bun binary, whose detached children hang the test runner's shutdown.
      const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
      child.unref();
      if (!child.pid) throw new Error('failed to spawn sleeper');
      spawnedPids.push(child.pid);
      return child.pid;
    }
    function hardKill(pid: number): void {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* gone */
        }
      }
    }
    async function waitForDeath(pid: number, timeoutMs = 2000): Promise<boolean> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (!isProcessAlive(pid)) return true;
        await new Promise((r) => setTimeout(r, 25));
      }
      return !isProcessAlive(pid);
    }
    function callReap(mgr: InstanceType<typeof DevServerManager>): void {
      (mgr as unknown as { _reapOrphanedDevServer(): void })._reapOrphanedDevServer();
    }

    // Test hygiene only: the registry is now a bounded HISTORY per project, so
    // there is no single "the" record to clear — sweep every entry currently on
    // file for REAP_PROJECT. Production code never needs this (each caller clears
    // its own specific pid; see DevServerManager.ts), this is purely to keep tests
    // isolated from each other's leftover records.
    function clearAllReapProjectRecords(): void {
      for (const record of readOwnedDevServers(REAP_PROJECT)) {
        clearOwnedDevServer(REAP_PROJECT, record.pid);
      }
    }

    afterEach(() => {
      for (const pid of spawnedPids.splice(0)) hardKill(pid);
      clearAllReapProjectRecords();
    });

    it('_reapOrphanedDevServer kills a live recorded child for this project', async () => {
      const reapManager = new DevServerManager(REAP_PROJECT);
      const pid = spawnSleeper();
      // Record the command we actually spawn (`sleep 30`), not a stand-in, so the
      // registry's `ps` PID-reuse recheck finds the live process's `sleep` token and
      // proceeds with the kill. A mismatching record (e.g. 'bun run dev') would be
      // correctly suppressed as a suspected pid reuse, defeating the test's intent.
      recordOwnedDevServer({ pid, projectPath: REAP_PROJECT, command: 'sleep 30', startedAt: Date.now() });

      callReap(reapManager);

      expect(await waitForDeath(pid)).toBe(true);
      // Record swept so a later start does not re-target a dead/recycled pid.
      expect(readOwnedDevServer(REAP_PROJECT)).toBeNull();
      reapManager.dispose();
    });

    it('_reapOrphanedDevServer is a no-op when no record exists (best-effort, no throw)', () => {
      const reapManager = new DevServerManager(REAP_PROJECT);
      clearAllReapProjectRecords();
      expect(() => callReap(reapManager)).not.toThrow();
      reapManager.dispose();
    });

    it("stop() clears only this manager's own tracked pid, leaving an unrelated recorded generation for the same project intact", async () => {
      // AC: clearOwnedDevServer is pid-specific now — a clean stop() must not wipe
      // OTHER still-pending generations recorded for the same project (e.g. a real
      // orphan left over from an earlier session). Simulate that by recording an
      // unrelated pid FIRST, then giving this manager its own fake tracked child
      // (mirroring the existing "no orphan" test's fakeChild pattern) before
      // stopping it.
      recordOwnedDevServer({ pid: 999999, projectPath: REAP_PROJECT, command: 'bun run dev', startedAt: Date.now() });

      const reapManager = new DevServerManager(REAP_PROJECT);
      const fakeChild = {
        pid: 424242,
        killed: false,
        kill: mock(() => true),
        once: mock((event: string, cb: () => void) => {
          if (event === 'exit') queueMicrotask(cb);
        }),
      };
      recordOwnedDevServer({
        pid: fakeChild.pid,
        projectPath: REAP_PROJECT,
        command: 'bun run dev',
        startedAt: Date.now(),
      });
      (reapManager as unknown as { _process: unknown })._process = fakeChild;

      await reapManager.stop();

      const remaining = readOwnedDevServers(REAP_PROJECT).map((r) => r.pid);
      expect(remaining).toEqual([999999]); // this manager's own pid cleared, sibling intact
      reapManager.dispose();
    });

    it('_killPidGroup terminates a real detached process group', async () => {
      const pid = spawnSleeper();
      const killed = (manager as unknown as { _killPidGroup(pid: number, sig: string): boolean })._killPidGroup(
        pid,
        'SIGKILL',
      );
      expect(killed).toBe(true);
      expect(await waitForDeath(pid)).toBe(true);
    });
  });

  // HYP-52: start()/stop()/restart() were UNSERIALIZED. A concurrent start()+stop()
  // let stop() capture a still-null _process (start had not spawned yet), skip its
  // kill block, and return — then start() spawned a child nobody tracked (orphan)
  // while _waitForReady looped the full 90s (PI-10-21 timed out at 131s). The fix is
  // a single-slot operation queue (_lifecycleOp) so each op runs only after the
  // previous SETTLES, plus a generation/epoch token so an in-flight start bails when
  // a concurrent stop supersedes it. These tests exercise the REAL queue + gen logic.
  describe('lifecycle serialization (#52)', () => {
    // Promise we can resolve from the test to gate a stubbed _runStart/_runStop.
    function deferred<T = void>() {
      let resolve!: (value: T) => void;
      let reject!: (err: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    type Privates = {
      _runStart: (dep?: boolean) => Promise<unknown>;
      _runStop: () => Promise<void>;
      _waitForReady: (timeout: number, gen?: number) => Promise<void>;
      _generation: number;
      _status: DevServerStatus;
      _port: number | null;
      _process: unknown;
    };

    it('runs stop() AFTER start() settles — stop sees the real process, never a null one', async () => {
      // The core fix. Stub the private bodies to record call order and gate on a
      // deferred so we control exactly when start "finishes". If unserialized, stop
      // would begin while start is still in-flight (the #52 race).
      const order: string[] = [];
      const startGate = deferred();
      const priv = manager as unknown as Privates;

      priv._runStart = mock(async () => {
        order.push('start:begin');
        await startGate.promise;
        order.push('start:end');
        return manager.getState();
      });
      priv._runStop = mock(async () => {
        order.push('stop:begin');
        order.push('stop:end');
      });

      const startPromise = manager.start();
      const stopPromise = manager.stop();

      // stop is queued behind start — it must NOT have begun yet.
      await Promise.resolve();
      expect(order).toEqual(['start:begin']);

      startGate.resolve();
      await Promise.all([startPromise, stopPromise]);

      // start fully settles BEFORE stop begins — the serialization guarantee.
      expect(order).toEqual(['start:begin', 'start:end', 'stop:begin', 'stop:end']);
    });

    it('a failing op does not poison the chain — the next op still runs', async () => {
      const order: string[] = [];
      const priv = manager as unknown as Privates;

      priv._runStart = mock(async () => {
        order.push('start');
        throw new Error('boom');
      });
      priv._runStop = mock(async () => {
        order.push('stop');
      });

      // First op rejects; swallow at the call site so the test itself does not throw.
      const startPromise = manager.start().catch(() => {});
      const stopPromise = manager.stop();

      await Promise.all([startPromise, stopPromise]);

      // The .catch(() => {}) on _lifecycleOp kept the chain alive: stop still ran.
      expect(order).toEqual(['start', 'stop']);
    });

    it('the public start() promise still rejects when _runStart rejects (error not swallowed for the caller)', async () => {
      const priv = manager as unknown as Privates;
      priv._runStart = mock(async () => {
        throw new Error('start failed');
      });

      // _lifecycleOp swallows the rejection to protect the NEXT op, but the promise
      // returned to THIS caller must still reject with the real error.
      await expect(manager.start()).rejects.toThrow('start failed');
    });

    it('a rejecting op does not wedge the queue — a same-type follow-up still runs', async () => {
      // Two stop()s where the FIRST _runStop rejects. The chain stores the SWALLOWED
      // `run.catch(() => {})` as _lifecycleOp, so the second op chains off a resolved
      // link and runs regardless of the first's failure. (The .then(f, r) form's
      // rejected handler is belt-and-suspenders for the very first link.) _runStop is
      // dispatched by a counter because the chain reads `this._runStop` lazily at
      // execution time — a single mock would run for both slots (a harness quirk).
      const order: string[] = [];
      const priv = manager as unknown as Privates;
      let call = 0;
      priv._runStop = mock(async () => {
        call += 1;
        if (call === 1) {
          order.push('stop1');
          throw new Error('stop1 failed');
        }
        order.push('stop2');
      });

      const firstStop = manager.stop().catch(() => {});
      const secondStop = manager.stop();

      await Promise.all([firstStop, secondStop]);
      // First op rejected; the chain's .catch kept it alive and the second op ran.
      expect(order).toEqual(['stop1', 'stop2']);
    });

    it('_waitForReady bails immediately when the generation is superseded (no 90s loop)', async () => {
      // The symmetric half of the fix: a concurrent stop bumps _generation, so an
      // in-flight start's poll must throw "superseded" at once instead of looping the
      // full timeout polling a port the stop just tore down.
      const priv = manager as unknown as Privates;
      priv._status = 'starting';
      priv._port = 5173;
      const gen = priv._generation;

      // Simulate a concurrent _runStop bumping the epoch.
      priv._generation = gen + 1;

      // Pass a generous timeout — if the bail did not fire this would hang ~30s.
      // It must reject promptly instead.
      const start = Date.now();
      await expect(priv._waitForReady(30_000, gen)).rejects.toThrow('superseded');
      expect(Date.now() - start).toBeLessThan(2_000);
    });

    it('_waitForReady with NO gen (public waitForReady path) is unaffected by generation', async () => {
      // The public waitForReady() calls _waitForReady(timeout) with no gen, so a stale
      // gen value must NOT make it bail. It returns once status is running.
      const priv = manager as unknown as Privates;
      priv._status = 'running';
      priv._generation = 999; // a value that would "supersede" any captured gen
      await expect(priv._waitForReady(5_000)).resolves.toBeUndefined();
    });

    it('no orphan: with serialization, stop() sees the process start recorded and kills it', async () => {
      // The #52 contract at the unit level. We stub _runStart to spawn a FAKE child and
      // record it on _process (mirroring `this._process = child` in production). Because
      // stop() is serialized AFTER start, the real _runStop runs once _process is set,
      // captures the fake child, and kills it (SIGTERM) — the child is reaped, NOT
      // orphaned. (The full real-spawn proof is the e2e PI-10-21; this is the
      // serialization-level guarantee that makes the orphan impossible.)
      const killed: string[] = [];
      const fakeChild = {
        pid: 4242,
        killed: false,
        kill: mock((signal: string) => {
          killed.push(signal);
          fakeChild.killed = true;
          return true;
        }),
        once: mock((event: string, cb: () => void) => {
          // Resolve the exit wait on the next tick so _runStop's promise settles.
          if (event === 'exit') queueMicrotask(cb);
          return fakeChild;
        }),
      };
      const priv = manager as unknown as Privates;

      priv._runStart = mock(async () => {
        // Mirror production: transition to starting and record the spawned child.
        priv._status = 'starting';
        priv._process = fakeChild;
        priv._port = 5173;
        return manager.getState();
      });

      // Concurrent start + stop — exactly the #52 scenario.
      const startPromise = manager.start();
      const stopPromise = manager.stop();
      await Promise.all([startPromise, stopPromise]);

      // stop ran AFTER start recorded the pid, so it killed the child instead of
      // skipping a null process — no orphan.
      expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
      expect(killed).toContain('SIGTERM');
      expect(priv._process).toBeNull();
    });

    // P0 regression (review follow-up): the pre-spawn supersede branches in _runStart
    // used to `return this.getState()` WITHOUT leaving 'starting'. No child was spawned,
    // so child.on('exit') — the only thing that resets _status to 'stopped' — never
    // fired, stranding _status in 'starting' FOREVER. The next start() then hit the
    // `if (this._status === 'starting') return` guard and permanently no-opped: the dev
    // server could never start again. The fix transitions to 'stopped' before returning.
    it('pre-spawn supersede leaves _status terminal (stopped), not stranded in starting — feature not wedged', async () => {
      // Drive the REAL _runStart (not a stub) into its first pre-spawn supersede branch:
      // make _findFreePort bump _generation mid-flight (mirroring a concurrent _runStop
      // landing while we await port selection), so the `gen !== this._generation` check
      // right after it fires. We use a real temp project with a `dev` script so the
      // ProjectDetector calls before _findFreePort resolve instead of throwing into the
      // catch (which would never reach the supersede branch).
      const fs = await import('node:fs/promises');
      const os = await import('node:os');
      const path = await import('node:path');
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hyp52-supersede-'));
      await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({ name: 'x', scripts: { dev: 'vite' } }));

      const supersedeManager = new DevServerManager(tmp);
      const priv = supersedeManager as unknown as Privates & {
        _findFreePort: (start: number) => Promise<number>;
        _probeHttpServer: (port: number) => Promise<boolean>;
        _syncProjectPathWithWorkspace: () => Promise<void>;
      };

      // Keep the start on the spawn path: the HYP-1160 attach-first probe would
      // otherwise adopt any real HTTP server this dev machine has on :3000.
      priv._probeHttpServer = mock(async () => false);

      // Keep the path stable (no workspace sync side effects).
      priv._syncProjectPathWithWorkspace = mock(async () => {});
      // The supersede trigger: bump the epoch the way a concurrent _runStop would, at the
      // exact await point _runStart re-checks gen against.
      priv._findFreePort = mock(async () => {
        priv._generation += 1; // concurrent stop superseded us
        return 5173;
      });

      await priv._runStart();

      // The real branch ran: status is the coherent terminal 'stopped', NOT stranded in
      // 'starting'. Pre-fix this asserted 'starting' and the manager was wedged.
      expect(priv._status).toBe('stopped');
      expect(priv._status).not.toBe('starting');

      // And the manager is NOT wedged: a subsequent _runStart can proceed PAST the
      // 'starting' guard (it reaches our stubbed _findFreePort again rather than
      // early-returning). Pre-fix, _status==='starting' made this an instant no-op.
      const reached: string[] = [];
      priv._findFreePort = mock(async () => {
        reached.push('findFreePort');
        // Force the supersede again so this second run also unwinds cleanly (we only
        // care that it got past the starting-guard, which a wedged manager never would).
        priv._generation += 1;
        return 5173;
      });
      await priv._runStart();
      expect(reached).toEqual(['findFreePort']);

      supersedeManager.dispose();
      await fs.rm(tmp, { recursive: true, force: true });
    });

    // P1 serialization (review follow-up): the public setProjectPath() used to run
    // _applyProjectPath → _runStop OFF the queue, racing queued _runStart/_runStop and
    // mutating shared _process/_port/_previewProxy/_generation with no serialization
    // (its ++_generation in _runStop superseded in-flight queued starts — the realistic
    // P0 trigger). The fix enqueues setProjectPath's work via _runSetProjectPath. Here we
    // assert it now serializes AFTER an in-flight queued start. Pre-fix the order was
    // ["setProjectPath:begin","setProjectPath:end","start:begin","start:end"] (it ran
    // immediately, concurrently); post-fix start must fully settle first.
    it('setProjectPath serializes onto the lifecycle queue — it waits for an in-flight start to settle', async () => {
      const order: string[] = [];
      const startGate = deferred();
      const priv = manager as unknown as Privates & {
        _runSetProjectPath: (p: string) => Promise<void>;
      };

      priv._runStart = mock(async () => {
        order.push('start:begin');
        await startGate.promise;
        order.push('start:end');
        return manager.getState();
      });
      // Stub the queued body so we observe ordering without touching real _runStop.
      priv._runSetProjectPath = mock(async () => {
        order.push('setProjectPath:begin');
        order.push('setProjectPath:end');
      });

      const startPromise = manager.start();
      const setPromise = manager.setProjectPath('/other');

      // setProjectPath is queued behind the in-flight start — it must NOT have begun.
      await Promise.resolve();
      expect(order).toEqual(['start:begin']);

      startGate.resolve();
      await Promise.all([startPromise, setPromise]);

      // start fully settles BEFORE setProjectPath begins — the serialization guarantee.
      expect(order).toEqual(['start:begin', 'start:end', 'setProjectPath:begin', 'setProjectPath:end']);
    });
  });
});
