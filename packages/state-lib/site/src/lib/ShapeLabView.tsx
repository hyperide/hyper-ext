import { useState, useSyncExternalStore } from 'react';
import { SHAPE_SCENARIOS, type ShapeLab, type ShapeRow } from './shape-lab';
export function ShapeLabView({ lab }: { lab: ShapeLab }) {
  useSyncExternalStore(lab.subscribe, lab.version, lab.version);
  const state = lab.inspect(),
    [chunk, setChunk] = useState(3);
  const rows = (items: ShapeRow[], remote: boolean) => (
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Item</th>
          <th>Value</th>
          <th>{remote ? 'Server actions' : 'Done'}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((row) => (
          <tr key={row.id}>
            <td>{row.id}</td>
            <td>
              {row.label}
              {row.project !== 'alpha' && <small> · outside shape</small>}
            </td>
            <td>{row.value}</td>
            <td>
              {remote ? (
                <>
                  <button
                    onClick={() => lab.write(row.id, { value: row.value + 1, done: !row.done })}
                    aria-label={`Change row ${row.id}`}
                  >
                    +1 / toggle
                  </button>
                  <button onClick={() => lab.remove(row.id)} aria-label={`Delete row ${row.id}`}>
                    delete
                  </button>
                </>
              ) : (
                String(row.done)
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="shape-lab">
      <strong>{SHAPE_SCENARIOS[lab.scenario].title}</strong>
      <p>{SHAPE_SCENARIOS[lab.scenario].why}</p>
      <p className="simulation-badge">
        Deterministic protocol model · no Electric service or network · not a benchmark
      </p>
      <div className="shape-phases" aria-label="Sync phase">
        {['idle', 'snapshot', 'catch-up', 'up-to-date', 'must-refetch'].map((p) => (
          <span key={p} aria-current={state.phase === p ? 'step' : undefined}>
            {p}
          </span>
        ))}
      </div>
      <div className="workbench-actions">
        <button className="tab" onClick={lab.start}>
          Start snapshot
        </button>
        <button className="tab" onClick={() => lab.pull(chunk)}>
          Receive next chunk
        </button>
        <button className="tab" onClick={state.connected ? lab.disconnect : lab.reconnect}>
          {state.connected ? 'Go offline' : 'Reconnect'}
        </button>
        <button className="tab" onClick={lab.retry}>
          Retry last change
        </button>
        <button className="tab" onClick={lab.expire}>
          Expire server handle
        </button>
        <button className="tab" onClick={lab.reset}>
          Reset fixture
        </button>
      </div>
      <label>
        Rows / changes per chunk{' '}
        <input
          aria-label="Chunk size"
          type="number"
          min={1}
          max={100}
          value={chunk}
          onChange={(e) => setChunk(Math.max(1, Number(e.target.value) || 1))}
        />
      </label>
      <label>
        <input type="checkbox" checked={state.progressive} onChange={(e) => lab.setProgressive(e.target.checked)} />{' '}
        Show partial snapshot (labelled incomplete)
      </label>
      <p role="status">
        {state.connected ? 'Connected' : 'Offline / stale'} · {state.phase} · checkpoint {state.handle ?? 'none'}:
        {state.cursor} · {state.received}/{state.total} snapshot rows · {state.requests} simulated requests
      </p>
      <div className="shape-columns">
        <section>
          <h4>Authoritative server</h4>
          <div className="shape-table">{rows(state.server, true)}</div>
        </section>
        <section>
          <h4>Local shape · project = alpha</h4>
          {state.phase !== 'up-to-date' && (
            <p className="incomplete">Not a complete/current result. {state.staged} row(s) buffered.</p>
          )}
          <div className="shape-table">{rows(state.client, false)}</div>
        </section>
      </div>
      <details open>
        <summary>Execution trace · every transport/control action</summary>
        <ol className="shape-trace">
          {state.trace.map((t) => (
            <li key={t.step}>
              <b>
                {t.step}. {t.event}
              </b>{' '}
              — {t.detail}
              <small>
                offset {t.cursor} · local IDs [{t.clientIds.join(', ')}]
              </small>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
