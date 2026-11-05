import { measurementIdentity } from './measurement-identity.mjs';
import { createHash } from 'node:crypto';
const object = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw TypeError('Expected an object');
  if (Object.keys(value).some((key) => !keys.includes(key))) throw TypeError('Unknown measurement field');
  for (const key of keys) if (!Object.hasOwn(value, key)) throw TypeError(`Missing measurement field: ${key}`);
};
const integer = (n, min, max) => {
  if (!Number.isSafeInteger(n) || n < min || n > max) throw TypeError('Invalid integer condition');
};
const number = (n, min, max) => {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw TypeError('Invalid timing');
};
const hash = (value, length) => {
  if (typeof value !== 'string' || !new RegExp(`^[a-f0-9]{${length}}$`).test(value))
    throw TypeError('Invalid source identity');
};
export function validateMeasurement(input) {
  object(input, [
    'version',
    'exampleId',
    'sourceHash',
    'sourceRevision',
    'settings',
    'rows',
    'equivalent',
    'environment',
    'createdAt',
  ]);
  if (input.version !== 1 || !['board-commands', 'issue-triage'].includes(input.exampleId) || input.equivalent !== true)
    throw TypeError('Unsupported comparison');
  hash(input.sourceHash, 64);
  hash(input.sourceRevision, 40);
  object(input.settings, ['count', 'operation', 'samples', 'historyLimit', 'includeSetup']);
  const { count, operation, samples, historyLimit, includeSetup } = input.settings;
  integer(count, 1, 10000);
  integer(samples, 3, 17);
  integer(historyLimit, 1, 1000);
  if (!['point', 'dense', 'sparse', 'move', 'history'].includes(operation) || typeof includeSetup !== 'boolean')
    throw TypeError('Invalid workload');
  object(input.environment, ['engine', 'engineVersion', 'platform', 'timerResolutionMs']);
  const env = input.environment;
  if (
    !['Chromium', 'Firefox', 'Safari', 'Other'].includes(env.engine) ||
    !(
      typeof env.engineVersion === 'string' &&
      (/^\d{1,4}$/.test(env.engineVersion) || env.engineVersion === 'unknown')
    ) ||
    !['Android', 'iOS', 'macOS', 'Windows', 'Linux', 'Other'].includes(env.platform)
  )
    throw TypeError('Unsupported coarse environment');
  number(env.timerResolutionMs, 0, 1000);
  if (
    typeof input.createdAt !== 'string' ||
    input.createdAt.length > 30 ||
    !Number.isFinite(Date.parse(input.createdAt))
  )
    throw TypeError('Invalid run date');
  if (!Array.isArray(input.rows) || input.rows.length !== 2) throw TypeError('Expected paired results');
  const variants = new Set();
  for (const row of input.rows) {
    object(row, ['variant', 'samplesMs', 'medianMs', 'p95Ms', 'iterations', 'totalMs', 'checksum']);
    if (!['reference', 'compiled'].includes(row.variant) || variants.has(row.variant))
      throw TypeError('Duplicate or invalid implementation');
    variants.add(row.variant);
    integer(row.iterations, 1, 1048576);
    number(row.totalMs, 0, 120000);
    hash(row.checksum, 64);
    if (!Array.isArray(row.samplesMs) || row.samplesMs.length !== samples) throw TypeError('Incorrect sample count');
    row.samplesMs.forEach((n) => number(n, 0, 30000));
    const ordered = [...row.samplesMs].sort((a, b) => a - b);
    if (row.medianMs !== ordered[Math.floor(samples / 2)] || row.p95Ms !== ordered[Math.ceil(samples * 0.95) - 1])
      throw TypeError('Reported aggregate differs from samples');
    const total = row.samplesMs.reduce((sum, value) => sum + value * row.iterations, 0);
    if (Math.abs(total - row.totalMs) > Math.max(0.001, total * 1e-8))
      throw TypeError('Reported duration differs from samples');
  }
  if (input.rows[0].checksum !== input.rows[1].checksum) throw TypeError('Implementations returned different states');
  return JSON.parse(JSON.stringify(input));
}
export function measurementKey(input) {
  return createHash('sha256')
    .update(measurementIdentity(validateMeasurement(input)))
    .digest('hex');
}
