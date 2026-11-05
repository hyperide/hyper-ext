#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# A private Unix-socket-only cluster; never reads any project connection string.
root=$(mktemp -d /tmp/state-measurements-XXXXXX)
chmod 700 "$root"
mkdir "$root/socket"
chmod 700 "$root/socket"
cleanup() { pg_ctl -D "$root/data" -m fast -w stop >>"$root/server.log" 2>&1 || true; }
trap cleanup EXIT
initdb -D "$root/data" -U state_test_owner --auth-local=trust --auth-host=reject --no-locale -E UTF8 >"$root/init.log" 2>&1
pg_ctl -D "$root/data" -l "$root/server.log" -o "-c listen_addresses='' -c unix_socket_directories='$root/socket' -c unix_socket_permissions=0700 -p 56419" -w start >/dev/null
psql -h "$root/socket" -p 56419 -U state_test_owner -d postgres -v ON_ERROR_STOP=1 -f server/measurement-schema.sql >"$root/schema.log"
STATE_TEST_PG_SOCKET="$root/socket" node --test tests/server/measurement.test.mjs tests/server/postgres.test.mjs
printf 'Private test cluster stopped on exit; evidence: %s\n' "$root"
