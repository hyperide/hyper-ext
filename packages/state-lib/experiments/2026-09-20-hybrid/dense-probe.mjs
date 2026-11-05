import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
import {ownJson,beginCopiedJson,beginJsonDraft} from '../2026-09-19-cow/json-draft.mjs';
const fixture=n=>({name:'Board',columns:Array.from({length:Math.ceil(n/200)},(_,c)=>({id:`c${c}`,items:Array.from({length:Math.min(200,n-c*200)},(_,i)=>({id:`i${c*200+i}`,text:'old',done:false}))}))});
const mutation=(draft,value)=>{for(const column of draft.columns)for(const item of column.items)item.text=value;};
const copy=(before,value)=>{const tx=beginCopiedJson(before);mutation(tx.draft,value);return tx.finish();};
const cow=(before,value)=>{const tx=beginJsonDraft(before);mutation(tx.draft,value);return tx.finish();};
// Candidate compiler target for this one known, scalar-only command.
// No arbitrary callback, aliasing, unknown shape or escaped draft is accepted here.
function direct(before,value){
 const columns=new Array(before.columns.length);
 for(let c=0;c<columns.length;c++){
  const column=before.columns[c],items=new Array(column.items.length);
  for(let i=0;i<items.length;i++)items[i]=Object.freeze({...column.items[i],text:value});
  columns[c]=Object.freeze({...column,items:Object.freeze(items)});
 }
 return Object.freeze({...before,columns:Object.freeze(columns)});
}
const methods={copy,cow,direct},rows=[];
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
for(const count of [30,300,1200]){
 const before=ownJson(fixture(count)),saved=structuredClone(before);
 for(const fn of Object.values(methods)){
  const after=fn(before,'updated');assert.deepEqual(after,copy(before,'updated'));assert.deepEqual(before,saved);
  assert(Object.isFrozen(after));assert(Object.isFrozen(after.columns));assert(Object.isFrozen(after.columns[0].items[0]));
 }
 const samples=Object.fromEntries(Object.keys(methods).map(key=>[key,[]]));
 for(let trial=-3;trial<17;trial++)for(const name of trial%2?['direct','cow','copy']:['copy','cow','direct']){
  const history=new Array(40),start=performance.now();let last;
  for(let i=0;i<80;i++){last=methods[name](before,'update'+i);history[i%40]=last;}
  const duration=(performance.now()-start)/80;assert.equal(last.columns[0].items[0].text,'update79');
  for(let i=0;i<40;i++)for(const column of history[i].columns)for(const item of column.items)assert.equal(item.text,'update'+(i+40));
  if(trial>=0)samples[name].push(duration);
 }
 for(const name of Object.keys(methods))rows.push({count,method:name,medianBatchMeanMs:median(samples[name]),maximumBatchMeanMs:Math.max(...samples[name]),samples:samples[name]});
}
const report={node:process.version,rows,method:'17 alternating batches after3 warmups;80 transformations per batch from the same immutable owned base. The last40 versions remain live and every retained row is checked outside timing; freezing and result construction are included.',limits:['Data transformation only: excludes Runtime, history, notification, validation/import and DOM.','Direct function is handwritten as a compiler-target prototype, not emitted by state build.','Restricted known JSON-tree command; it is not a replacement for arbitrary callbacks or shared-reference graphs.','Direct output is not registered as owned by the generic COW helper; automatic interleaving/adoption is not implemented.']};
writeFileSync(new URL('./results/dense-probe.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
for(const row of rows)console.log(JSON.stringify({...row,samples:undefined}));
