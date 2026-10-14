/** derive() — the lazy cached computed that selectors became (§4.3).
 *  The properties under test are the ones a memoised selector cannot give you:
 *  it does not run until read, it does not re-run when nothing it read changed,
 *  and its dependency list is discovered rather than written by a person. */
import { signal, derive, watch, tx } from '../src/lib/proto'

let failed = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`)
}

// --- lazy: the body does not run until someone reads ---
{
  const a = signal(1)
  let runs = 0
  const double = derive(() => { runs++; return (a.get() as number) * 2 })
  eq('not computed before it is read', runs, 0)
  eq('reading computes', double(), 2)
  eq('and it ran once', runs, 1)
  eq('reading again is cached', [double(), runs], [2, 1])
}

// --- a write marks, it does not compute ---
{
  const a = signal(1)
  let runs = 0
  const double = derive(() => { runs++; return (a.get() as number) * 2 })
  double()
  a.set(5)
  eq('a write does not recompute an unread derivation', runs, 1)
  eq('the next read does', [double(), runs], [10, 2])
}

// --- writing a value it did not read must not invalidate it ---
{
  const a = signal(1)
  const unrelated = signal('x')
  let runs = 0
  const d = derive(() => { runs++; return (a.get() as number) + 1 })
  d()
  unrelated.set('y')
  d()
  eq('an unrelated write causes no recompute', runs, 1)
}

// --- dependencies are discovered, including when they change shape ---
{
  const flag = signal(true)
  const x = signal(10)
  const y = signal(20)
  let runs = 0
  const pick = derive(() => { runs++; return flag.get() ? x.get() : y.get() })
  eq('reads the taken branch', pick(), 10)
  y.set(99)
  eq('writing the untaken branch does not recompute', [pick(), runs], [10, 1])
  flag.set(false)
  eq('switching the branch recomputes and now tracks y', pick(), 99)
  x.set(-1)
  const before = runs
  pick()
  eq('and no longer tracks x', runs, before)
}

// --- chains propagate without being wired ---
{
  const a = signal(2)
  const b = derive(() => (a.get() as number) * 3)
  const c = derive(() => b() + 1)
  eq('a chain computes', c(), 7)
  a.set(10)
  eq('and follows a write at the root', c(), 31)
}

// --- a watch over a derivation re-runs when the derivation changes ---
{
  const a = signal(1)
  const d = derive(() => (a.get() as number) * 2)
  const seen: number[] = []
  watch(() => { seen.push(d()) })
  a.set(3)
  a.set(4)
  eq('the watcher saw each value', seen, [2, 6, 8])
}

// --- a transaction still yields one settled read ---
{
  const a = signal(0)
  const b = signal(0)
  let runs = 0
  const sum = derive(() => { runs++; return (a.get() as number) + (b.get() as number) })
  sum()
  tx(() => { a.set(1); b.set(2) })
  eq('two writes in one transaction, then one recompute on read', [sum(), runs], [3, 2])
}

console.log(failed ? `\n${failed} assertion(s) failed` : '\nall assertions passed')
process.exit(failed ? 1 : 0)
