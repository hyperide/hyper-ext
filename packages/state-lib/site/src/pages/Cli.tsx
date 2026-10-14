import { href } from '../lib/router';
import { T } from '../lib/T';
import { useState } from 'react';

/** state-cli — the toolchain half of the product (R24, R26, R30, R36, R40). */

type Cmd = { cmd: string; tag: string; what: string; demo: string; moreLink?: { to: string; label: string } };
const CMDS: Cmd[] = [
  {
    cmd: 'state init',
    tag: 'scaffold',
    what: 'Interactive setup: detects your framework and bundler, asks which parts you want (sync sources, persistence, history, URL state, devtools, worker topology), records every choice as an invariant in state.config.yaml, wires the compiler and lint into your build, and scaffolds a first feature — from a template or straight from an OpenAPI/GraphQL schema into a typed collection.',
    demo: `$ state init
? Framework › react (detected, Vite) / vue / solid / svelte / vanilla
? React integration mode › tracked (recommended) / snapshot
? Data sources › rest, rpc
? Persistence › indexeddb
? History (undo/redo) › per-slice
✔ wrote state.config.yaml (7 invariants)
✔ added @state/compiler to vite.config.ts
✔ added "state lint" to CI
✔ scaffolded src/features/todos (from ./openapi.json)`,
  },
  {
    cmd: 'state migrate',
    tag: 'codemods',
    what: "Planned codemods (HYP-1457; implementation pending) for any refactoring — not just adoption. Four subcommands, because these are different jobs: `from` moves code off another library or approach (Zustand, RTK, React Query, raw useState+fetch hooks) onto state — whole repo or one folder; `shape` switches between ways of using state itself (hooks ↔ many stores ↔ one store); `slice` changes one slice's options (e.g. auto-synced collection → manual write handlers, with typed handler declarations requiring manual implementation of write logic the codemod cannot infer); `mode` changes react/events modes. Intended contract: --analyze first (repo scan + recommendation), a target of ≥80% automation via AST + language services, and an optional --llm pass proposing remaining edits as a reviewable diff. Manual review, binding and implementation remain required wherever the tool cannot infer correct behavior.",
    demo: `$ state migrate from zustand --analyze
  8 stores found · 1.7k lines · est. 92% automatic
  suggestion: shape=single-store, events=commands
$ state migrate from zustand client/stores --llm
✔ 8 stores → slices (312 call sites rewritten)
⚠ 3 sites need review (dynamic selector) → migrate.report.md
✔ llm pass resolved 3/3 — diff staged, nothing committed`,
  },
  {
    cmd: 'state build',
    tag: 'compiler',
    what: 'The disappearing-framework compiler as a standalone step (it normally runs as a Vite/Babel/SWC plugin). Reads your usage, emits only what you use: unused modules stripped, hot-path proxy reads rewritten to direct signal reads, derive chains fused, validators generated from your TS types (typia-style), deoptimization-safe output, and the devtools-maps metadata file.',
    demo: `$ state build --explain src/features/cart
  Cart.tsx        mode=tracked (default)
  CartTable.tsx   mode=snapshot (React Compiler active here)
  events          commands only (no patch consumers)
  stripped        history, url, remote (unused)
  bundle          4.1 kB (budget 7 kB) ✔`,
  },
  {
    cmd: 'state lint',
    tag: 'invariants',
    what: 'Enforces what your project chose in state.config.yaml: exactly one approach per axis. A stray second store library, ad-hoc fetch+useState where collections are mandated, a tracked component in a React-Compiler zone — CI fails with the exact codemod that fixes it. It is also where useEffect goes to die: two rules, one that forbids an effect whose body reads state and writes state, and one that warns on any surviving effect at all — the full catalogue of fourteen reasons and their replacements has its own page. Ships as a CLI and an ESLint plugin so violations surface in the editor.',
    demo: `$ state lint
✖ client/widgets/Chart.tsx uses zustand (forbidden since migration)
  fix: state migrate from zustand client/widgets
✖ client/pages/Repos.tsx: fetch+useState data hook
  fix: state migrate slice repos --to collection
✖ client/cart/Total.tsx:14 no-effect-for-state
  reads /cart/items, writes /cart/total → derive
  fix: state migrate from useeffect client/cart/Total.tsx
⚠ client/Row.tsx:31 effect-must-be-dom (1 remaining, was 46)
3 problems (3 fixable via state migrate) · 1 warning`,
    moreLink: { to: '/effects', label: 'the full catalogue of fourteen reasons and their replacements' },
  },
  {
    cmd: 'state doctor',
    tag: 'advice',
    what: 'Advisory checks that apply to any project (warnings, not gate): module-level singletons, proxies in hot loops, transient state that persists, unbounded history, sync handlers resolving before ack. --explain <Component> prints the compiler\'s decisions for one file — the answer to "why did this re-render".',
    demo: `$ state doctor --explain TodoRow
  TodoRow subscribes: /items/41/done, /items/41/text
  re-renders on: those 2 paths only
  mode: tracked · patches: not generated (no consumer)`,
  },
  {
    cmd: 'state bench',
    tag: 'budgets',
    what: 'Runs the performance and size budgets against your real project: bundle per entry, reactivity scenarios on your own slices, list operations on your largest collection, replication payload sizes. Fails CI on regression — budgets are commitments, not aspirations.',
    demo: `$ state bench
  bundle core+used modules   5.8 kB / 7 kB ✔
  10k-row toggle (yours)     0.4 ms ✔ (budget 1 ms)
  postMessage patch p95      3.1 KiB ✔ (budget 10 KiB)`,
    moreLink: { to: '/bench', label: 'the full benchmark page' },
  },
  {
    cmd: 'state docs',
    tag: 'search',
    what: 'Full-text + semantic search over the toolkit docs and your project\'s own manifest — built for humans and for AI agents helping them. The same index powers the MCP server, so an agent can answer "where is optimistic rollback configured in this repo?" with a file and line.',
    demo: `$ state docs "undo across collaborators"
  1. concepts: inverse patches (origin-scoped undo)
  2. spec §4.10 History
  3. your project: cart.history = { scope: 'complex' }`,
    moreLink: { to: '/concepts#g-inverse-patches', label: 'inverse patches, explained' },
  },
];

