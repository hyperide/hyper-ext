// Private sandbox harness. User code is concatenated before this file in a classic opaque-origin worker.
function executeWorker() {
  const scope = self;

  // codeql[js/missing-origin-check] Dedicated worker owned only by execution-sandbox.ts's opaque-origin iframe.
  // Its Window bootstrap checks parent + random token, then uses a private MessageChannel; connect-src is 'none'.
  scope.addEventListener('message', async (event) => {
    let active;
    try {
      const { kind, settings, actions = [] } = event.data;
      const executable = __stateExample;
      const create = () => executable.createModel(settings.count, settings.historyLimit);
      const step = (model, i) => model.step(settings.operation, i, `Edit ${i}`);
      if (kind === 'preview') {
        active = create();
        for (const action of actions.slice(-1e3))
          active.step(action.operation, action.index ?? 0, action.text ?? 'Updated issue');
        const snapshot = active.snapshot(),
          document = snapshot.document;
        const total = document.columns.reduce((sum, column) => sum + column.items.length, 0);
        let offset = 0;
        const columns = document.columns.slice(0, 10).map((column) => {
          const start = offset;
          offset += column.items.length;
          return {
            id: column.id,
            title: column.title,
            count: column.items.length,
            items: column.items.slice(0, 24).map((row, index) => ({
              id: String(row.id),
              index: start + index,
              text: String(row.text).slice(0, 200),
              done: Boolean(row.done),
            })),
          };
        });
        const result = { title: document.title, total, canUndo: snapshot.canUndo, canRedo: snapshot.canRedo, columns };
        scope.postMessage({ result });
        return;
      }
      active = create();
      const old = active.read(),
        oldValue = JSON.stringify(old);
      active.step('point', 0, 'Setup');
      for (let i = 0; i < 17; i++) step(active, i);
      if (JSON.stringify(old) !== oldValue) throw Error('A command changed an earlier snapshot');
      const checksum = JSON.stringify(active.read());
      active.dispose();
      active = void 0;
      const batch = (iterations2) => {
        let model;
        if (!settings.includeSetup) {
          model = create();
          if (settings.operation === 'history') model.step('point', 0, 'Setup');
        }
        const start = performance.now();
        for (let i = 0; i < iterations2; i++) {
          if (settings.includeSetup) {
            model = create();
            if (settings.operation === 'history') model.step('point', 0, 'Setup');
          }
          step(model, i);
          if (settings.includeSetup) model.dispose();
        }
        const elapsed2 = performance.now() - start;
        if (!settings.includeSetup) model.dispose();
        return elapsed2;
      };
      let iterations = 1,
        elapsed = batch(1);
      while (elapsed < 20 && iterations < 16384) {
        iterations = Math.min(iterations * 4, 16384);
        elapsed = batch(iterations);
      }
      const samplesMs = [];
      let totalMs = 0;
      for (let sample = 0; sample < settings.samples; sample++) {
        const time = batch(iterations);
        samplesMs.push(time / iterations);
        totalMs += time;
      }
      const sorted = [...samplesMs].sort((a, b) => a - b);
      scope.postMessage({
        result: {
          samplesMs,
          medianMs: sorted[Math.floor(sorted.length / 2)],
          p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
          iterations,
          totalMs,
          checksum,
        },
      });
    } catch (error) {
      scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      try {
        active?.dispose();
      } catch {}
    }
  });
}
executeWorker();
