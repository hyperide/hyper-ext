import { useState, useSyncExternalStore } from 'react';
import type { ElectricReader } from './electric-reader';
import {safe} from './step-session';
export function ElectricReaderView({reader}:{reader:ElectricReader}) {
  const [endpoint,setEndpoint]=useState(''),[table,setTable]=useState(''),[error,setError]=useState('');
  useSyncExternalStore(reader.subscribe,reader.version,reader.version);const state=reader.inspect();
  return <div className="shape-lab"><b>Real, read-only Electric HTTP connection</b>
    <p>No server or credentials are supplied. Enter your authorised read proxy / shape endpoint. Configuration does not send a request. No writes to Postgres are made.</p>
    <label className="workbench-field">Endpoint<input aria-label="Electric endpoint" value={endpoint} placeholder="https://your-app.example/api/shape" onChange={e=>setEndpoint(e.target.value)}/></label>
    <label className="workbench-field">Table (omit if the proxy sets it)<input aria-label="Electric table" value={table} onChange={e=>setTable(e.target.value)}/></label>
    <div className="workbench-actions"><button className="tab" disabled={state.busy} onClick={()=>{try{reader.configure(endpoint,table);setError('');}catch(e){setError(String(e));}}}>Configure</button>
      <button className="tab" disabled={state.busy||!state.endpoint} onClick={()=>void reader.pull()}>GET next chunk / long poll</button>
      <button className="tab" disabled={state.busy||!state.endpoint||state.offset==='-1'} onClick={()=>void reader.pull(true)}>SSE live stream</button>
      <button className="tab" disabled={!state.busy} onClick={reader.stop}>Stop request</button></div>
    <p role="status">{error||state.phase} · offset {state.offset} · handle {state.handle||'none'} · {state.rows.length} rows</p>
    <div className="shape-columns"><section><h4>Materialised rows</h4><pre>{safe(state.rows)}</pre></section><section><h4>Transport trace</h4><pre>{state.trace.join('\n')}</pre></section></div>
    <p className="lnote">This teaching client keeps data in memory only. Production applications should use the official Electric client / collection adapter and an authorised proxy. A checkpoint without its matching local data is not a durable replica.</p>
  </div>;
}
