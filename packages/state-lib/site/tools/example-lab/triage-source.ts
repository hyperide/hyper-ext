/** Synthetic example source. It has no network, authentication or account data. */
export const triageData = `export function seed(count: number) {
  return {
    title: 'Release triage',
    issues: Array.from({length: count}, (_, i) => ({
      id: 'issue-' + i, text: 'Review release item ' + (i + 1), done: false,
      priority: i % 4, estimate: 1 + i % 8
    })),
    columns: [{id:'incoming',title:'Incoming',ids:Array.from({length:count},(_,i)=>i)},
      {id:'scheduled',title:'Scheduled',ids:[]}, {id:'reviewed',title:'Reviewed',ids:[]}]
  };
}
`;
export const triageDeclarations = {
  point: { operation: 'toggle', path: ['issues', { arg: 'id' }, 'done'] },
  dense: { operation: 'each', path: ['issues'], field: 'text', value: { arg: 'text' } },
  sparse: { operation: 'each', path: ['issues'], field: 'text', value: { arg: 'text' }, stride: 10 },
  move: {
    operation: 'move',
    path: ['columns', { arg: 'column' }, 'ids'],
    fromIndex: { arg: 'index' },
    targetPath: ['columns', { arg: 'target' }, 'ids'],
    toIndex: 0,
  },
};
export const triageBodies: Record<string, string> = {
  point: 'draft.issues[args.id].done = !draft.issues[args.id].done;',
  dense: 'for (const issue of draft.issues) issue.text = args.text;',
  sparse: 'for (let i = 0; i < draft.issues.length; i += 10) draft.issues[i].text = args.text;',
  move: 'const ids = draft.columns[args.column].ids;\n    if (!(args.index in ids)) throw new RangeError("Choose an existing issue");\n    const [id] = ids.splice(args.index, 1);\n    draft.columns[args.target].ids.splice(0, 0, id);',
};
export const triageEntry = `import {Runtime} from './state-lib/core.js';
import {createDocumentPublication} from './core/document-publication.mjs';
import {seed} from './data.ts';
import {point} from './point.ts';
import {dense} from './dense.ts';
import {sparse} from './sparse.ts';
import {move} from './move.ts';
const commands = {point,dense,sparse,move};
export function createModel(count = 30, historyLimit = 40) {
  const store = createDocumentPublication(new Runtime(), {initial:seed(count),limit:historyLimit});
  return {
    read:store.read,
    snapshot() {
      const snapshot=store.getSnapshot(), value=snapshot.document;
      return {...snapshot,document:{title:value.title,columns:value.columns.map(column=>({
        id:column.id,title:column.title,items:column.ids.map(id=>value.issues[id])
      }))}};
    },
    step(operation,index=0,text='Triaged issue') {
      if(operation==='undo') return store.undo();
      if(operation==='redo') return store.redo();
      if(operation==='history'){store.undo();return store.redo();}
      const value=store.read(),total=value.columns.reduce((sum,column)=>sum+column.ids.length,0);
      if(!total)return false;
      let position=((index%total)+total)%total,column=0;
      while(position>=value.columns[column].ids.length)position-=value.columns[column++].ids.length;
      const id=value.columns[column].ids[position];
      return store.apply(commands[operation],{column,index:position,id,target:(column+1)%value.columns.length,text});
    },
    dispose:store.dispose
  };
}
`;
