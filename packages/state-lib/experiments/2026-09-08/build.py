"""Use the installed compiler; preserve commands, remarks, assembly and binary hashes."""
import base64,hashlib,json,pathlib,subprocess
P=pathlib.Path(__file__).parent; R=P/'results'; R.mkdir(exist_ok=True)
info={'compiler':subprocess.check_output(['clang','--version'],text=True),'modes':{}}
binaries={}
for mode,flags in [('scalar',['-fno-vectorize','-fno-slp-vectorize']),('auto',['-msimd128'])]:
    common=['clang','--target=wasm32','-O3','-nostdlib',str(P/'simd.c'),*flags]
    cmd=common+['-Wl,--no-entry','-Wl,--export-memory','-Wl,--export=__heap_base','-Wl,--initial-memory=131072','-o',str(R/(mode+'.wasm'))]
    subprocess.run(cmd,check=True)
    asm=R/(mode+'.s')
    p=subprocess.run(common+['-Rpass=loop-vectorize','-Rpass-missed=loop-vectorize','-Rpass-analysis=loop-vectorize','-S','-o',str(asm)],capture_output=True,text=True,check=True)
    (R/(mode+'-vectorizer.txt')).write_text(p.stderr)
    data=(R/(mode+'.wasm')).read_bytes();binaries[mode]=base64.b64encode(data).decode()
    text=asm.read_text()
    info['modes'][mode]={'command':cmd,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'vectorInstructionsInAssembly':sum(('i32x4.' in l or 'i64x2.' in l or 'v128.' in l) for l in text.splitlines())}
(R/'build.json').write_text(json.dumps(info,indent=2));(R/'binaries.json').write_text(json.dumps(binaries))
print(json.dumps(info,indent=2))
