"""Run kernel mutants and accept only completed Verus proof rejections.

The pinned verifier's summary, proof diagnostics and completion footer are all
required; crashes or compiler/parser errors cannot become negative-proof evidence.
"""
import pathlib
import re
import subprocess
import sys


def completed_proof_rejection(returncode, log):
    # Exit 1 is the normal verifier rejection; signals and Rust panic exit 101 are not proofs.
    if returncode != 1 or re.search(
        r'\b(panic\w*|internal[ -](?:compiler[ -])?error|segmentation fault|'
        r'segfault|sigabrt|sigsegv|aborted|core dumped|fatal(?: runtime)? error|stack overflow|crashed)\b',
        log, re.IGNORECASE
    ):
        return False
    summaries = re.findall(r'^verification results:: (\d+) verified, (\d+) errors\s*$', log, re.MULTILINE)
    if len(summaries) != 1 or int(summaries[0][1]) == 0:
        return False
    proof = r'error: (?:postcondition not satisfied|assertion failed|invariant not satisfied)\b[^\n]*'
    footer = r'error: aborting due to (\d+) previous errors?'
    errors = re.findall(r'^error[^\n]*', log, re.MULTILINE)
    if not any(re.fullmatch(proof, error) for error in errors):
        return False
    if any(not re.fullmatch(proof, error) and not re.fullmatch(footer, error) for error in errors):
        return False
    completion = re.search('^' + footer + r'\s*\Z', log, re.MULTILINE)
    return completion is not None and int(completion[1]) == int(summaries[0][1])


source = pathlib.Path('src/kernel.rs').read_text()
mutations = {
    'missing-publication': ('self.cells[slot] = value;', 'self.cells[slot] = 0;'),
    'missing-revision': ('self.revision += 1;', 'self.revision += 0;'),
    'reject-all': ('if self.revision != expected {', 'if self.revision == expected || self.revision != expected {'),
}
for name, (before, after) in mutations.items():
    if source.count(before) != 1:
        raise SystemExit(f'{name}: mutation anchor drifted')
    directory = pathlib.Path('target/proof-controls')/name
    directory.mkdir(parents=True, exist_ok=True)
    path = directory/'kernel.rs'
    path.write_text(source.replace(before, after))
    result = subprocess.run([sys.argv[1], str(path), '--crate-type=lib', '--crate-name', 'state_kernel_control'],
                            text=True, capture_output=True, timeout=120)
    log = result.stdout + result.stderr
    (directory/'verus.log').write_text(log)
    if not completed_proof_rejection(result.returncode, log):
        raise SystemExit(f'{name}: expected a verification failure, got exit {result.returncode}\n{log}')
    print(f'PASS: verifier rejected {name}')
