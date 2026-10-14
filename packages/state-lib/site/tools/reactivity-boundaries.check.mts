import assert from 'node:assert/strict';
import {signal,derive,watch,tx,createStore,region} from '../src/lib/proto';
{
 const a=signal(1), b=derive(()=>a.get()*2), c=derive(()=>a.get()*3), sum=derive(()=>b()+c());
 const values:number[]=[];const stop=watch(()=>values.push(sum()));a.set(2);
 assert.deepEqual(values,[5,10]);stop();
}
{
 const a=signal(1), positive=derive(()=>a.get()>0), values:boolean[]=[];
 const stop=watch(()=>values.push(positive()));a.set(2);assert.deepEqual(values,[true]);a.set(-1);assert.deepEqual(values,[true,false]);stop();
}
{
 const a=signal(1),b=signal(100),total=derive(()=>a.get()*b.get());const seen:number[]=[],raw:number[]=[];
 const stop=watch(()=>seen.push(total()));const off=a.subscribe(()=>raw.push(total()));
 a.set(2);b.set(80);assert.deepEqual(seen,[100,200,160]);
 tx(()=>{a.set(3);assert.equal(total(),240);b.set(70);});
 assert.deepEqual(seen,[100,200,160,210]);assert.deepEqual(raw,[200,210]);stop();off();
}
{
 const x=signal(0);let calls=0;const stop=watch(()=>{x.get();calls++});tx(()=>{x.set(1);stop();});assert.equal(calls,1);
}
{
 const store=createStore({ ui:region.view({open:false}), uint:{n:1}, draft:region.draft({text:''}) });
 assert.equal(store.regionOf('/ui/open'),'view');assert.equal(store.regionOf('/uint/n'),'domain');
 assert.deepEqual(store.snapshot(),{ui:{open:false},uint:{n:1},draft:{text:''}});
 store.action('edit',s=>{s.draft.text='saved';})();assert.equal(store.state.draft.text,'saved');
}
console.log('all assertions passed: diamond, equality, synchronous readers, batching, disposal, inline regions');
