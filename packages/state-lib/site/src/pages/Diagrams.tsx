import { useMemo, useState } from 'react';
import { asciiToSvg, renderDiagram, DIAGRAM_PRESETS, type DiagramPreset } from '../../../../vector-cli/src/diagram';
import architecture from '../../../../vector-cli/examples/diagrams/architecture.txt?raw';
import transaction from '../../../../vector-cli/examples/diagrams/transaction.json?raw';
import { Code } from '../lib/Code';
const CLI = `bun packages/vector-cli/bin/vecli.ts --help diagram
bun packages/vector-cli/bin/vecli.ts diagram frame --title "Transaction" --text "Validate → publish" --preset state -o frame.svg
bun packages/vector-cli/bin/vecli.ts diagram table '[["Phase","Result"],["write","patch"],["publish","view"]]' --preset blue -o table.svg
bun packages/vector-cli/bin/vecli.ts diagram arrow --from 0,0 --to 240,0 --label "patches" -o arrow.svg
cat architecture.txt | bun packages/vector-cli/bin/vecli.ts diagram ascii > architecture.svg`;
export default function Diagrams() {
  const [input,setInput]=useState(architecture),[mode,setMode]=useState<'ascii'|'scene'>('ascii');
  const [preset,setPreset]=useState<DiagramPreset>('state');
  const rendered=useMemo(()=>{
    try {return {svg:mode==='ascii'?asciiToSvg(input,{preset,title:'Editable specification diagram'}):renderDiagram(JSON.parse(input),{preset,title:'Transaction diagram'}),error:''};}
    catch(e) {return {svg:'',error:String(e)};}
  },[input,preset,mode]);
  const download=()=>{
    const url=URL.createObjectURL(new Blob([rendered.svg],{type:'image/svg+xml;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='state-diagram.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <div className="wrap wide"><header className="page"><p className="kicker">state · specification tools</p><h1>Diagrams, not screenshots</h1><p className="lead">The same dependency-free renderer runs here and in vecli. Borders become paths; text stays editable. No font files, remote services or WASM initialization are required.</p></header>
    <section id="architecture"><h2>Try the real renderer</h2><p>ASCII supports connected box borders and arrows. Use a JSON scene for precise frames, tables and polyline arrows. Wide emoji/combining-glyph terminal alignment is not guaranteed.</p>
      <div className="snippet-controls"><button onClick={()=>{setMode('ascii');setInput(architecture);}}>Architecture ASCII</button><button onClick={()=>{setMode('scene');setInput(transaction);}}>Transaction scene</button>
      <label>Palette <select aria-label="Diagram palette" value={preset} onChange={e=>setPreset(e.target.value as DiagramPreset)}>{Object.keys(DIAGRAM_PRESETS).map(p=><option key={p}>{p}</option>)}</select></label>
      <button disabled={!rendered.svg} onClick={download}>Download SVG</button></div>
      <label>Editable {mode} source<textarea aria-label="Diagram source" spellCheck={false} value={input} onChange={e=>setInput(e.target.value)} className="diagram-source"/></label>
      {rendered.error?<p role="alert">{rendered.error}</p>:<div className="diagram-preview" dangerouslySetInnerHTML={{__html:rendered.svg}}/>}
    </section>
    <section><h2>CLI primitives</h2><p>Run from the repository root. These are implemented vecli commands, not the planned state-cli commands.</p><Code lang="shell">{CLI}</Code>
      <p>Programmatic exports: <code>diagramFrame</code>, <code>diagramTable</code>, <code>diagramArrow</code>, <code>renderDiagram</code> and <code>asciiToSvg</code> in <code>packages/vector-cli/src/diagram.ts</code>. SVG output escapes text, validates geometry and rejects unknown element types. It does not evaluate input as JavaScript.</p>
    </section></div>;
}
