/** Identical workload across all kernels. No DOM, network, workers, or INP in these timings. */
export async function runBenchmark(binaries,{sizes=[1000,1000000],samples=15}={}){
  const now=()=>performance.now(),decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const stats=a=>{const b=[...a].sort((x,y)=>x-y);return {medianMs:b[Math.floor(b.length/2)],p95Ms:b[Math.ceil(b.length*.95)-1],samplesMs:a};};
  let rows=[],sink=0;
  const modules={},compile={};for(const [mode,b64]of Object.entries(binaries)){const t=now();modules[mode]=await WebAssembly.compile(decode(b64));compile[mode]=now()-t;}
  const imports={host:{amount:i=>rows[i].amount,flag:i=>rows[i].flag,id:i=>rows[i].id}};
  const instances={},instantiate={};for(const [mode,module]of Object.entries(modules)){const t=now();instances[mode]=(await WebAssembly.instantiate(module,imports)).exports;instantiate[mode]=now()-t;}
  let seed=812349;const rnd=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  function prepare(n,flagPercent,large=false){
    const begin=now();rows=Array.from({length:n},(_,i)=>({id:(n-i)*3,amount:large?rnd():rnd()%100000,flag:rnd()%100<flagPercent?1:0}));const fixtureMs=now()-begin;
    let t=now();const ids=new Uint32Array(n),amounts=new Uint32Array(n),flags=new Uint32Array(n),aos=new Uint32Array(4*n);
    for(let i=0;i<n;i++){const r=rows[i];ids[i]=r.id;amounts[i]=r.amount;flags[i]=r.flag;aos.set([r.id,r.amount,r.flag,0],i*4);}const packMs=now()-t;
    const memory={},copy={};for(const [mode,e]of Object.entries(instances)){
      const start=(Number(e.__heap_base.value)+15)&~15;
      const ptr={aos:start,ids:start+16*n,amounts:start+20*n,flags:start+24*n,out:start+28*n,result:(start+28*n+512+7)&~7};
      t=now();const need=ptr.result+16;if(e.memory.buffer.byteLength<need)e.memory.grow(Math.ceil((need-e.memory.buffer.byteLength)/65536));const growMs=now()-t;
      t=now();new Uint32Array(e.memory.buffer,ptr.aos,aos.length).set(aos);new Uint32Array(e.memory.buffer,ptr.ids,n).set(ids);new Uint32Array(e.memory.buffer,ptr.amounts,n).set(amounts);new Uint32Array(e.memory.buffer,ptr.flags,n).set(flags);
      copy[mode]={growMs,copyMs:now()-t,bytesCopied:28*n};memory[mode]={...ptr,resultView:new Float64Array(e.memory.buffer,ptr.result,2),outView:new Uint32Array(e.memory.buffer,ptr.out,128)};
    }
    return {n,fixtureMs,packMs,copy,ids,amounts,flags,memory};
  }
  function variants(data,min,cap){
    const {n,ids,amounts,flags,memory}=data;
    const result=new Float64Array(2),out=new Uint32Array(128);
    const values=[{name:'js-objects',result,out,fn:()=>{let count=0,sum=0;for(let i=0;i<n;i++){const r=rows[i];if(r.flag===1&&r.amount>=min){if(count<cap)out[count]=r.id;count++;sum+=r.amount;}}result[0]=count;result[1]=sum;}},
      {name:'js-soa',result,out,fn:()=>{let count=0,sum=0;for(let i=0;i<n;i++)if(flags[i]===1&&amounts[i]>=min){if(count<cap)out[count]=ids[i];count++;sum+=amounts[i];}result[0]=count;result[1]=sum;}}];
    for(const [mode,e]of Object.entries(instances))for(const kernel of ['aos','soa','split',...(mode==='auto'?['explicit','host']:[])] ){
      const p=memory[mode],fn=kernel==='aos'?()=>e.aos(p.aos,n,min,p.out,cap,p.result):kernel==='host'?()=>e.host(n,min,p.out,cap,p.result):()=>e[kernel](p.ids,p.amounts,p.flags,n,min,p.out,cap,p.result);
      values.push({name:`wasm-${mode}-${kernel}`,fn,result:p.resultView,out:p.outView});
    }
    return values;
  }
  const expected=(minimum,cap)=>{let count=0,sum=0;const ids=[];for(const r of rows)if(r.flag===1&&r.amount>=minimum){count++;sum+=r.amount;if(ids.length<cap)ids.push(r.id);}return {count,sum,ids};};
  const verify=(v,expected)=>{v.fn();if(v.result[0]!==expected.count||v.result[1]!==expected.sum||expected.ids.some((id,i)=>id!==v.out[i]))throw new Error(`Mismatch ${v.name}`);};
  let checks=0;
  for(const n of [0,1,2,3,4,5,7,16,51,1009]){const d=prepare(n,70,true);for(const min of [0,0x80000000,0xffffffff])for(const cap of [0,1,3,50])for(const v of variants(d,min,cap)){verify(v,expected(min,cap));checks++;}}
  const results=[];
  for(const n of sizes)for(const scenario of [{name:'sparse',flag:10,min:90000},{name:'mixed',flag:100,min:50000},{name:'dense',flag:99,min:0}]){
    const d=prepare(n,scenario.flag),ref=expected(scenario.min,50),vs=variants(d,scenario.min,50);
    const timings=new Map();for(const v of vs){verify(v,ref);for(let i=0;i<10;i++)v.fn();let loops=1,duration=0;do{const t=now();for(let i=0;i<loops;i++)v.fn();duration=now()-t;if(duration<4)loops*=2;}while(duration<4&&loops<8192);timings.set(v.name,{loops,samples:[]});}
    for(let s=0;s<samples;s++){
      const order=[...vs];for(let i=order.length-1;i>0;i--){const j=rnd()%(i+1);[order[i],order[j]]=[order[j],order[i]];}
      for(const v of order){const tm=timings.get(v.name),t=now();for(let i=0;i<tm.loops;i++)v.fn();const elapsed=(now()-t)/tm.loops;tm.samples.push(elapsed);sink+=v.result[0]+v.result[1];verify(v,ref);}
    }
    results.push({n,scenario:scenario.name,matched:ref.count,cap:50,setup:{fixtureMs:d.fixtureMs,packMs:d.packMs,memory:d.copy},variants:vs.map(v=>({name:v.name,loops:timings.get(v.name).loops,...stats(timings.get(v.name).samples)}))});
  }
  return {runtime:typeof navigator==='object'?navigator.userAgent:'Node',compileMs:compile,instantiateMs:instantiate,checks,samples,sink,results,scope:'Same count, exact uint32->uint64 integer sum <= 2^53, and first 50 IDs. Warm compute only. All setup reported separately. No workers/network/DOM.'};
}
