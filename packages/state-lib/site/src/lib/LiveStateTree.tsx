import { useEffect, useState } from 'react';
import { inspectPath } from './repl-inspection';
import { observeLiveInspection, type InspectionSource } from './live-inspection';
const EMPTY: Record<string, unknown> = {};
function Branch({ name, value, depth = 0 }: { name: string; value: unknown; depth?: number }) {
  const complex = value !== null && typeof value === 'object';
  const entries = complex ? Object.entries(value) : [];
  if (!complex || !entries.length)
    return (
      <li className="state-leaf">
        <code>{name}</code>
        <span>
          {complex
            ? Array.isArray(value)
              ? '[]'
              : '{}'
            : typeof value === 'string'
              ? JSON.stringify(value)
              : String(value)}
        </span>
      </li>
    );
  return (
    <li>
      <details open={depth < 3}>
        <summary>
          <code>{name}</code>
          <small>{Array.isArray(value) ? `${entries.length} items` : `${entries.length} fields`}</small>
        </summary>
        <ul>
          {entries.map(([key, item]) => (
            <Branch key={key} name={key} value={item} depth={depth + 1} />
          ))}
        </ul>
      </details>
    </li>
  );
}
/** Live values subscribe to the real stores. Historical debugger frames stay elsewhere. */
export function LiveStateTree({ session }: { session?: InspectionSource | null }) {
  const [data, setData] = useState<Record<string, unknown>>(EMPTY);
  const [paths, setPaths] = useState<string[]>([]);
  const [path, setPath] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setData(EMPTY);
    setPaths([]);
    setRevision(0);
    if (!session) return;
    return observeLiveInspection(session, (update) => {
      setData(update.data);
      setPaths(update.paths);
      setRevision(update.revision);
    });
  }, [session]);
  const inspected = inspectPath(data, path);
  return (
    <div className="live-state-tree">
      <div className="state-version">
        Live values <span>· {revision} observed updates</span>
      </div>
      <label className="state-path">
        Inspect a value
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="store.tasks.a.done"
          spellCheck={false}
        />
      </label>
      {path && (
        <output className="path-value">
          {inspected.error ??
            (inspected.found ? (JSON.stringify(inspected.value) ?? String(inspected.value)) : 'No value at this path')}
        </output>
      )}
      {!!paths.length && (
        <p className="changed-paths">
          <strong>Changed paths:</strong> {paths.join(', ')}
        </p>
      )}
      {!Object.keys(data).length ? (
        <p className="lnote">Initialize the example to see its actual values. Nothing has run yet.</p>
      ) : (
        <ul className="state-tree-root">
          {Object.entries(data).map(([name, value]) => (
            <Branch key={name} name={name} value={value} />
          ))}
        </ul>
      )}
      <p className="lnote">Data paths, not functions. Reading the tree does not execute your actions or getters.</p>
    </div>
  );
}
