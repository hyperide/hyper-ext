import type { Example } from './examples';
import { SHAPE_SCENARIOS, type ShapeScenario } from '../lib/shape-lab';

const shapes = (Object.keys(SHAPE_SCENARIOS) as ShapeScenario[]).map(
  (scenario): Example => ({
    id: `sync-${scenario}`,
    task: 'sync',
    title: SHAPE_SCENARIOS[scenario].title,
    short: scenario,
    about: `${SHAPE_SCENARIOS[scenario].why} Deterministic teaching model, not a running Electric server or a benchmark. Use Step for one protocol action, then edit either table with the controls.`,
    setup: `const lab = createShapeLab('${scenario}')`,
    code:
      scenario === 'large'
        ? `lab.setProgressive(true)
lab.start()
lab.pull(4)
lab.write('2', { value: 999 })
lab.pull(100)
lab.pull(10)
log(lab.inspect())`
        : scenario === 'resume'
          ? `lab.start()
lab.pull(100)
lab.pull()
lab.disconnect()
lab.remove('2')
lab.write('3', { value: 999 })
lab.reconnect()
lab.pull()
lab.retry()
log(lab.inspect())`
          : scenario === 'reset'
            ? `lab.start()
lab.pull(100)
lab.pull()
lab.disconnect()
lab.expire()
lab.reconnect()
lab.pull()
lab.start()
lab.pull(100)
lab.pull()
log(lab.inspect())`
            : `lab.start()
lab.pull(3)
lab.write('2', { value: 99 })
lab.pull(100)
lab.pull(10)
lab.write('3', { project: 'other' })
lab.pull(10)
log(lab.inspect())`,
    ui: 'return <ShapeLabView lab={lab} />',
  }),
);
export const LEARNING_EXAMPLES: Example[] = [
  {
    id: 'lazy-ui',
    task: 'reactivity',
    title: 'Lazy derive, eager UI subscriber',
    short: 'lazy vs observed',
    about:
      'Watch is a UI-subscription analogue here. A write marks the graph, the sink checks/pulls its sources, then receives the new result. The unused derive stays unevaluated until explicitly read.',
    setup: `const price = signal(10)
const qty = signal(2)
let calls = 0
const total = derive(() => { calls++; return price.get() * qty.get() })
let unusedCalls = 0
const unused = derive(() => { unusedCalls++; return price.get() * 100 })`,
    code: `const unsubscribe = watch(() => log('UI observes', total()))
price.set(12)
log({calls, unusedCalls})
log('explicit unused read', unused())
log({calls, unusedCalls})`,
  },
  {
    id: 'diamond',
    task: 'reactivity',
    title: 'One write through a diamond',
    short: 'diamond',
    about:
      'Both branches are invalidated before the reader runs. A correct pull sees left and right at the same source version.',
    setup: `const a = signal(1)
const left = derive(() => a.get() * 2)
const right = derive(() => a.get() * 3)
const sum = derive(() => left() + right())`,
    code: `const unsubscribe = watch(() => log('sum', sum()))
a.set(2)
log('must be 10, never a mixed 7 or 8', sum())`,
  },
  {
    id: 'writes-unbatched',
    task: 'reactivity',
    title: 'Two independent writes expose an intermediate total',
    short: 'without batch',
    about:
      'This is a synchronous subscriber, not a claim about a browser paint. Two writes cause two completed notification cycles. Step shows the real intermediate total of 200.',
    setup: `const qty = signal(1)
const price = signal(100)
const total = derive(() => qty.get() * price.get())
const observed = []
const unsubscribe = watch(() => { observed.push(total()); log('subscriber', total()) })`,
    code: `qty.set(2)
price.set(80)
log(observed) // [100, 200, 160]`,
  },
  {
    id: 'writes-batched',
    task: 'reactivity',
    title: 'A batch defers subscribers, not explicit reads',
    short: 'with batch',
    about:
      'tx groups the intent into one notification boundary. It is synchronous batching, not rollback, async isolation or two-phase commit. Reading total inside the body deliberately sees current partially edited state.',
    setup: `const qty = signal(1)
const price = signal(100)
const total = derive(() => qty.get() * price.get())
const observed = []
const unsubscribe = watch(() => { observed.push(total()); log('subscriber', total()) })`,
    code: `tx(() => {
  qty.set(2)
  log('explicit read inside batch', total()) // 200; not a subscriber notification
  price.set(80)
})
log(observed) // [100, 160]`,
  },
  ...shapes,
  {
    id: 'electric-http',
    task: 'sync',
    short: 'real HTTP',
    title: 'Read a real authorised Electric shape',
    about:
      'Real fetch and real protocol messages, not simulated requests. Bring your own authorised read endpoint; no service or credentials is bundled. The small reader covers HTTP chunks, 409/refetch and optional SSE display; it is not the official production SDK. Network work needs CORS and does not stop at debugger checkpoints.',
    setup: 'const reader = createElectricReader()',
    code: `log('Configure an authorised endpoint in the UI, then request a chunk.')
log('For production use @electric-sql/client; do not put privileged database credentials in this page.')`,
    ui: 'return <ElectricReaderView reader={reader} />',
  },
];
