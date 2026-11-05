/** Stable public measurement identity; validation is performed at each boundary. */
export function measurementIdentity(input) {
  const bucket = (value) => (value === 0 ? 'timer-zero' : Math.round(Math.log(value) / Math.log(1.1)));
  const { count, operation, samples, historyLimit, includeSetup } = input.settings;
  const { engine, engineVersion, platform } = input.environment;
  const rows = [...input.rows].sort((a, b) => a.variant.localeCompare(b.variant));
  return JSON.stringify([
    input.version,
    input.exampleId,
    input.sourceHash,
    input.sourceRevision,
    count,
    operation,
    samples,
    historyLimit,
    includeSetup,
    engine,
    engineVersion,
    platform,
    rows.map((row) => [row.variant, bucket(row.medianMs), bucket(row.p95Ms)]),
  ]);
}
