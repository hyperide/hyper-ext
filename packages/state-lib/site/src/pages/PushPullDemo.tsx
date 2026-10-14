import React, { useState } from 'react'

/** Interactive push-pull walkthrough (first R34 illustration made clickable). */
type Phase = 0 | 1 | 2 | 3 // idle, pushed, pulled, done
const N = {
  a: { x: 90, y: 120, label: 'a' },
  b: { x: 230, y: 60, label: 'a×2' },
  c: { x: 230, y: 180, label: 'a>0' },
  d: { x: 380, y: 180, label: 'if(a>0)…' },
}
export default function PushPullDemo() {
  const [phase, setPhase] = useState<Phase>(0)
  const col = (n: 'a' | 'b' | 'c' | 'd') => {
    if (phase === 0) return { fill: 'var(--panel)', stroke: 'var(--grey)', text: 'var(--muted)' }
    if (phase === 1) return n === 'a' ? T.red : n === 'd' ? T.amber : T.red2
    if (phase >= 2) {
      if (n === 'a' || n === 'b') return T.teal
      if (n === 'c') return T.grey // recomputed to same value
      return T.dashed // d never re-ran
    }
    return T.grey
  }
  const CAPTION = [
    'A tiny graph: signal a, computeds a×2 and a>0, and an effect depending on a>0. Press “write a = 2”.',
    'PUSH: the write only paints the graph — direct dependents are dirty, the effect is “check” (maybe dirty). Nothing computed yet. Press “read / flush”.',
    'PULL: a×2 recomputes (new value). a>0 recomputes — same value (true), so the effect below it is never re-run. That skip is glitch-freedom + minimal work.',
  ][Math.min(phase, 2)]
  return <figure className="fig">
    <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
      <button className="tab" onClick={() => setPhase(1)} disabled={phase >= 1}>1 · write a = 2</button>
      <button className="tab" onClick={() => setPhase(2)} disabled={phase !== 1}>2 · read / flush</button>
      <button className="tab" onClick={() => setPhase(0)}>reset</button>
    </div>
    <svg viewBox="0 0 500 240" width="500" role="img" aria-label="Interactive push-pull demo">
      <defs><marker id="parr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="var(--muted)"/></marker></defs>
      {([['a', 'b'], ['a', 'c'], ['c', 'd']] as const).map(([f, t]) => {
        const A = N[f], B = N[t]
        return <line key={f + t} x1={A.x + 26} y1={A.y + (B.y > A.y ? 10 : -10)} x2={B.x - 28} y2={B.y - (B.y > A.y ? 10 : -10)} stroke="var(--muted)" markerEnd="url(#parr)"/>
      })}
      {(Object.keys(N) as (keyof typeof N)[]).map(k => {
        const n = N[k]; const c = col(k)
        return <g key={k}>
          <circle cx={n.x} cy={n.y} r="26" fill={c.fill} stroke={c.stroke} strokeWidth="2" strokeDasharray={c.dash || '0'}/>
          <text x={n.x} y={n.y - 2} fontSize="11" textAnchor="middle" fill={c.text}>{n.label}</text>
          <text x={n.x} y={n.y + 12} fontSize="9" textAnchor="middle" fill={c.text}>{state(k, phase)}</text>
        </g>
      })}
    </svg>
    <figcaption>{CAPTION}</figcaption>
  </figure>
}
const T = {
  red: { fill: 'var(--red-soft)', stroke: 'var(--red)', text: 'var(--red)' },
  red2: { fill: 'var(--red-soft)', stroke: 'var(--red)', text: 'var(--red)' },
  amber: { fill: 'var(--amber-soft)', stroke: 'var(--amber)', text: 'var(--amber)' },
  teal: { fill: 'var(--accent-soft)', stroke: 'var(--accent)', text: 'var(--accent-ink)' },
  grey: { fill: 'var(--panel)', stroke: 'var(--grey)', text: 'var(--muted)' },
  dashed: { fill: 'var(--panel)', stroke: 'var(--grey)', text: 'var(--muted)', dash: '4 3' },
} as Record<string, { fill: string; stroke: string; text: string; dash?: string }>
function state(k: string, phase: Phase): string {
  if (phase === 0) return k === 'a' ? '= 1' : 'clean'
  if (phase === 1) return k === 'a' ? '= 2' : k === 'd' ? 'check' : 'dirty'
  if (k === 'a') return '= 2'
  if (k === 'b') return '4 ✓ new'
  if (k === 'c') return 'true = same'
  return 'not re-run'
}
