/** Read-only HTTP protocol exercise. This is a small REPL adapter, NOT the
 * official @electric-sql/client. No service, credentials or persistence is bundled. */
function enumerableObject(value: unknown): object {
  return Object(value);
}
export function createElectricReader() {
  let endpoint = '',
    table = '',
    offset = '-1',
    handle = '',
    version = 0,
    busy = false,
    phase = 'idle';
  let caughtUp = false;
  let controller: AbortController | null = null;
  const rows = new Map<string, unknown>(),
    trace: string[] = [],
    listeners = new Set<() => void>();
  const emit = (line: string) => {
    trace.push(line);
    version++;
    listeners.forEach((fn) => fn());
  };
  const apply = (message: unknown) => {
    if (!message || typeof message !== 'object') return;
    const headers =
      'headers' in message && message.headers && typeof message.headers === 'object' ? message.headers : {};
    const controlValue = 'control' in headers ? headers.control : undefined;
    const control = typeof controlValue === 'string' ? controlValue : undefined;
    if (control === 'must-refetch') {
      rows.clear();
      offset = '-1';
      handle = '';
      caughtUp = false;
      phase = 'must-refetch';
      emit('must-refetch: discard materialisation and checkpoint');
      return;
    }
    if (control) {
      if (control === 'up-to-date') caughtUp = true;
      phase = control;
      emit(`control: ${control}`);
      return;
    }
    const op = 'operation' in headers ? headers.operation : undefined;
    if (
      !('key' in message) ||
      typeof message.key !== 'string' ||
      (op !== 'insert' && op !== 'update' && op !== 'delete')
    )
      return;
    const value = 'value' in message ? message.value : undefined;
    if (op === 'delete') rows.delete(message.key);
    else
      rows.set(
        message.key,
        op === 'update' ? { ...enumerableObject(rows.get(message.key)), ...enumerableObject(value) } : value,
      );
    emit(`${op} ${message.key}`);
  };
  return {
    inspect: () => ({ endpoint, table, offset, handle, phase, busy, rows: [...rows.entries()], trace: [...trace] }),
    version: () => version,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    configure(url: string, tableName: string) {
      if (busy) throw new Error('Stop the current request first');
      const parsed = new URL(url);
      if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Use an HTTP(S) read endpoint');
      endpoint = parsed.href;
      table = tableName;
      offset = '-1';
      handle = '';
      rows.clear();
      caughtUp = false;
      phase = 'idle';
      emit('configured; no request sent');
    },
    async pull(sse = false) {
      if (busy) throw new Error('A request is already running');
      if (!endpoint) throw new Error('Configure your authorised endpoint first');
      controller = new AbortController();
      busy = true;
      phase = 'request';
      emit(`request from offset ${offset}`);
      try {
        if (offset === '-1') rows.clear();
        const url = new URL(endpoint);
        if (table) url.searchParams.set('table', table);
        url.searchParams.set('offset', offset);
        if (handle) url.searchParams.set('handle', handle);
        if (offset !== '-1' && caughtUp) {
          url.searchParams.set('live', 'true');
          if (sse) url.searchParams.set('live_sse', 'true');
        }
        const response = await fetch(url, { signal: controller.signal });
        if (response.status === 409) {
          rows.clear();
          offset = '-1';
          handle = '';
          caughtUp = false;
          phase = 'must-refetch';
          emit('HTTP 409: refetch required');
          return;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const nextOffset = response.headers.get('electric-offset'),
          nextHandle = response.headers.get('electric-handle');
        if (nextHandle) handle = nextHandle;
        if (/text\/event-stream/.test(response.headers.get('content-type') ?? '')) {
          // No durable SSE-resume implementation here: reset checkpoint before reading.
          offset = '-1';
          handle = '';
          caughtUp = false;
          const reader = response.body?.getReader();
          if (!reader) throw new Error('No streaming body');
          const decoder = new TextDecoder();
          let buffer = '';
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let match: RegExpExecArray | null;
            while ((match = /\r?\n\r?\n/.exec(buffer))) {
              const event = buffer.slice(0, match.index);
              buffer = buffer.slice(match.index + match[0].length);
              const data = event
                .split(/\r?\n/)
                .filter((l) => l.startsWith('data:'))
                .map((l) => l.slice(5).trimStart())
                .join('\n');
              if (data) {
                const parsed = JSON.parse(data);
                (Array.isArray(parsed) ? parsed : [parsed]).forEach(apply);
              }
            }
          }
          // A server without per-event resumable IDs must not be treated as
          // having a safe end-of-stream checkpoint. Rebuild rather than guess.
          emit(
            'SSE is a live view. This minimal reader does not derive a durable checkpoint from event IDs; start a fresh snapshot after stopping SSE.',
          );
        } else {
          const data = await response.json();
          if (!Array.isArray(data)) throw new Error('Expected a shape-log JSON array');
          data.forEach(apply);
          if (phase !== 'must-refetch') {
            if (!nextOffset || !handle)
              throw new Error(
                'Missing electric-offset/electric-handle: expose these headers in CORS or use an authorised same-origin proxy',
              );
            offset = nextOffset;
          }
        }
        emit('request completed');
      } catch (error) {
        phase = 'error';
        emit(String(error));
      } finally {
        busy = false;
        controller = null;
        emit('idle transport');
      }
    },
    stop() {
      controller?.abort();
    },
  };
}
export type ElectricReader = ReturnType<typeof createElectricReader>;
