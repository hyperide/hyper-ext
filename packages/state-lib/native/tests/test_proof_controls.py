"""Subprocess regressions for the proof-control gate, run directly or by verify.sh.

Synthetic verifier output tests classification only, not actual Verus proofs.
Diagnostic/summary format follows run 34649916447's pinned Verus artifacts.
"""
import os
from pathlib import Path
import resource
import shlex
import signal
import subprocess
import sys
import tempfile


SUMMARY = 'verification results:: 8 verified, 1 errors\n'
DIAGNOSTIC = 'error: postcondition not satisfied\n'
FOOTER = 'error: aborting due to 1 previous error\n\n'
COMPLETE = SUMMARY + DIAGNOSTIC + FOOTER
CASES = {
    'completed-postcondition': (1, COMPLETE, True),
    'completed-invariant': (1, COMPLETE.replace('postcondition not satisfied',
                                             'invariant not satisfied at end of loop body'), True),
    'completed-assertion': (1, COMPLETE.replace('postcondition not satisfied', 'assertion failed'), True),
    'completed-two-errors': (1, COMPLETE.replace('1 errors', '2 errors').replace(
        '1 previous error', '2 previous errors'), True),
    'zero-success': (0, 'verification results:: 9 verified, 0 errors\n', False),
    'zero-with-failure-output': (0, COMPLETE, False),
    'panic-101': (101, "thread 'main' panicked: assertion failed\n", False),
    'panic-after-diagnostic': (101, COMPLETE + "thread 'main' panicked\n", False),
    'abort-after-diagnostic': (-signal.SIGABRT, COMPLETE, False),
    'segfault-after-diagnostic': (-signal.SIGSEGV, COMPLETE, False),
    'abort-with-assertion': (-signal.SIGABRT, 'assertion failed\n', False),
    'segfault-with-invariant': (-signal.SIGSEGV, 'invariant not satisfied\n', False),
    'wrapped-abort': (134, COMPLETE, False),
    'wrapped-segfault': (139, COMPLETE, False),
    'panic-exit-one': (1, COMPLETE + "thread 'main' panicked at assertion failed\n", False),
    'internal-error': (1, COMPLETE + 'internal compiler error: assertion failed\n', False),
    'internal-before-completion': (1, 'internal error: solver crashed\n' + COMPLETE, False),
    'fatal-before-completion': (1, 'fatal runtime error: stack overflow\n' + COMPLETE, False),
    'aborted-before-completion': (1, 'Aborted\n' + COMPLETE, False),
    'signal-text-before-completion': (1, 'terminated by SIGSEGV\n' + COMPLETE, False),
    'parser-error': (1, 'error: expected expression, found `}`\n', False),
    'parser-after-diagnostic': (1, COMPLETE + 'error: expected expression\n', False),
    'parser-before-completion': (1, 'error: expected expression\n' + COMPLETE, False),
    'truncated-summary': (1, DIAGNOSTIC + 'verification results:: 8 verified, 1 err', False),
    'truncated-footer': (1, SUMMARY + DIAGNOSTIC + 'error: aborting due to', False),
    'absent-summary': (1, DIAGNOSTIC + FOOTER, False),
    'absent-footer': (1, SUMMARY + DIAGNOSTIC, False),
    'quoted-footer': (1, SUMMARY + DIAGNOSTIC + '  12 | // ' + FOOTER, False),
    'zero-errors': (1, COMPLETE.replace('8 verified, 1 errors', '8 verified, 0 errors'), False),
    'absent-diagnostic': (1, SUMMARY + FOOTER, False),
    'quoted-diagnostic': (1, SUMMARY + '  12 | // assertion failed\n' + FOOTER, False),
    'duplicate-summary': (1, SUMMARY + COMPLETE, False),
    'mismatched-error-count': (1, COMPLETE.replace('1 previous error', '2 previous errors'), False),
}


def fixture(name):
    code, output, _ = CASES[name]
    # Real signals exercise subprocess's negative return codes without core files.
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    if output.startswith('verification results::'):
        summary, _, diagnostics = output.partition('\n')
        print(summary, flush=True)
        print(diagnostics, end='', file=sys.stderr, flush=True)
    else:
        print(output, end='', flush=True)
    if code < 0:
        os.kill(os.getpid(), -code)
    raise SystemExit(code)


def main():
    native = Path(__file__).resolve().parents[1]
    modes = [('normal', [], None), ('-O', ['-O'], None),
             ('PYTHONOPTIMIZE=1', [], '1'), ('PYTHONOPTIMIZE=2', [], '2')]
    failures = []
    passed = 0
    with tempfile.TemporaryDirectory(prefix='state-proof-controls-') as directory:
        root = Path(directory)
        (root / 'src').mkdir()
        (root / 'src/kernel.rs').write_bytes((native / 'src/kernel.rs').read_bytes())
        verifier = root / 'synthetic-verifier'
        verifier.write_text('#!/bin/sh\nexec ' + shlex.join(
            [sys.executable, '-B', str(Path(__file__).resolve()), '--fixture']) + ' "$CONTROL_CASE"\n')
        verifier.chmod(0o700)
        for name, (_, output, accepted) in CASES.items():
            for mode, flags, optimize in modes:
                env = os.environ.copy()
                env.pop('PYTHONOPTIMIZE', None)
                if optimize is not None:
                    env['PYTHONOPTIMIZE'] = optimize
                env['CONTROL_CASE'] = name
                result = subprocess.run(
                    [sys.executable, '-B', *flags, str(native / 'tools/proof_controls.py'), str(verifier)],
                    cwd=root, env=env, capture_output=True, text=True, timeout=30)
                if accepted:
                    expected = ''.join(f'PASS: verifier rejected {mutant}\n' for mutant in
                                       ('missing-publication', 'missing-revision', 'reject-all'))
                    valid = result.returncode == 0 and result.stdout == expected and not result.stderr
                else:
                    valid = (result.returncode != 0 and 'PASS:' not in result.stdout and
                             'missing-publication: expected a verification failure' in result.stderr)
                log = root / 'target/proof-controls/missing-publication/verus.log'
                valid = valid and log.read_text() == output
                if valid:
                    passed += 1
                else:
                    failures.append(f'{name} / {mode}: exit={result.returncode}, '
                                    f'stdout={result.stdout!r}, stderr={result.stderr!r}')
    for failure in failures:
        print(f'FAIL: {failure}')
    if failures:
        raise SystemExit(f'FAIL: {len(failures)} controls; {passed} passed (synthetic, not actual proof)')
    print(f'PASS: {passed} proof-classifier controls (synthetic, not actual proof)')


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--fixture':
        fixture(sys.argv[2])
    else:
        main()
