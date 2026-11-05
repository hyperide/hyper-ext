import { sha256, scriptString } from './core';
import executionSource from './execution.worker.js?raw';
import type { RunSettings, PreviewAction, PreviewState, RunRow } from './types';
interface ExecutionRequest {
  kind: 'benchmark' | 'preview';
  code: string;
  settings: RunSettings;
  actions?: PreviewAction[];
}
/** Runs only inside an opaque-origin, network-denied frame's disposable worker. */
export function executeInSandbox<T extends PreviewState | Omit<RunRow, 'variant'>>(
  request: ExecutionRequest,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Cancelled', 'AbortError'));
      return;
    }
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-scripts');
    const token = crypto.randomUUID(),
      channel = new MessageChannel();
    let workerReady = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      channel.port1.close();
      frame.remove();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Run exceeded 30 seconds. Choose a smaller workload.'));
    }, 30000);
    signal?.addEventListener('abort', abort, { once: true });
    const source = `${request.code}\n${executionSource}`;
    const bootstrap = `addEventListener('message',event=>{if(event.source!==parent||event.data.token!==${JSON.stringify(token)})return;const port=event.ports[0];const url=URL.createObjectURL(new Blob([${scriptString(source)}],{type:'text/javascript'}));const worker=new Worker(url);worker.onmessage=event=>{port.postMessage(event.data);worker.terminate();URL.revokeObjectURL(url);};worker.onerror=event=>{port.postMessage({error:event.message||'Run failed'});worker.terminate();};port.onmessage=event=>worker.postMessage(event.data);port.postMessage({ready:true});},{once:true});`;
    frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; connect-src 'none';"><script>${bootstrap.replaceAll('</script', '<\\/script')}</script>`;
    channel.port1.onmessage = async (event) => {
      if (event.data?.ready) {
        if (!workerReady) {
          workerReady = true;
          channel.port1.postMessage(request);
        }
        return;
      }
      if (event.data?.error) {
        cleanup();
        reject(new Error(String(event.data.error)));
        return;
      }
      try {
        const result = event.data.result;
        if (request.kind === 'benchmark') {
          if (typeof result?.checksum !== 'string' || result.checksum.length > 4 * 1024 * 1024)
            throw new Error('Invalid comparison output');
          result.checksum = await sha256(result.checksum);
        }
        if (signal?.aborted) return;
        cleanup();
        resolve(result as T);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    frame.onload = () => frame.contentWindow?.postMessage({ token }, '*', [channel.port2]);
    document.body.append(frame);
  });
}
