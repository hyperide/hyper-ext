import { compute } from './compute.mjs';
let values, wasm;
onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'init') {
      values = new Uint32Array(data.buffer);
      if (data.wasm) {
        wasm = (await WebAssembly.instantiate(data.wasm)).instance;
        const memory = wasm.exports.memory;
        if (values.byteLength > memory.buffer.byteLength)
          memory.grow(Math.ceil(values.byteLength / 65536) - memory.buffer.byteLength / 65536);
        new Uint32Array(memory.buffer, 0, values.length).set(values);
      }
      postMessage({ id, value: values.length });
    } else if (type === 'compute')
      postMessage({ id, value: wasm ? wasm.exports.compute(0, values.length) >>> 0 : compute(values) });
    else if (type === 'echo') postMessage({ id, buffer: data.buffer }, data.transfer ? [data.buffer] : []);
    else if (type === 'capability')
      postMessage({ id, value: { document: typeof document, isolated: crossOriginIsolated } });
  } catch (error) {
    postMessage({ id, error: String(error) });
  }
};
