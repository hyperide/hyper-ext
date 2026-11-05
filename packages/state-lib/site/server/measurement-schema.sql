-- Install only in the dedicated, empty benchmark database using a migration role.
CREATE TABLE IF NOT EXISTS state_measurement_runs (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  example_id text NOT NULL,
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL,
  trust text NOT NULL DEFAULT 'visitor' CHECK (trust = 'visitor'),
  observations bigint NOT NULL DEFAULT 1 CHECK (observations > 0),
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS state_measurement_example_recent ON state_measurement_runs (example_id, last_seen DESC);
CREATE TABLE IF NOT EXISTS state_measurement_rate (
  key text PRIMARY KEY CHECK (key ~ '^[a-f0-9]{64}$'),
  window_start timestamptz NOT NULL,
  requests integer NOT NULL CHECK (requests > 0)
);
-- The service role needs SELECT/INSERT/UPDATE on these tables only; no DDL rights.
-- Rate keys are keyed hashes, never raw IPs, and are never returned in public reads.
