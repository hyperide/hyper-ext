import { measurementKey, validateMeasurement } from './measurement-model.mjs';
export function createMeasurementRepository(pool) {
  return {
    async record(input, rateKey) {
      const result = validateMeasurement(input),
        id = measurementKey(result);
      if (!/^[a-f0-9]{64}$/.test(rateKey)) throw TypeError('Invalid request key');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const rate = await client.query(
          `INSERT INTO state_measurement_rate(key,window_start,requests) VALUES($1,date_trunc('hour',now()),1)
      ON CONFLICT(key) DO UPDATE SET window_start=date_trunc('hour',now()),requests=CASE WHEN state_measurement_rate.window_start=date_trunc('hour',now()) THEN state_measurement_rate.requests+1 ELSE 1 END RETURNING requests`,
          [rateKey],
        );
        if (rate.rows[0].requests > 60) {
          await client.query('COMMIT');
          throw Object.assign(Error('Please wait before sharing another run'), { status: 429 });
        }
        const saved = await client.query(
          `INSERT INTO state_measurement_runs(id,example_id,source_hash,result) VALUES($1,$2,$3,$4::jsonb)
      ON CONFLICT(id) DO UPDATE SET observations=state_measurement_runs.observations+1,last_seen=now() RETURNING observations`,
          [id, result.exampleId, result.sourceHash, JSON.stringify(result)],
        );
        await client.query('COMMIT');
        const duplicate = Number(saved.rows[0].observations) > 1;
        return { stored: !duplicate, duplicate, id };
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {}
        throw error;
      } finally {
        client.release();
      }
    },
    async recent(exampleId, sourceHash) {
      if (!['board-commands', 'issue-triage'].includes(exampleId) || !/^[a-f0-9]{64}$/.test(sourceHash))
        throw TypeError('Unknown example or source');
      const result = await pool.query(
        'SELECT id,result,trust,observations,first_seen,last_seen FROM state_measurement_runs WHERE example_id=$1 AND source_hash=$2 ORDER BY last_seen DESC LIMIT 100',
        [exampleId, sourceHash],
      );
      return result.rows;
    },
  };
}
