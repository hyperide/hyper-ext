/** R84 — the fourteen reasons a `useEffect` gets written, and what replaces each.
 *
 *  The catalogue is the research document
 *  `docs/research/2026-09-04-useeffect-patterns-and-declarative-equivalents.md`;
 *  this is its summary, kept here so the page and the document cannot disagree
 *  about the verdict counts (they are derived, not typed).
 */
import rawSamples from './effect-samples.txt?raw';

export type Verdict = 'codemod' | 'flag' | 'keep' | 'split';
export type EffectPattern = {
  n: number;
  reason: string;
  target: string;
  verdict: Verdict;
  /** What a reader needs in order to believe the verdict. */
  note: string;
};

export const VERDICT_LABEL: Record<Verdict, [string, string]> = {
  codemod: ['done', 'rewritten for you'],
  flag: ['wip', 'flagged, rewritten by hand'],
  split: ['wip', 'depends on the body'],
  keep: ['todo', 'stays an effect'],
};

/**
 * The before/after code samples live in a plain-text sidecar rather than in this
 * file. They are real React, so they call the hooks by name — and the repo's
 * pre-commit hook (scripts/check-react-hooks-import.cjs) scans .ts/.tsx source
 * for a hook call with no matching import, which a code sample inside a string
 * is indistinguishable from. Keeping the samples verbatim
 * matters more than keeping them inline, and .html/.txt content files are already
 * how this site holds sample-bearing prose (see src/content/).
 */
const SAMPLES: Record<string, string> = Object.fromEntries(
  rawSamples
    .split(/^=== /m)
    .filter(Boolean)
    .map((block) => {
      const nl = block.indexOf('\n');
      return [block.slice(0, nl).trim(), block.slice(nl + 1).replace(/\n$/, '')];
    }),
);
export const sampleFor = (n: number, kind: 'before' | 'after'): string | undefined => SAMPLES[`${n}:${kind}`];

export const EFFECTS: EffectPattern[] = [
  {
    n: 1,
    reason: 'Fetch on mount',
    target: 'a collection source',
    verdict: 'codemod',
    note: 'The most common one, and the one that hides a race: two renders in flight, the slower response wins, and the list shows the previous query’s results. A collection source owns the request, so the race has one place to be fixed rather than one per component.',
  },
  {
    n: 2,
    reason: 'Derive state by calling a setter',
    target: 'a derived value',
    verdict: 'codemod',
    note: 'An effect that computes a value from other values and stores it. It renders once with the stale value, then again with the right one, and the two can disagree in between. A derived node has no in-between.',
  },
  {
    n: 3,
    reason: 'Reset state when a prop changes',
    target: 'component-local state, keyed',
    verdict: 'codemod',
    note: 'React’s own documentation calls this one out: the fix is a key, not an effect. Local state keyed by the identity it belongs to resets because it is a different piece of state, not because something noticed and cleared it.',
  },
  {
    n: 4,
    reason: 'Subscribe to another store',
    target: 'a migration, or a source',
    verdict: 'codemod',
    note: 'Usually a bridge to the library being replaced. Where the other store is permanent it becomes a source; where it is on its way out, the codemod removes both sides.',
  },
  {
    n: 5,
    reason: 'Subscribe to a browser API',
    target: 'environment sources',
    verdict: 'codemod',
    note: 'Resize, media query, online, visibility, storage. Each is a value that changes over time — which is what a source is. Every application writes these five by hand, each slightly differently, and each one leaks a listener on some path.',
  },
  {
    n: 6,
    reason: 'Timers and intervals',
    target: 'a declared effect, or a task',
    verdict: 'codemod',
    note: 'A polling interval is a task with a schedule; a debounce is input timing. Both are declarations. The exception that stays is a requestAnimationFrame loop writing to the DOM.',
  },
  {
    n: 7,
    reason: 'Event-handler logic filed in an effect',
    target: 'an action at the call site',
    verdict: 'flag',
    note: 'The code ran on a click but was written as “when this value changes”. Nothing can move it automatically, because only the author knows which event meant it — so the rule points and stops rather than guessing.',
  },
  {
    n: 8,
    reason: 'Chains of effects',
    target: 'a derived value, or one action',
    verdict: 'flag',
    note: 'Effect A sets state that triggers effect B that triggers C. Each step is a render, the order is emergent, and the intermediate states are all observable. Untangling one needs the intent, which is not in the code.',
  },
  {
    n: 9,
    reason: 'Debounce or throttle a write',
    target: 'a rate policy on the binding',
    verdict: 'codemod',
    note: 'Declared next to the control it belongs to, and compiled to a timer at the trigger site — separate from concurrency policy, which is a different mechanism (see the Compare page).',
  },
  {
    n: 10,
    reason: 'Sync to localStorage or the URL',
    target: 'persistence and URL state',
    verdict: 'codemod',
    note: 'Both are already modules with a declaration. The hand-written version reliably forgets one direction — it writes on change but does not read on load, or reads once and never again.',
  },
  {
    n: 11,
    reason: 'Analytics on mount or change',
    target: 'a declared effect on a patch trigger',
    verdict: 'flag',
    note: 'Mechanically this is a reaction to a change and moves cleanly. What is genuinely open is deduplication — “fired once per session” is a policy, and the toolkit has not decided whose job it is.',
  },
  {
    n: 12,
    reason: 'Imperative DOM work',
    target: '— stays an effect',
    verdict: 'keep',
    note: 'Focus, scroll into view, measure, canvas, a third-party widget. The body needs a node that exists only after the render, and no store can hand it one. This is what the escape hatch is for.',
  },
  {
    n: 13,
    reason: 'Cleanup on unmount',
    target: 'the retention middleware, or it stays',
    verdict: 'split',
    note: 'Three different jobs wear this one hook. Cancelling requests and tearing down subscriptions is what a scope already does. Releasing the data a component was keeping alive is the retention middleware’s lease — you declare the lease at the call site and unmount releases it, and the release commits a standard, named transaction (state.lease.release) rather than a bespoke action every project invents for itself. Only the third job stays: releasing a DOM-attached resource — an observer, a media element, a third-party widget — for the same reason as #12.',
  },
  {
    n: 14,
    reason: 'useLayoutEffect',
    target: '— stays an effect',
    verdict: 'keep',
    note: 'Reading layout before paint is the one thing that must run between render and paint. It stays untouched, except for the case where the body only writes state, which never needed layout timing at all.',
  },
];

export const VERDICT_COUNT = EFFECTS.reduce<Record<Verdict, number>>(
  (acc, e) => ({ ...acc, [e.verdict]: (acc[e.verdict] ?? 0) + 1 }),
  {} as Record<Verdict, number>,
);
