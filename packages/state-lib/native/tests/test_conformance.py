"""Subprocess controls for conformance.py, run directly or by tools/verify.sh.

Fixtures exercise harness validation, not native correctness or Verus proofs.
Verification decisions must survive Python optimization.
"""
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile

from conformance import commit


def fixture(kind):
    cells, revision = [], 0
    for line in sys.stdin:
        if kind == "zero":
            continue
        if kind == "wrong":
            print("wrong")
            continue
        command, *tokens = line.split()
        values = list(map(int, tokens))
        if command == "init":
            revision, _, *cells = values
            status = "init"
        else:
            expected, _, *pairs = values
            status, cells, revision = commit(cells, revision, expected, list(zip(pairs[::2], pairs[1::2])))
        print(status + " " + " ".join(map(str, [revision, *cells])))


def main():
    harness = Path(__file__).with_name("conformance.py")
    modes = [("normal", [], None), ("-O", ["-O"], None),
             ("PYTHONOPTIMIZE=1", [], "1"), ("PYTHONOPTIMIZE=2", [], "2")]
    failures = []
    with tempfile.TemporaryDirectory(prefix="state-conformance-") as directory:
        for kind in ("zero", "wrong", "correct"):
            driver = Path(directory) / kind
            driver.write_text("#!/bin/sh\nexec " + shlex.join(
                [sys.executable, "-B", str(Path(__file__).resolve()), "--fixture", kind]) + "\n")
            driver.chmod(0o700)
            for name, flags, optimize in modes:
                env = os.environ.copy()
                env.pop("PYTHONOPTIMIZE", None)
                if optimize is not None:
                    env["PYTHONOPTIMIZE"] = optimize
                result = subprocess.run([sys.executable, "-B", *flags, str(harness), str(driver)],
                                        env=env, capture_output=True, text=True, timeout=90)
                if kind == "correct":
                    valid = (result.returncode == 0 and result.stderr == "" and result.stdout ==
                             "PASS: 16082 native command results, including 16,000 seeded transactions and edge cases\n")
                else:
                    diagnostic = "(0, 16082, '')" if kind == "zero" else "case 0: init 0 2 1 2\nexpected init 0 1 2\ngot wrong"
                    valid = result.returncode != 0 and "PASS:" not in result.stdout and diagnostic in result.stderr
                label = f"{kind} / {name}"
                if not valid:
                    failures.append(label)
                    print(f"FAIL: {label}: exit={result.returncode}, stdout={result.stdout!r}, stderr={result.stderr!r}")
                else:
                    print(f"PASS: {label}")
    if failures:
        raise SystemExit(f"FAIL: {len(failures)} conformance harness controls")
    print("PASS: 12 conformance harness controls (not native verification)")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--fixture":
        fixture(sys.argv[2])
    else:
        main()
