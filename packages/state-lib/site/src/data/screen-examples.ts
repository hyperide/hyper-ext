import type { Example } from './examples';
const screenBody = `
function TaskRow({ id, done, title, onToggle }) {
  return <label className="screen-task"><input type="checkbox" checked={done}
    onChange={() => onToggle(id)} /><span>{title}</span><small>{done ? 'Done' : 'Open'}</small></label>
}
// Presentational view: plain values and events, no store import or private hooks.
function TaskView({ a, b, filter, onToggle, onFilter, onComplete }) {
  const remaining = Number(!a) + Number(!b)
  return <section className="example-screen">
    <header><h3>Launch checklist</h3><p><strong>{remaining}</strong> tasks left</p></header>
    <label>Show <select aria-label="Task filter" value={filter} onChange={e => onFilter(e.target.value)}>
      <option value="all">All tasks</option><option value="open">Open tasks</option></select></label>
    {(filter === 'all' || !a) && <TaskRow id="a" title="Draft the announcement" done={a} onToggle={onToggle} />}
    {(filter === 'all' || !b) && <TaskRow id="b" title="Review the release" done={b} onToggle={onToggle} />}
    {remaining === 0 && <p role="status">Ready to launch. The checklist and count agree.</p>}
    <button onClick={onComplete}>Complete both tasks</button>
  </section>
}
// Connected wrapper: choose values here; TaskView can be tested with plain props.
function TaskScreen() {
  READ_STATE
  return <TaskView a={a} b={b} filter={filter} onToggle={toggle} onFilter={setFilter} onComplete={completeBoth} />
}
return <TaskScreen />`;
const initial = `{ tasks: { a: { done: false }, b: { done: false } }, filter: 'all' }`;
const script = `// Watch the checkbox, count and tree after each statement.
toggle('a')
setFilter('open')
completeBoth()
setFilter('all')`;
export const SCREEN_EXAMPLES: Example[] = [
  {
    id: 'task-screen',
    short: 'A complete React screen',
    task: 'screen',
    tech: 'state',
    title: 'A React screen, one store, ordinary values',
    about:
      'One store owns the checklist. Named actions change data; React components subscribe to values. No individual signals are created by the application. Compare the same screen with Zustand: both can make this screen coherent; state adds a broader transaction/history design, not a unique checkbox capability.',
    setup: `const store = createStore(${initial})
const toggle = store.action('Toggle task', (state, id) => { state.tasks[id].done = !state.tasks[id].done })
const setFilter = store.action('Change filter', (state, value) => { state.filter = value })
const completeBoth = store.action('Complete both tasks', state => {
  state.tasks.a.done = true
  state.tasks.b.done = true
})`,
    code: script,
    ui: screenBody.replace(
      'READ_STATE',
      `const a = store.usePath('/tasks/a/done')
  const b = store.usePath('/tasks/b/done')
  const filter = store.usePath('/filter')`,
    ),
  },
  {
    id: 'zustand-task-screen',
    short: 'The same screen · Zustand',
    task: 'screen',
    tech: 'zustand',
    title: 'The same React screen with Zustand',
    about:
      'Zustand provides the shared store and React subscriptions. These explicit immutable updates implement the same checklist behavior. A single set updates both tasks. This example subscribes to the complete snapshot; selectors can narrow it. History and task ownership are separate choices, not things Zustand makes impossible.',
    setup: `const store = zustand.createStore(() => (${initial}))
const toggle = id => store.setState(state => ({
  tasks: { ...state.tasks, [id]: { ...state.tasks[id], done: !state.tasks[id].done } }
}))
const setFilter = filter => store.setState({ filter })
const completeBoth = () => store.setState({ tasks: { a: { done: true }, b: { done: true } } })`,
    code: script,
    ui: screenBody.replace(
      'READ_STATE',
      `const data = React.useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const a = data.tasks.a.done, b = data.tasks.b.done, filter = data.filter`,
    ),
  },
];
