import { bestIndices } from './benchmark-best';
import { useId, useState } from 'react';
import { EVIDENCE, controllerComparison, evidenceDownload } from '../data/research';
import { href } from './router';
const ms = (value: number) => (value < 0.01 ? value.toFixed(5) : value.toFixed(3));
export function ResearchEvidence({ experiment }: { experiment: 'cow' }) {
  const [size, setSize] = useState(1200);
  const sizeId = useId();
  const cells = [30, 300, 1200].flatMap(controllerComparison);
  const passes = cells.filter((row) => row.pass).length;
  return (
    <section className="research-proof" data-research-proof={experiment}>
      <header className="research-proof-head">
        <p className="research-eyebrow">Recorded controller measurements</p>
        <h2>Document updates across workload sizes</h2>
        <p className="research-meta">
          Measured on {EVIDENCE.measuredAt} · {EVIDENCE.environment.machine} · {EVIDENCE.environment.runtime}
        </p>
      </header>
      <div className="research-verdict">
        <strong>Whole-document copy-on-write</strong>
        <span>
          {passes} of {cells.length} cases have every COW sample at or below the fastest original sample
        </span>
      </div>
      <p>
        The original model mutates its document. The Runtime implementations retain immutable versions for readers and
        history.
      </p>
      <div className="research-controls">
        <label htmlFor={sizeId}>Document size</label>
        <select id={sizeId} value={size} onChange={(event) => setSize(Number(event.target.value))}>
          {[30, 300, 1200].map((count) => (
            <option key={count} value={count}>
              {count.toLocaleString('en-US')} items
            </option>
          ))}
        </select>
      </div>
      <div
        className="research-table"
        tabIndex={0}
        role="region"
        aria-label="Controller comparison; horizontally scrollable on a narrow screen"
      >
        <table>
          <caption>
            {size.toLocaleString('en-US')} items · median of batch means · milliseconds, lower is better · Highlight:
            lowest recorded median in the row
          </caption>
          <thead>
            <tr>
              <th scope="col">Operation</th>
              <th scope="col">Original mutable</th>
              <th scope="col">Full-copy Runtime</th>
              <th scope="col">COW candidate</th>
              <th scope="col">Every sample faster?</th>
            </tr>
          </thead>
          <tbody>
            {controllerComparison(size).map((row) => {
              const values = [row.original, row.runtime, row.cow],
                best = bestIndices(values);
              return (
                <tr key={row.operation}>
                  <th scope="row">{row.label}</th>
                  {values.map((value, index) => (
                    <td key={index} data-metric-cell data-best={best.includes(index) ? '' : undefined}>
                      <span>{ms(value)}</span>
                      {best.includes(index) && <span className="research-best-label">Best median</span>}
                    </td>
                  ))}
                  <td>
                    <span className={row.pass ? 'research-pass' : 'research-reject'}>{row.pass ? 'Yes' : 'No'}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details className="research-method">
        <summary>Measurement conditions</summary>
        <p>{EVIDENCE.controller.method}</p>
        <p>
          The final column compares the maximum COW sample with the minimum original sample. With 17 observations,
          nearest-rank P95 is the observed maximum.
        </p>
        <p>
          The 30-item move rotates within one column; larger fixtures move between columns. Timing includes the
          controller and history, and excludes initial import, network, UI rendering and peak-memory measurement.
        </p>
      </details>
      <footer className="research-proof-footer">
        <a href={evidenceDownload} download>
          Download observations · JSON
        </a>
        <a href={href('/repl/board-commands')}>Edit and measure board commands →</a>
        <a href={href('/spec#example-benchmark-method')}>Measurement method →</a>
        <span>
          Recorded source revision <code>{EVIDENCE.provenance.revision.slice(0, 8)}</code>. The download includes the
          original trial samples and source hashes.
        </span>
      </footer>
    </section>
  );
}
