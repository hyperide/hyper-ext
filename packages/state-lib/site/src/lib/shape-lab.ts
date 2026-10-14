/** Deterministic teaching model of snapshot + change-log synchronization.
 * NOT Electric's implementation, SDK, wire format, planner, or a benchmark. */
export type ShapeRow = { id: string; label: string; project: string; value: number; done: boolean };
export type ShapeChange = { seq: number; op: 'insert' | 'update' | 'delete'; key: string; value?: ShapeRow };
export type ShapeScenario = 'kanban' | 'catalog' | 'quotes' | 'large' | 'resume' | 'reset';
export const SHAPE_SCENARIOS: Record<ShapeScenario, { title: string; why: string; count: number }> = {
  kanban: {
    title: 'Shared project board',
    why: 'Even a small dataset benefits: edits, deletes and reconnects must reach all members.',
    count: 6,
  },
  catalog: {
    title: 'Locally searchable catalogue',
    why: 'Receive just the selected category; local filtering is immediate after this subset is current.',
    count: 18,
  },
  quotes: {
    title: 'Public last-price board',
    why: 'Many authorised readers can share identical shape chunks. This is not a market tick-history engine.',
    count: 8,
  },
  large: {
    title: 'A snapshot arriving in chunks',
    why: 'Loading progressively is a UI choice. An incomplete subset must not masquerade as a complete aggregate.',
    count: 40,
  },
  resume: {
    title: 'Reconnect without losing a delete',
    why: 'A log position resumes changes to old IDs too; a record-ID pagination cursor cannot do that.',
    count: 6,
  },
  reset: {
    title: 'Expired shape handle',
    why: 'Resume is conditional on retained server history. must-refetch means rebuild the replica.',
    count: 6,
  },
};
export function createShapeLab(scenario: ShapeScenario = 'kanban') {
  if (!(scenario in SHAPE_SCENARIOS)) throw new Error('Unknown shape scenario');
  const fixture = () =>
    Array.from(
      { length: SHAPE_SCENARIOS[scenario].count },
      (_, i): ShapeRow => ({
        id: String(i + 1),
        label: scenario === 'quotes' ? `Symbol ${i + 1}` : `Item ${i + 1}`,
        project: i % 3 === 0 ? 'other' : 'alpha',
        value: (i + 1) * 10,
        done: false,
      }),
    );
  let server = new Map(fixture().map((row) => [row.id, row])),
    client = new Map<string, ShapeRow>();
  const staged = new Map<string, ShapeRow>();
  let changes: ShapeChange[] = [],
    snapshot: ShapeRow[] = [],
    position = 0,
    snapshotCut = 0,
    cursor = 0,
    epoch = 1,
    handle = 0;
  let connected = true,
    phase = 'idle',
    version = 0,
    requests = 0,
    progressive = false;
  const listeners = new Set<() => void>();
  const trace: { step: number; event: string; detail: string; cursor: number; clientIds: string[] }[] = [];
  const matches = (r: ShapeRow) => r.project === 'alpha';
  const copy = (r: ShapeRow) => ({ ...r });
  const inspect = () => ({
    scenario,
    phase,
    connected,
    handle: handle ? `sim-${handle}` : null,
    serverHandle: `sim-${epoch}`,
    cursor,
    requests,
    progressive,
    received: position,
    total: snapshot.length,
    server: [...server.values()].map(copy),
    client: [...client.values()].map(copy),
    staged: staged.size,
    changes: changes.map((c) => ({ ...c, value: c.value ? copy(c.value) : undefined })),
    trace: trace.map((t) => ({ ...t, clientIds: [...t.clientIds] })),
  });
  const record = (event: string, detail: string) => {
    trace.push({ step: trace.length + 1, event, detail, cursor, clientIds: [...client.keys()] });
    version++;
    listeners.forEach((f) => f());
  };
  const apply = (change: ShapeChange) => {
    if (change.op === 'delete') client.delete(change.key);
    else if (change.value) client.set(change.key, copy(change.value));
  };
  const start = () => {
    if (!connected) {
      record('offline', 'Connect before requesting a snapshot.');
      return;
    }
    handle = epoch;
    snapshot = [...server.values()].filter(matches).map(copy);
    snapshotCut = changes.length;
    cursor = snapshotCut;
    position = 0;
    staged.clear();
    client.clear();
    phase = 'snapshot';
    record(
      'snapshot boundary',
      'Capture a consistent subset and its log position. Synthetic handles/offsets in this model are not the wire format.',
    );
  };
  const pull = (size = 3) => {
    if (!Number.isInteger(size) || size < 1) throw new Error('Chunk size must be a positive integer');
    if (!connected) {
      record('offline', 'No request; local data remains available but stale.');
      return;
    }
    requests++;
    if (handle !== epoch) {
      client.clear();
      staged.clear();
      phase = 'must-refetch';
      handle = 0;
      record('must-refetch', 'Old handle is invalid. Start a new snapshot; do not resume an unrelated log.');
      return;
    }
    if (phase === 'snapshot') {
      const chunk = snapshot.slice(position, position + size);
      position += chunk.length;
      for (const row of chunk) {
        staged.set(row.id, copy(row));
        if (progressive) client.set(row.id, copy(row));
      }
      if (position === snapshot.length) {
        client = new Map(staged);
        staged.clear();
        phase = 'catch-up';
      }
      record(
        'snapshot chunk',
        `${chunk.length} rows received. ${phase === 'snapshot' ? 'Still incomplete.' : 'Snapshot complete; catch up changes since its boundary.'}`,
      );
      return;
    }
    const delta = changes.slice(cursor, cursor + size);
    delta.forEach(apply);
    cursor += delta.length;
    phase = cursor === changes.length ? 'up-to-date' : 'catch-up';
    record(
      phase,
      `${delta.length} change(s) applied by key, including updates/deletes of old IDs. Current only through this response boundary.`,
    );
  };
  const write = (id: string, patch: Partial<ShapeRow>) => {
    const old = server.get(id),
      row = { label: 'New item', project: 'alpha', value: 0, done: false, ...old, ...patch, id };
    server.set(id, row);
    const before = !!old && matches(old),
      after = matches(row);
    if (before || after)
      changes.push({
        seq: changes.length + 1,
        op: !after ? 'delete' : before ? 'update' : 'insert',
        key: id,
        value: after ? copy(row) : undefined,
      });
    record(
      'server write',
      after || before
        ? 'Only the server changed. Pull to update the client.'
        : 'Outside this shape: no client change is emitted.',
    );
  };
  return {
    scenario,
    inspect,
    version: () => version,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    start,
    pull,
    write,
    remove(id: string) {
      const old = server.get(id);
      server.delete(id);
      if (old && matches(old)) changes.push({ seq: changes.length + 1, op: 'delete', key: id });
      record('server delete', 'A delete of an old ID enters the change log, not the next record-ID page.');
    },
    disconnect() {
      connected = false;
      record('disconnect', 'The client retains its local materialisation and checkpoint in memory.');
    },
    reconnect() {
      connected = true;
      record(
        'reconnect',
        'Reuse the handle AND offset with the matching local data; the next pull may require refetch.',
      );
    },
    expire() {
      epoch++;
      changes = [];
      record('server reset', 'Simulated history loss / shape recreation. The old checkpoint cannot be used.');
    },
    setProgressive(value: boolean) {
      progressive = value;
      record(
        'display policy',
        value ? 'Expose partial rows with an incomplete marker.' : 'Publish the snapshot together after receiving it.',
      );
    },
    retry() {
      if (!cursor) {
        record('retry', 'No change chunk received yet.');
        return;
      }
      const change = changes[cursor - 1];
      if (change) apply(change);
      record(
        'retry same change',
        'Keyed materialisation stays the same. Application side effects require their own deduplication.',
      );
    },
    reset() {
      server = new Map(fixture().map((r) => [r.id, r]));
      client.clear();
      staged.clear();
      snapshot = [];
      changes = [];
      position = 0;
      cursor = 0;
      epoch = 1;
      handle = 0;
      requests = 0;
      connected = true;
      phase = 'idle';
      trace.length = 0;
      record('reset', 'Fresh teaching fixture; no network requests are performed.');
    },
  };
}
export type ShapeLab = ReturnType<typeof createShapeLab>;
