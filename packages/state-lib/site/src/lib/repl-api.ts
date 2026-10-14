import {createShapeLab} from './shape-lab';
import {ShapeLabView} from './ShapeLabView';
import {createElectricReader} from './electric-reader';
import {ElectricReaderView} from './ElectricReaderView';
import * as proto from './proto';
import { reactScope } from './jsx-sandbox';
import * as zustandVanilla from 'zustand/vanilla';
import * as zustandReact from 'zustand/react';
import { useShallow } from 'zustand/react/shallow';
import * as valtioVanilla from 'valtio/vanilla';
import * as valtioReact from 'valtio/react';
import * as immer from 'immer';
import { ScopeWorkbench } from './ScopeWorkbench';

export function replApi(log:(...args:unknown[])=>void, cleanup:(f:()=>void)=>void):Record<string,unknown> {
  return {
    ...proto,...reactScope(),ScopeWorkbench,log,createShapeLab,ShapeLabView,ElectricReaderView,
    createElectricReader(){const reader=createElectricReader();cleanup(reader.stop);return reader;},
    watch(fn:()=>void){const off=proto.watch(fn);cleanup(off);return off;},
    createScope(...args:Parameters<typeof proto.createScope>){const scope=proto.createScope(...args);cleanup(()=>scope.end());return scope;},
    sleep(ms:number){return new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,ms);cleanup(()=>{clearTimeout(timer);reject(new Error('Session reset'));});});},
    memoryStorage(){const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);}};},
    zustand:{...zustandVanilla,...zustandReact,useShallow},valtio:{...valtioVanilla,...valtioReact},immer,
  };
}
