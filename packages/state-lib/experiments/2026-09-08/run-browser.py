"""Chromium execution on an owned about:blank page. No network benchmark, isolation flags or policy changes."""
import json,pathlib,platform,shutil
from playwright.sync_api import sync_playwright
P=pathlib.Path(__file__).parent
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox'])
    page=browser.new_page()
    source=(P/'benchmark.mjs').read_text().replace('export async function runBenchmark','async function runBenchmark')
    result=page.evaluate('''async ({source,binaries})=>{const run=new Function(source+';return runBenchmark;')();return await run(binaries);}''',{'source':source,'binaries':json.loads((P/'results/binaries.json').read_text())})
    result['environment']={'browser':browser.version,'host':platform.platform(),'mode':'about:blank; computation only; no HTTP, workers, SAB, DOM or visual timing'}
    result['byob']=page.evaluate('''async()=>{
      const mem=new WebAssembly.Memory({initial:1,maximum:2});const js=new Uint8Array(mem.buffer);js[32]=77;
      const make=()=>new ReadableStream({type:'bytes',pull(controller){controller.byobRequest.view[0]=42;controller.byobRequest.respond(1);controller.close();}}).getReader({mode:'byob'});
      let wasmRead;const wm=make();try{await wm.read(new Uint8Array(mem.buffer,64,8));wasmRead={accepted:true};}catch(e){wasmRead={accepted:false,name:e.name,message:e.message};}finally{await wm.cancel();}
      const ordinary=new ArrayBuffer(8),r=make();const plain=await r.read(new Uint8Array(ordinary));
      return {sameMemoryRead:new DataView(mem.buffer).getUint8(32),wasmRead,ordinaryBYOB:{value:plain.value[0],originalByteLength:ordinary.byteLength}};
    }''')
    browser.close()
(P/'results/chromium.json').write_text(json.dumps(result,indent=2))
print(result['environment'],result['byob'])
for c in result['results']:
    if c['n']==1000000:print(c['scenario'],{v['name']:round(v['medianMs'],4)for v in c['variants']})
