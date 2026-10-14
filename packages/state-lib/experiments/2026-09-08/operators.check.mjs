import {test} from 'node:test';import assert from 'node:assert/strict';
import {cases,runCase} from './corpus.mjs';import {q,quantile,variance,histogram} from './operators.mjs';
for(const c of cases)test(`${c.family}: ${c.title}`,()=>runCase(c.id));
test('short circuit prevents unnecessary visits',()=>{let n=0;assert.deepEqual(q([1,2,3,4]).where(x=>{n++;return x%2===0;}).take(1).toArray(),[2]);assert.equal(n,2);});
test('empty and invalid statistics',()=>{assert.equal(quantile([],0.5),null);assert.equal(variance([2],{sample:true}),null);assert.throws(()=>variance([NaN]));assert.throws(()=>histogram([1],[2,2]));assert.throws(()=>q([1]).take(-1));assert.equal(q([]).mean(),null);});
test('hash join duplicates and null handling',()=>{const left=[{k:1},{k:null}],right=[{k:1,v:'a'},{k:1,v:'b'},{k:null,v:'c'}];assert.deepEqual(q(left).join(right,l=>l.k,r=>r.k,{kind:'left',project:(l,r)=>r?.v??null}).toArray(),['a','b',null]);assert.equal(q(left).join(right,l=>l.k,r=>r.k,{kind:'semi'}).count(),1);});
test('sort nulls last, ties stable in either direction',()=>{const a=[{v:null,id:1},{v:2,id:2},{v:undefined,id:3},{v:2,id:4}];assert.deepEqual(q(a).orderBy([['v','desc']]).select(x=>x.id).toArray(),[2,4,1,3]);});
test('noncommuting rewrites remain observable',()=>{assert.notDeepEqual(q([0,1]).take(1).where(Boolean).toArray(),q([0,1]).where(Boolean).take(1).toArray());});
