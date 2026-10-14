import { useEffect, useMemo, useRef, useState } from 'react';
import { decodeSnippet } from '../lib/snippet-transfer';
import { useRoute, useAnchor, href } from '../lib/router';
import { LazyEditor } from '../lib/LazyEditor';

export default function Snippet() {
  const route = useRoute();
  const anchor = useAnchor();
  const loaded = useMemo(() => {
    try { return { value: decodeSnippet(anchor.startsWith('code-') ? anchor.slice(5) : route.slice('/repl/snippet/'.length)), error: '' }; }
    catch (e) { return { value: {code: '', lang: 'text'}, error: String(e) }; }
  }, [route, anchor]);
  const [code, setCode] = useState(loaded.value.code);
  const [output, setOutput] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const worker = useRef<Worker | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const generation = useRef(0);
  const stop = () => { ++generation.current; worker.current?.terminate(); worker.current = null; clearTimeout(timer.current); setRunning(false); };
  useEffect(() => { stop(); setCode(loaded.value.code); setOutput([]); }, [loaded]);
  useEffect(() => () => { ++generation.current; worker.current?.terminate(); clearTimeout(timer.current); }, []);
  const js = ['js', 'javascript', 'ts', 'typescript'].includes(loaded.value.lang);
  const run = async () => {
    stop(); const runId = generation.current; setOutput([]); setRunning(true);
    try {
      const { default: SnippetWorker } = await import('../lib/snippet.worker?worker&inline');
      if (generation.current !== runId) return;
      const w = new SnippetWorker(); worker.current = w;
      w.onmessage = e => {
        if (generation.current !== runId) return;
        if (e.data.type === 'done') { stop(); return; }
        setOutput(lines => [...lines.slice(-199), String(e.data.text)]);
        if (e.data.type === 'error') stop();
      };
      w.onerror = e => { setOutput(lines => [...lines, e.message]); stop(); };
      w.postMessage({code});
      timer.current = setTimeout(() => { setOutput(lines => [...lines, 'Stopped after 2 seconds.']); stop(); }, 2000);
    } catch (e) { if (generation.current === runId) { setOutput([String(e)]); stop(); } }
  };
  return <div className="wrap wide">
    <header className="page"><p className="kicker">state · REPL · exact-source editor</p><h1>{loaded.value.title ?? 'Try this snippet'}</h1>
      <p className="lead">The source below is the source you clicked, including its comments and missing dependencies. Nothing runs on opening this link.</p></header>
    {loaded.error ? <p role="alert">{loaded.error}</p> : <>
      <p><strong>{loaded.value.lang}</strong> · {js ? 'JS/TS runs in a stoppable worker. Imports available: lodash, ramda, immutable, immer, @tanstack/db and the local ./view-plan proposal. No DOM or other framework/database runtime. Use log(…) for output; only run code you trust.' : 'Reference-only language: edit and copy it here. No interpreter for this language is loaded.'}</p>
      <LazyEditor value={code} onChange={setCode} minHeight={360} />
      <div className="snippet-controls"><button onClick={run} disabled={!js || running}>Run JavaScript</button><button onClick={stop} disabled={!running}>Stop</button>
        <button onClick={() => {stop(); setCode(loaded.value.code); setOutput([]);}}>Reset exact source</button>
        <a href={href('/repl')}>Runnable examples with libraries, setup and UI →</a></div>
      <pre aria-live="polite" className="pg-code" data-no-try>{output.join('\n') || 'Output appears here after an explicit run.'}</pre>
    </>}
  </div>;
}
