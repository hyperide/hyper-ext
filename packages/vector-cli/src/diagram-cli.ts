/** SVG-only CLI, deliberately independent from the vector/WASM expression engine. */
import { readFileSync, writeFileSync } from 'node:fs';
import { asciiToSvg, diagramArrow, diagramFrame, diagramTable, renderDiagram, DIAGRAM_PRESETS, type DiagramOptions, type DiagramSpec, type Point } from './diagram';
export const DIAGRAM_HELP = `DIAGRAM — specification graphics, editable SVG; no WASM initialization

  vecli diagram frame --title "Transaction" --text "Validate → publish" -o frame.svg
  vecli diagram table '[["Phase","Result"],["write","patch"]]' --preset blue
  vecli diagram arrow --from 0,0 --to 240,0 --label "patches"
  vecli diagram scene -i architecture.json -o architecture.svg
  vecli diagram ascii -i architecture.txt --preset state -o architecture.svg
  cat architecture.txt | vecli diagram ascii > architecture.svg

Modes: frame, table (rectangular JSON rows), arrow, scene (JSON elements), ascii.
Common: -i/--input FILE, -o/--output FILE, --preset state|blue|amber|dark,
        --title TEXT, --font-size N, --padding N. One inline input or -i, not both.
Frame:  --text TEXT, --width N, --height N (optional; auto-sized by default).
Table:  --widths 180,240, --no-header. Input rows contain scalar cells only.
Arrow:  --from X,Y, --to X,Y, --label TEXT, --both. Scene arrows also support via.
Scene:  [{"type":"frame","x":0,"y":0,"width":200,"title":"Store","text":"committed"},
         {"type":"arrow","from":[200,50],"to":[300,50],"label":"patches"}]
        Elements: frame, table, arrow, label. Coordinates use SVG units.
ASCII:  +---+ / |, Unicode ┌─┐│└─┘ boxes, connected -> <- ^ v and → ← ↑ ↓.
        Geometry becomes paths; labels stay editable text. Tabs = 4 columns.
        Not a terminal emulator: wide/combining glyph alignment is not guaranteed.

Output is SVG, never arbitrary embedded markup; text is XML-escaped.
Use the expression/wordart mode for outlined-font path art instead of editable text.
`;
const MODES = new Set(['frame','table','arrow','scene','ascii']);
const VALUE_FLAGS = new Set(['--input','--output','--preset','--title','--text','--width','--height','--font-size','--padding','--from','--to','--label','--widths']);
const BOOL_FLAGS = new Set(['--both','--no-header']);
const SHARED = new Set(['--input','--output','--preset','--title','--font-size','--padding']);
const ALLOWED: Record<string, string[]> = {frame:['--text','--width','--height'],table:['--widths','--no-header'],arrow:['--from','--to','--label','--both'],scene:[],ascii:[]};
const number = (raw:string|undefined,name:string):number|undefined => {
  if(raw===undefined) return undefined;
  if(!raw.trim()||!Number.isFinite(Number(raw))) throw new Error(`${name} must be a finite number`);
  return Number(raw);
};
function pair(raw:string|undefined,name:string):Point {
  if(!raw||raw.split(',').length!==2) throw new Error(`${name} requires X,Y`);
  return raw.split(',').map(n=>number(n,name)!) as unknown as Point;
}
async function stdin():Promise<string> {
  if(process.stdin.isTTY) throw new Error('Provide input text, --input FILE, or pipe stdin');
  const parts:Buffer[]=[];let bytes=0;
  for await(const chunk of process.stdin) {
    const b=Buffer.from(chunk);bytes+=b.length;
    if(bytes>1_000_000) throw new Error('Input limit: 1 MB');
    parts.push(b);
  }
  return Buffer.concat(parts).toString('utf8');
}
export async function runDiagramCli(args:readonly string[]):Promise<void> {
  if(!args.length||args.includes('--help')||args.includes('-h')) {process.stdout.write(DIAGRAM_HELP);return;}
  const [mode,...rest]=args;
  if(!MODES.has(mode)) throw new Error(`Unknown diagram mode: ${mode}. Run vecli diagram --help.`);
  const flags=new Map<string,string>();const booleans=new Set<string>();let inline:string|undefined;
  for(let i=0;i<rest.length;i++) {
    const key=rest[i]==='-i'?'--input':rest[i]==='-o'?'--output':rest[i];
    if(VALUE_FLAGS.has(key)||BOOL_FLAGS.has(key)) {
      if(!SHARED.has(key)&&!ALLOWED[mode].includes(key)) throw new Error(`${key} does not apply to ${mode}`);
      if(flags.has(key)||booleans.has(key)) throw new Error(`Duplicate option: ${key}`);
      if(BOOL_FLAGS.has(key)) booleans.add(key);
      else {const value=rest[++i];if(value===undefined||/^--[a-z]/.test(value)) throw new Error(`Missing value for ${key}`);flags.set(key,value);}
    } else if(key.startsWith('-')) throw new Error(`Unknown option: ${key}`);
    else if(inline!==undefined) throw new Error('Use one quoted input argument or --input FILE');
    else inline=key;
  }
  if(inline!==undefined&&flags.has('--input')) throw new Error('Inline input and --input are mutually exclusive');
  const preset=flags.get('--preset')??'state';
  if(!Object.hasOwn(DIAGRAM_PRESETS,preset)) throw new Error(`Unknown preset: ${preset}`);
  const options:DiagramOptions={preset:preset as DiagramOptions['preset'],title:flags.get('--title'),fontSize:number(flags.get('--font-size'),'font size'),padding:number(flags.get('--padding'),'padding')};
  let input=inline;
  if(flags.has('--input')) input=readFileSync(flags.get('--input')!,'utf8');
  if(input!==undefined&&Buffer.byteLength(input)>1_000_000) throw new Error('Input limit: 1 MB');
  let svg:string;
  if(mode==='frame') {
    if(input!==undefined&&flags.has('--text')) throw new Error('Choose input text OR --text, not both');
    svg=diagramFrame({title:flags.get('--title'),text:flags.get('--text')??input??'',width:number(flags.get('--width'),'width'),height:number(flags.get('--height'),'height')},options);
  } else if(mode==='arrow') {
    if(input!==undefined) throw new Error('Arrow mode takes --from and --to, not an input document');
    svg=diagramArrow(pair(flags.get('--from'),'--from'),pair(flags.get('--to'),'--to'),{...options,label:flags.get('--label'),both:booleans.has('--both')});
  } else {
    input ??= await stdin();
    if(mode==='ascii') svg=asciiToSvg(input,options);
    else {
      let data:unknown;try {data=JSON.parse(input);}catch {throw new Error('Invalid JSON input');}
      if(mode==='table') {
        if(!Array.isArray(data)) throw new Error('Table input must be a JSON array of rows');
        const widths=flags.get('--widths')?.split(',').map(n=>number(n,'column width')!);
        svg=diagramTable(data,{...options,widths,header:!booleans.has('--no-header')});
      } else {
        if(!Array.isArray(data)) throw new Error('Scene input must be a JSON array of elements');
        svg=renderDiagram(data as DiagramSpec[],options);
      }
    }
  }
  if(flags.has('--output')) writeFileSync(flags.get('--output')!,svg,'utf8');
  else process.stdout.write(svg);
}
