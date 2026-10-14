#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
VERUS=${VERUS:-verus}
mkdir -p target
python3 -B tests/test_conformance.py | tee target/conformance-controls.log
python3 -B tests/test_proof_controls.py | tee target/proof-classifier-controls.log
"$VERUS" --version | tee target/verus-version.txt
"${VERUS_Z3_PATH:-z3}" --version | tee target/z3-version.txt
# The compiler verifies the same kernel module which this driver links and executes.
"$VERUS" src/main.rs --compile --crate-name state_native --multiple-errors 5 -C opt-level=3 -o target/state-native 2>&1 | tee target/verus.log
python3 tests/conformance.py target/state-native | tee target/conformance.log
python3 tools/proof_controls.py "$VERUS" | tee target/proof-controls.log
python3 - <<'PY'
import hashlib, json, pathlib, re
r = pathlib.Path('.')
log = (r/'target/verus.log').read_text()
match = re.search(r'verification results::\s*(\d+) verified,\s*0 errors', log)
if not match or int(match[1]) == 0:
    raise SystemExit('Missing positive verification summary')
source = (r/'src/kernel.rs').read_bytes()
if re.search(rb'\b(admit|assume|assume_specification|external_body|external|axiom)\b', source):
    raise SystemExit('Local proof escape hatch detected')
report = {
    'schemaVersion': 1,
    'scope': 'native/src/kernel.rs executable source contracts',
    'sourceSha256': hashlib.sha256(source).hexdigest(),
    'executableSha256': hashlib.sha256((r/'target/state-native').read_bytes()).hexdigest(),
    'verifier': (r/'target/verus-version.txt').read_text().strip(),
    'solver': (r/'target/z3-version.txt').read_text().strip(),
    'verifiedItems': int(match[1]),
    'verifierErrors': 0,
    'conformance': (r/'target/conformance.log').read_text().strip(),
    'negativeProofControls': (r/'target/proof-controls.log').read_text().strip(),
    'trusted': ['Verus', 'SMT solver', 'vstd specifications', 'Rust compiler and standard library'],
    'notProved': ['driver parser and I/O', 'compiler correctness', 'TS lowering and canonicalisation', 'Wasm/FFI', 'concurrency or crash durability', 'reactivity and framework adapters']
}
(r/'target/verification.json').write_text(json.dumps(report, indent=2)+'\n')
PY
