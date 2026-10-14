import { href } from '../lib/router';
import { Code } from '../lib/Code';
import type { ReactNode } from 'react';
import { T } from '../lib/T';
import { ROWS } from '../data/landscape';
import { CATS } from '../data/compare';
import { exampleById } from '../data/examples';
import { DECISION_COUNT, PROTO_LINES, REQ_COUNT, REQ_MAX, SPEC_VERSION } from '../data/facts';

/** Counts are derived from the sources so the front page cannot go stale (R64) — see data/facts.ts. */
const AXIS_COUNT = CATS.reduce((n, c) => n + c.axes.length, 0);
const LIB_COUNT = ROWS.length;

const card = (to: string, tag: string, title: string, body: ReactNode, status?: [string, string]) => (
  <a className="card" href={to} key={title}>
    <span className="tag">{tag}</span>
    <h3>{title}</h3>
    <p>
      {body} {status && <span className={`status ${status[0]}`}>{status[1]}</span>}
    </p>
  </a>
);

export default function Home() {
  return (
    <div className="wrap">
      <header className="page hero">
        <p className="kicker">universal client-state toolkit</p>
        <h1>
          Reading is subscribing.
          <br />
          Writing is an event.
        </h1>
        <T as="p" className="lead big">
          {
            'state aims to be the default choice for client-side state — the way Postgres is for databases. Not one clever idea, but the boring-in-a-good-way universal one: every framework, every backend, every architecture, and out of your way.'
          }
        </T>

        <div className="hero-code">
          <Code repl="read-write">{exampleById('read-write')!.code}</Code>
        </div>

        <div className="hero-honest">
          <b>Read this before anything else.</b> There is no npm package yet. What exists today is a researched
          specification ({REQ_COUNT} numbered requirements, {DECISION_COUNT} recorded decisions), a landscape of{' '}
          {LIB_COUNT} libraries read mostly at source level, and a working ~{PROTO_LINES}-line core prototype you can
          drive on the <a href={href('/playground')}>Playground</a>. Every claim on this site carries a status tag, and
          &ldquo;designed&rdquo; means specified and unbuilt. No number appears here without saying where it came from.
        </div>

        <p className="lnote">
          Not sure where to start? <a href={href('/init')}>Configure your setup</a> — the same questions the CLI will
          ask, answered right here, with the real code behind every choice that already runs.
        </p>
      </header>

      <h2>The three things that are actually different</h2>
      <div className="pitch">
        <section>
          <h3>Selectors and memoization stop being your job</h3>
          <T as="p">
            {
              'A component reads values and is subscribed to precisely the paths it read. No selector functions, no useMemo, no equality arguments, no stale-closure bugs. Redux’s real tax was never boilerplate — it was that every derived value had to be memoized by hand, and getting it wrong was slow, leaky, or silently stale.'
            }
          </T>
          <Code repl="derived">{exampleById('derived')!.code}</Code>
          <p className="lnote">
            <T>
              {
                'The trap everyone else hits: Valtio, MobX and Legend track reads during render, which React Compiler breaks — documented, and silent when it happens ('
              }
            </T>
            <a href="https://github.com/preactjs/signals/issues/652" target="_blank" rel="noreferrer">
              Preact #652
            </a>
            <T>{'). We track reads and still hand React stable snapshots, so both halves hold at once.'}</T>
          </p>
          <p className="lnote">
            <a href={href('/compare')}>Rated against seven libraries</a> ·{' '}
            <a href={href('/playground')}>watch the render counters</a>
          </p>
        </section>
        <section>
          <h3>One write, and the event log comes free</h3>
          <T as="p">
            {
              'Every transaction can record its intent (a named command) and its effect (an exact JSON Patch plus the inverse that undoes it). That single mechanism is undo/redo, time travel, replication between windows, persistence deltas, an offline outbox, and “reproduce the user’s exact session” — instead of six libraries that each solve one of them.'
            }
          </T>
          <T as="p" className="lnote">
            {
              'And it is per slice: a slice that logs nothing compiles down to a plain signal write. You pay for the log where you consume it, which is the opposite of Redux charging every application forever.'
            }
          </T>
          <p className="lnote">
            <a href={href('/concepts')}>How patches and inverse patches work</a> ·{' '}
            <a href={href('/repl/undo')}>watch undo/redo run</a>
          </p>
        </section>
        <section>
          <h3>A compiler, so the library shrinks as you use less of it</h3>
          <T as="p">
            {
              'Svelte proved a framework can compile itself away; Qwik proved a compiler can restructure an application; React Compiler proved auto-memoisation is worth doing — we make it unnecessary instead, since per-path signals invalidate exactly and there is no memo cache to check. Nobody applied any of this to the state layer, which is where the wins are largest — the bundle ends up holding your application’s state machine rather than a framework. Unused modules are stripped, per-path reads lower to direct signal access, and a keystroke node with no external reader stops touching the patch log at all.'
            }
          </T>
          <T as="p" className="lnote">
            {
              'The compiler is Rust (SWC/Oxc) behind a Python CLI, with a TypeScript sidecar only for what genuinely needs the type checker — because no Rust TypeScript type checker has shipped. A fact, not a preference.'
            }
          </T>
          <p className="lnote">
            <a href={href('/cli')}>state-cli: init · migrate · build · lint</a>
          </p>
        </section>
      </div>

      <h2>Honest about the hard parts</h2>
      <div className="pitch two">
        <section>
          <h3>&ldquo;Global state for every keystroke&rdquo; already failed once</h3>
          <T as="p">
            {
              'redux-form is the standing counter-example and it deserves a real answer rather than a slogan. Five specific mechanism defects made it slow: a root dispatch per character, no per-field granularity, whole-form validation, log noise, and permanent serialisability. Each has a mechanism answer here, and the conclusion runs the other way — keystrokes should be inspectable state, provided they are free.'
            }
          </T>
          <p className="lnote">
            <a href={`${href('/concepts')}#redux-form`}>The post-mortem, cause by cause</a>
          </p>
        </section>
        <section>
          <h3>Every idea here has a parent</h3>
          <T as="p">
            {
              'The reactivity algorithm converged years ago and we vendor it rather than pretend to have invented it. Transient coalescing is Zustand’s name, Yjs and Loro’s merge window, LiveStore’s client-only split. The collection contract is TanStack DB’s, implemented natively so their adapters work unchanged. Assembled well is the craft claim; invented is not.'
            }
          </T>
          <p className="lnote">
            <a href={href('/landscape')}>{LIB_COUNT} libraries, what we take from each and why</a>
          </p>
        </section>
      </div>

      <h2>Where things stand</h2>
      <div className="cards">
        {card(
          href('/spec'),
          'spec',
          `Master spec ${SPEC_VERSION}`,
          'Core model, data modelling, layers and automations, tasks and cancellation, compiler, adapters, data layer, retention, remote protocol, CLI, budgets.',
          ['done', 'draft for review'],
        )}
        {card(
          href('/requirements'),
          'source of truth',
          `Requirements R1–R${REQ_MAX}`,
          'Every request recorded in the owner’s own intent, in English; the spec traces to these ids.',
          ['done', 'living'],
        )}
        {card(
          href('/decisions'),
          'log',
          'Decision log',
          `${DECISION_COUNT} decisions with reasons and explicit supersessions — overturned by adding a row, never by deleting one.`,
          ['done', 'living'],
        )}
        {card(
          href('/landscape'),
          'comparison',
          'The State of State',
          `${LIB_COUNT} libraries · seven layers · what we take, why, and a verdict each. Filterable.`,
          ['done', 'v3'],
        )}
        {card(
          href('/concepts'),
          'concepts',
          'Concept explainers',
          'Ten illustrated mechanisms, each showing the failure it prevents — validated by a comprehension protocol, not by taste.',
          ['done', 'v2'],
        )}
        {card(
          href('/brief'),
          'research',
          'Research brief',
          'Codebase audit, landscape by layer, the tensions between requirements, three candidate architectures.',
          ['done', 'done'],
        )}
      </div>

      <h2>Compare, in detail</h2>
      <div className="cards">
        {card(
          href('/compare'),
          'R27',
          'What you get that others don’t',
          `${AXIS_COUNT} axes across five categories, rated against seven libraries, with how-it-works detail on hover and a head-to-head page per library.`,
          ['wip', 'v2'],
        )}
        {card(
          href('/dive-stores'),
          'deep dive',
          'Store prior art',
          'Zustand (deepest), Valtio, Jotai and Legend-State read from their sources — idiom catalogues, footguns, and per-library codemod feasibility.',
          ['done', 'v1'],
        )}
        {card(
          href('/dive-data'),
          'deep dive',
          'Data & reactivity prior art',
          'TanStack DB, signia/@tldraw/state and alien-signals at source level: module maps, code paths, adopt/adapt/avoid verdicts.',
          ['done', 'v1'],
        )}
      </div>

      <h2>Try it, measure it</h2>
      <div className="cards">
        {card(
          href('/playground'),
          'R38',
          'Playground',
          'The same UI in useState, Zustand and the core prototype, with live render counters and a real transaction log. One click, one row.',
          ['wip', 'prototype'],
        )}
        {card(
          href('/bench'),
          'R28',
          'Benchmarks',
          'Runs in your browser on your hardware, plus static numbers that name their source. The full harness is not built yet and the page says so.',
          ['wip', 'v1'],
        )}
        {card(
          href('/devtools'),
          'R39',
          'Devtools compared',
          'On the axes that made Redux DevTools freeze, with our own design entered as a row rather than exempted.',
          ['wip', 'v1'],
        )}
        <div className="card">
          <span className="tag">R32</span>
          <h3>Query layer</h3>
          <p>
            A Datomic-like Rust→wasm database replacing hand-written selector pyramids —{' '}
            <a href={`${href('/concepts')}#queries`}>what&rsquo;s designed so far</a>.{' '}
            <span className="status todo">needs a session with its author</span>
          </p>
        </div>
      </div>

      <footer>
        Vite + React. Dev: <code>bun install &amp;&amp; bun run dev</code> in <code>packages/state-lib/site</code>. The
        built <code>dist/index.html</code> also opens straight from disk.
      </footer>
    </div>
  );
}
