import { compute } from './compute.mjs';
const percentile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * q) - 1)];
function channel() {
  const worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
  let sequence = 0;
  const pending = new Map();
  worker.onmessage = ({ data }) => {
    const task = pending.get(data.id);
    if (task) {
      clearTimeout(task.timeout);
      pending.delete(data.id);
      data.error ? task.reject(Error(data.error)) : task.resolve(data);
    }
  };
  worker.onerror = (event) => {
    for (const task of pending.values()) {
      clearTimeout(task.timeout);
      task.reject(Error(event.message));
    }
    pending.clear();
  };
  return {
    async send(data, transfer = []) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(Error('worker timeout'));
        }, 15000);
        pending.set(id, { resolve, reject, timeout });
        worker.postMessage({ ...data, id }, transfer);
      });
    },
    close() {
      worker.terminate();
      for (const task of pending.values()) {
        clearTimeout(task.timeout);
        task.reject(Error('closed'));
      }
      pending.clear();
    },
  };
}
export async function run() {
  globalThis.__stateProbeStep='capabilities';
  const capability = {
    userAgent: navigator.userAgent,
    crossOriginIsolated,
    secureContext: isSecureContext,
    sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
    atomicsWaitAsync: typeof Atomics.waitAsync === 'function',
    sharedWorker: typeof SharedWorker === 'function',
    schedulerPostTask: typeof globalThis.scheduler?.postTask === 'function',
    schedulerYield: typeof globalThis.scheduler?.yield === 'function',
    offscreenCanvas: typeof OffscreenCanvas === 'function',
    webGpuProperty: 'gpu' in navigator,
  };
  const lengthBytes = await (await fetch(new URL('./strings.wasm', import.meta.url))).arrayBuffer();
  let fallbacks = 0;
  const imports = {
    'wasm:js-string': {
      length: (value) => {
        fallbacks++;
        return value.length;
      },
    },
  };
  try {
    const instance = (await WebAssembly.instantiate(lengthBytes, imports, { builtins: ['js-string'] })).instance;
    capability.stringLength = instance.exports.length('я😀');
    capability.jsStringBuiltins = fallbacks === 0 && capability.stringLength === 3;
    const object = { owned: true };
    capability.externrefIdentity = instance.exports.identity(object) === object;
    fallbacks = 0;
    const streamed = await WebAssembly.instantiateStreaming(fetch(new URL('./strings.wasm', import.meta.url)), imports, {
      builtins: ['js-string'],
    });
    capability.streamingStringBuiltins = streamed.instance.exports.length('я😀') === 3 && fallbacks === 0;
  } catch (error) {
    capability.stringProbeError = String(error);
  }
  const simdBytes=await (await fetch(new URL('./simd.wasm', import.meta.url))).arrayBuffer();
  capability.simd=WebAssembly.validate(simdBytes);
  if(capability.simd)capability.simdResult=(await WebAssembly.instantiate(simdBytes)).instance.exports.probe();
  capability.arrayBufferTransfer=typeof ArrayBuffer.prototype.transfer==='function';
  const memory = new WebAssembly.Memory({ initial: 1 });
  const old = new Uint8Array(memory.buffer);
  memory.grow(1);
  capability.oldViewLengthAfterGrow = old.byteLength;
  if (capability.sharedArrayBuffer && capability.atomicsWaitAsync) {
    const value = Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 0);
    capability.waitAsyncZeroTimeout = { async: value.async, result: await value.value };
  }
  const control = channel();
  capability.worker = (await control.send({ type: 'capability' })).value;
  globalThis.__stateProbeStep='transfer';
  const transfer = [];
  for (const move of [false, true]) {
    let buffer = new ArrayBuffer(1024 * 1024);
    const samples = [];
    for (let round = -2; round < 9; round++) {
      const start = performance.now();
      for (let i = 0; i < 10; i++) {
        const current = buffer;
        const response = await control.send({ type: 'echo', buffer, transfer: move }, move ? [buffer] : []);
        if (move && current.byteLength !== 0) throw Error('Transfer did not detach ownership');
        buffer = response.buffer;
      }
      const value = (performance.now() - start) / 10;
      if (round >= 0) samples.push(value);
    }
    transfer.push({
      mode: move ? 'transfer' : 'clone',
      bytes: buffer.byteLength,
      rounds: 9,
      rttPerRound: 10,
      medianMeanRttMs: percentile(samples, 0.5),
      p95OfRoundMeansMs: percentile(samples, 0.95),
      samples,
    });
  }
  control.close();
  const wasmBytes = await (await fetch(new URL('./numeric.wasm', import.meta.url))).arrayBuffer();
  const numeric = [];
  for (const count of [1000, 100000, 1000000]) {
    globalThis.__stateProbeStep='numeric '+count;
    const initial = Uint32Array.from({ length: count }, (_, i) => (Math.imul(i, 7919) + 17) >>> 0);
    const coldStart = performance.now();
    const module = await WebAssembly.instantiate(wasmBytes);
    const wasm = module.instance.exports;
    const wasmInstantiateMs = performance.now() - coldStart;
    if (initial.byteLength > wasm.memory.buffer.byteLength)
      wasm.memory.grow(Math.ceil(initial.byteLength / 65536) - wasm.memory.buffer.byteLength / 65536);
    const resident = new Uint32Array(wasm.memory.buffer, 0, count);
    resident.set(initial);
    const expected = compute(initial);
    if (wasm.compute(0, count) >>> 0 !== expected) throw Error('Wasm result mismatch');
    const channels = [];
    const startup = performance.now();
    const workers = [
      { name: 'js-worker-1', count: 1, wasm: false },
      { name: 'wasm-worker-1', count: 1, wasm: true },
      { name: 'js-worker-4', count: 4, wasm: false },
    ];
    for (const pool of workers) {
      pool.channels = [];
      const start = performance.now();
      for (let i = 0; i < pool.count; i++) {
        const c = channel();
        channels.push(c);
        pool.channels.push(c);
        const slice = initial.slice(Math.floor((count * i) / pool.count), Math.floor((count * (i + 1)) / pool.count));
        await c.send({ type: 'init', buffer: slice.buffer, wasm: pool.wasm ? wasmBytes : undefined }, [slice.buffer]);
      }
      pool.startupAndIngestMs = performance.now() - start;
    }
    const variants = [
      { name: 'js-main', run: () => compute(resident) },
      { name: 'wasm-main-resident', run: () => wasm.compute(0, count) >>> 0 },
      {
        name: 'pack-and-wasm',
        run: () => {
          resident.set(initial);
          return wasm.compute(0, count) >>> 0;
        },
      },
    ];
    for (const pool of workers)
      variants.push({
        name: pool.name,
        startupAndIngestMs: pool.startupAndIngestMs,
        run: async () => {
          const replies = await Promise.all(pool.channels.map((c) => c.send({ type: 'compute' })));
          return replies.reduce((sum, item) => (sum + item.value) >>> 0, 0);
        },
      });
    // Equal call-count warmup for every executor before collecting any timing.
    for (let warmup = 0; warmup < 32; warmup++)
      for (const variant of variants) {
        if ((await variant.run()) !== expected) throw Error('Warmup mismatch');
      }
    const samples = Object.fromEntries(variants.map((v) => [v.name, []]));
    for (let trial = -3; trial < 9; trial++)
      for (const variant of trial % 2 ? [...variants].reverse() : variants) {
        const start = performance.now();
        const value = await variant.run();
        const elapsed = performance.now() - start;
        if (value !== expected) throw Error('Executor mismatch ' + variant.name);
        if (trial >= 0) samples[variant.name].push(elapsed);
      }
    for (const variant of variants)
      numeric.push({
        count,
        executor: variant.name,
        medianMs: percentile(samples[variant.name], 0.5),
        p95Ms: percentile(samples[variant.name], 0.95),
        startupAndIngestMs: variant.startupAndIngestMs ?? 0,
        wasmInstantiateMs: variant.name.includes('wasm') ? wasmInstantiateMs : null,
        warmupCalls: 35,
        samples: samples[variant.name],
        checksum: expected,
      });
    channels.forEach((c) => c.close());
  }
  return {
    capability,
    transfer,
    numeric,
    notes: [
      'Same eight uint32 mixing rounds and checksum across executors; same typed-buffer representation.',
      'Worker cold startup plus one initial shard copy/transfer are recorded separately, not hidden in warm compute.',
      'pack-and-wasm copies an existing typed buffer, NOT JS objects or JSON; no object normalization speed claim.',
      'Synchronous paths include the same surrounding await microtask as async paths; no DOM/INP measurement.',
      'RTT p95 is percentile of 10-message mean batches. Nine trials are exploratory, not a universal bound.',
    ],
  };
}