export default function Cli() {
  const [active, setActive] = useState(0);
  const cmd = CMDS[active];
  return (
    <div className="wrap wide">
      <header className="page">
        <T as="p" className="kicker">
          {'state-cli · R24 R26 R30 R36 R40'}
        </T>
        <h1>The toolchain is half the product</h1>
        <T as="p" className="lead">
          {
            'A store you adopt with codemods, configure with enforced invariants, and ship through a compiler — that is the difference between a library and infrastructure. Every command runs as an interactive TUI for humans and with --json for machines and agents; the MCP server (MCP — the emerging standard AI coding agents use to call tools) exposes the same operations to AI tooling (R25).'
          }
        </T>
      </header>
      <div className="cli-layout">
        <div className="cli-list">
          {CMDS.map((c, i) => (
            <button
              key={c.cmd}
              className={`cli-item${i === active ? ' on' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => setActive(i)}
            >
              <code>{c.cmd}</code>
              <span className="tag">{c.tag}</span>
            </button>
          ))}
        </div>
        <div className="cli-detail">
          <h2>
            <code>{cmd.cmd}</code>
          </h2>
          <T as="p" className="lead">
            {cmd.what}
          </T>
          <pre className="pg-code term">
            <code>{cmd.demo}</code>
          </pre>
          {cmd.cmd === 'state init' && (
            <p className="lnote">
              <a href={href('/init')}>Try this as an interactive constructor →</a>
            </p>
          )}
          {cmd.moreLink && (
            <p className="lnote">
              <a href={href(cmd.moreLink.to)}>{cmd.moreLink.label}</a>
            </p>
          )}
        </div>
      </div>
      <T as="p" className="lead">
        {
          'Under the hood, one shared analyzer (the TS compiler API wrapped as a service) powers the compiler, every codemod, the ESLint plugin, the LSP integration and the agent MCP — the TypeScript language-service model applied to state. The CLI shell itself is Python with a rig-style TUI; the analysis is TypeScript, spoken over JSON-RPC (decision #14).'
        }
      </T>
      <footer>
        Command surfaces are the spec (§11) rendered as UX; transcripts are illustrative until the CLI ships.
      </footer>
    </div>
  );
}
