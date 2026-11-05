#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")" && pwd)
expected='wasm-bindgen 0.2.121'
actual=$(wasm-bindgen --version)
if [[ "$actual" != "$expected" ]]; then
  printf 'Expected %s, found %s\n' "$expected" "$actual" >&2
  exit 1
fi
# --lib matters: a CLI binary with stdin/main is not a browser library.
cargo build --locked --manifest-path "$root/Cargo.toml"
cargo build --locked --lib --profile web --target wasm32-unknown-unknown --manifest-path "$root/Cargo.toml"
wasm-bindgen --target web --out-dir "$root/pkg-web" "$root/target/wasm32-unknown-unknown/web/statec.wasm"
printf '{"type":"module"}\n' > "$root/pkg-web/package.json"
python3 - "$root" <<'PY'
import hashlib, json, sys
from pathlib import Path
root = Path(sys.argv[1])
names = [
    'Cargo.toml', 'Cargo.lock', 'build-web.sh',
    'src/main.rs', 'src/lib.rs', 'src/command.rs', 'src/projection.rs',
    'target/debug/statec', 'pkg-web/statec.js', 'pkg-web/statec_bg.wasm',
]
record = {'files': {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in names}}
(root / 'pkg-web/build-manifest.json').write_text(json.dumps(record, indent=2) + '\n')
PY
