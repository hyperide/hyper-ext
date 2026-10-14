/** R19/R24/R26 — the interactive `state init` wizard, as a web page. Turns the static transcript
 *  on the CLI page into something a visitor can actually click through: real choices, a live
 *  `state.config.yaml` preview built from the exact schema in spec.md §17.1, and — for every
 *  choice the prototype actually does something for — the real example that demonstrates it.
 *
 *  Vocabulary matches the rest of the site (see data/compare.ts `status`): 'prototyped' means
 *  backed by `lib/proto.ts` and runnable in the REPL today; 'designed' means specified in the
 *  master spec and not built. A third internal-only value, 'na', marks a choice that makes no
 *  claim either way (turning a thing off, or picking "none") — it is never shown as a badge. */
export type Reality = 'prototyped' | 'designed' | 'na';

/** The subset of state.config.yaml (spec.md §17.1) this wizard can produce. Every field name
 *  here is a key that appears in that schema — no key is invented for this page. `framework` is
 *  a bare scalar in the schema (`framework: react`), never a nested object — it is left `undefined`
 *  for the 'vanilla' choice, which has no framework key to write (R19's framework-agnostic core). */
export type ConfigDraft = {
  framework?: 'react' | 'vue' | 'solid' | 'svelte';
  reactMode?: 'tracked' | 'snapshot';
  sources?: string[];
  persist?: string[];
  devtools?: 'off' | 'dev';
};

export type WizardChoice = {
  id: string;
  label: string;
  reality: Reality;
  /** Plain-sentence honesty note, shown under the choice once picked. */
  note: string;
  /** A real REPL example id — set when this choice, or a mechanism underneath it, actually runs. */
  example?: string;
  /** Overrides the default "run it" framing when the example demonstrates a narrower mechanism
   *  than the choice itself claims (the `rest` source: the source is designed, the incremental
   *  collection primitive it would sit on is not). */
  exampleCaption?: string;
  /** An illustrative, non-runnable code sketch for a `designed` choice — rendered without a
   *  "run it" link (nothing behind it exists to run). Never used on a `prototyped` choice. */
  sketch?: string;
  /** External sources backing a specific, checkable fact in `note` (a platform API's own docs,
   *  never an invented number) — R66's "no number without provenance" applied to platform facts
   *  rather than our own measurements. */
  citations?: { url: string; label: string }[];
  apply?: (cfg: ConfigDraft) => void;
};

export type WizardStep = {
  id: string;
  title: string;
  question: string;
  about: string;
  choices: WizardChoice[];
  /** When present, the step is shown only while this returns true for the current selection —
   *  used for the React-only read-tracking-mode step once a framework other than React is picked. */
  visibleWhen?: (selection: Record<string, string>) => boolean;
};

export const WIZARD_STEPS: WizardStep[] = [
  {
    id: 'framework',
    title: 'Framework',
    question: 'Framework',
    about:
      "R19 is explicit that state is framework-agnostic, so this comes before any framework-specific question: which framework you're on. The core (signals + proxy store + patch-emitting transactions + keyed collections, spec §1) is itself framework-agnostic and runs in a browser tab, a Web Worker, a VS Code extension host, or Node/Bun with no adapter at all; React/Vue/Solid/Svelte are adapters built on top of it (§6). v1 GA targets those four behind one conformance suite — anything else ships `preview`.",
    choices: [
      {
        id: 'react',
        label: 'React',
        reality: 'prototyped',
        note: 'The only adapter with anything running today: store.usePath(...) in the prototype is the real React hook binding, exercised live in the REPL.',
        example: 'task-screen',
        apply: (cfg) => {
          cfg.framework = 'react';
        },
      },
      {
        id: 'vue',
        label: 'Vue',
        reality: 'designed',
        note: 'Specified (§6.2): useSlice would return a shallowRef updated by subscription, with a Pinia-coexistence path for teams already on it. No Vue adapter is built.',
        apply: (cfg) => {
          cfg.framework = 'vue';
        },
      },
      {
        id: 'solid',
        label: 'Solid',
        reality: 'designed',
        note: "Specified (§6.3): signals map 1:1 (from(node)), and Solid's <For> would consume our ids directly. No Solid adapter is built.",
        apply: (cfg) => {
          cfg.framework = 'solid';
        },
      },
      {
        id: 'svelte',
        label: 'Svelte',
        reality: 'designed',
        note: 'Specified (§6.4): a createSubscriber bridge into svelte/reactivity, plus a legacy subscribe contract. No Svelte adapter is built.',
        apply: (cfg) => {
          cfg.framework = 'svelte';
        },
      },
      {
        id: 'vanilla',
        label: 'vanilla (core only, no adapter)',
        reality: 'prototyped',
        note: "The framework-agnostic core itself — createStore, derive, actions, undo/redo — runs today with no framework import at all. The example below is the site's own opening claim, and its code path never imports React; only the separate interactive UI block below it does.",
        example: 'read-write',
        exampleCaption: 'the code path only — no framework import anywhere in it',
      },
    ],
  },
  {
    id: 'react',
    title: 'React read tracking',
    question: 'React read tracking mode',
    about:
      'How React components read the store, once React is the framework picked above — this step only applies then. Vue/Solid/Svelte each have their own fine-grained reactivity primitive (a signal accessor subscribes wherever it is read, §4.3) and none of those adapters exist yet, so there is nothing to configure for them here.',
    visibleWhen: (selection) => (selection.framework ?? 'react') === 'react',
    choices: [
      {
        id: 'tracked',
        label: 'tracked (recommended)',
        reality: 'prototyped',
        note: "This is exactly what store.usePath(...) does in the prototype today: a component subscribes only to the paths it actually reads — the same read-path-tracking approach as Valtio's useSnapshot + proxy-compare, with our own fix (a monotonic read set, forced by React Compiler memoisation) layered on top.",
        example: 'collection',
        apply: (cfg) => {
          cfg.reactMode = 'tracked';
        },
      },
      {
        id: 'snapshot',
        label: 'snapshot',
        reality: 'designed',
        note: 'The compiler enforcement that makes useSlice/snapshot mode safe alongside React Compiler is specified (§4.11) and not built — there is no compiler yet.',
        apply: (cfg) => {
          cfg.reactMode = 'snapshot';
        },
      },
    ],
  },
  {
    id: 'sources',
    title: 'Data sources',
    question: 'Data sources',
    about:
      'Where a collection gets its rows from, if anywhere. Listed here are the v1 GA source kinds the spec names explicitly — §16\'s risk table, "Scope creep" row: "v1 GA ... sources beyond rest/rpc/graphql/ws/query ship as experimental" — a fuller list exists (crdt, electric, powersync, rxdb, §8.4) but ships experimental, past what v1 promises.',
    choices: [
      {
        id: 'rest',
        label: 'rest',
        reality: 'designed',
        note: 'A real, auto-fetching, revalidating REST source is not built. What IS real and runnable is the incremental collection primitive a REST source would sit on top of — deriveCollection repairs a filtered/sorted view from patches instead of recomputing it (TanStack DB / IVM-style enter/update/exit deltas, with a signia-style RESET_VALUE fallback when a delta cannot be applied, §4.5), which is the mechanism, not the network wiring.',
        example: 'queries',
        exampleCaption: 'not a running REST source — this is the real primitive underneath one',
        apply: (cfg) => {
          cfg.sources = [...(cfg.sources ?? []), 'rest'];
        },
      },
      {
        id: 'query',
        label: 'query',
        reality: 'designed',
        note: 'Wraps TanStack Query (§8.4) for teams already invested in its cache. Not built. The same deriveCollection primitive linked under `rest` is the incremental layer a query source would also sit on top of, once one exists.',
        apply: (cfg) => {
          cfg.sources = [...(cfg.sources ?? []), 'query'];
        },
      },
      {
        id: 'graphql',
        label: 'graphql',
        reality: 'designed',
        note: 'Queries plus graphql-ws subscriptions (§8.4) — specified, not built. No example exists to show — one would be a fabrication.',
        apply: (cfg) => {
          cfg.sources = [...(cfg.sources ?? []), 'graphql'];
        },
      },
      {
        id: 'rpc',
        label: 'rpc',
        reality: 'designed',
        note: 'A typed contract over a transport — tRPC/oRPC/custom (§8.4) — is specified and not built. No example exists to show — one would be a fabrication.',
        apply: (cfg) => {
          cfg.sources = [...(cfg.sources ?? []), 'rpc'];
        },
      },
      {
        id: 'ws',
        label: 'ws / sse',
        reality: 'designed',
        note: 'Raw WebSocket/SSE streams (§8.4) are specified and not built. No example exists to show — one would be a fabrication.',
        apply: (cfg) => {
          cfg.sources = [...(cfg.sources ?? []), 'ws'];
        },
      },
      {
        id: 'none',
        label: 'none',
        reality: 'na',
        note: 'No source configured. The prototype runs entirely on local state either way.',
      },
    ],
  },
  {
    id: 'persist',
    title: 'Persistence',
    question: 'Persistence',
    about: 'Which paths survive a reload, and where they are written.',
    choices: [
      {
        id: 'indexeddb',
        label: 'indexedDB',
        reality: 'designed',
        note: 'No IndexedDB adapter ships yet. storageAdapter(...) — the one that runs today — only wraps a {getItem, setItem}-shaped synchronous store, which IndexedDB is not. The designed shape is the state/persist/indexeddb package named in the packaging list (§14), called the same way the real adapter is: store.persist(indexedDBAdapter({...})). The one real gap: PersistAdapter today is typed write(patches): void / read(): Patch[] — synchronous, because storageAdapter is — so an IndexedDB adapter needs that type widened to return Promises before it can exist, not just a new adapter behind the existing one.',
        sketch: `import { indexedDBAdapter } from 'state/persist/indexeddb'

// same call shape store.persist(adapter, options) uses today with
// storageAdapter(...) — options.include/exclude are real proto.ts fields —
// but write/read would return Promise<void> / Promise<Patch[]>,
// since IndexedDB has no synchronous API
store.persist(indexedDBAdapter({ db: 'app', store: 'state' }), {
  include: ['/cart', '/session'],
})`,
        apply: (cfg) => {
          cfg.persist = [...(cfg.persist ?? []), 'indexeddb'];
        },
      },
      {
        id: 'localstorage',
        label: 'localStorage',
        reality: 'prototyped',
        note: "Runs today — storageAdapter(...) takes any object shaped like {getItem, setItem}, and localStorage satisfies that natively — but it is usually the wrong default for a real app, not the recommended one. The Web Storage API is fully synchronous: every read and write blocks the main thread until it completes. Its per-origin quota is also small, commonly cited around 5-10 MiB depending on the browser, against IndexedDB's asynchronous, much larger, browser-negotiated one. We keep Zustand's persist-middleware property that sync storage must never cause a hydration flash; the linked example swaps in an in-memory store instead of your real localStorage, but it is the same adapter mechanism.",
        citations: [
          {
            url: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API',
            label: 'MDN — Web Storage API is synchronous, blocks the main thread',
          },
          {
            url: 'https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria',
            label: 'MDN — Storage quotas and eviction criteria',
          },
        ],
        example: 'regions',
        exampleCaption: 'same storageAdapter mechanism, backed by an in-memory store instead of localStorage',
        apply: (cfg) => {
          cfg.persist = [...(cfg.persist ?? []), 'localstorage'];
        },
      },
      {
        id: 'none',
        label: 'none',
        reality: 'na',
        note: 'Nothing persisted. State lives for the tab.',
      },
    ],
  },
  {
    id: 'history',
    title: 'History',
    question: 'History (undo/redo)',
    about:
      'Whether writes are logged so they can be walked backwards. Not a state.config.yaml key in the §17.1 schema shown below — this is a per-store choice — so it shapes the code sample, not the config preview.',
    choices: [
      {
        id: 'on',
        label: 'on',
        reality: 'prototyped',
        note: 'store.undo() / store.redo() are real: undo walks one transaction backwards by applying its inverse patches, so it costs the size of the change, not the size of the state.',
        example: 'undo',
      },
      {
        id: 'off',
        label: 'off',
        reality: 'na',
        note: 'No history kept. Every store can call store.undo() later — turning it off just means nothing is logged.',
      },
    ],
  },
  {
    id: 'regions',
    title: 'Regions',
    question: 'Regions',
    about:
      'A region is a bundle of policy defaults (persist? sync? capture?) that already exist separately — declaring a path’s region names the bundle instead of setting each option one at a time. Also not a top-level state.config.yaml key in §17.1 — it is passed to createStore.',
    choices: [
      {
        id: 'use',
        label: 'use regions',
        reality: 'prototyped',
        note: "store.regionOf(path) and the { regions: {...} } option to createStore are real today: persist(...) already reads region policy to decide what reaches disk, with no separate include/exclude list. Unlike most mechanisms on this page, this one has no cited prior art (§4.16) — the design brief's own brainstorm records candidate region types folded in or rejected (automations, cache) rather than borrowed from another library.",
        example: 'regions',
      },
      {
        id: 'skip',
        label: 'skip',
        reality: 'na',
        note: 'Without a regions option, every path defaults to the "domain" region — the same as always naming it explicitly.',
      },
    ],
  },
  {
    id: 'devtools',
    title: 'Devtools',
    question: 'Devtools',
    about: 'The bridge that would let an external panel inspect the store.',
    choices: [
      {
        id: 'dev',
        label: 'dev',
        reality: 'designed',
        note: 'The devtools page compares nine other tools’ devtools; our own row is explicitly marked "designed" there too. No bridge, patch stream, or panel exists in the prototype.',
        apply: (cfg) => {
          cfg.devtools = 'dev';
        },
      },
      {
        id: 'off',
        label: 'off',
        reality: 'na',
        note: 'No devtools bridge. Nothing to turn off, since none is built yet either way.',
        apply: (cfg) => {
          cfg.devtools = 'off';
        },
      },
    ],
  },
];

/** Recommended defaults on first load — the same combination the CLI page's own transcript
 *  opens with (React, tracked, a source, persistence, history on), so the page starts showing
 *  real, running mechanisms rather than an empty form. */
export const DEFAULT_SELECTION: Record<string, string> = {
  framework: 'react',
  react: 'tracked',
  sources: 'rest',
  persist: 'indexeddb',
  history: 'on',
  regions: 'use',
  devtools: 'dev',
};

export function selectedChoice(step: WizardStep, selection: Record<string, string>): WizardChoice {
  const id = selection[step.id] ?? step.choices[0].id;
  return step.choices.find((c) => c.id === id) ?? step.choices[0];
}

/** The steps actually shown for the current selection — the single filter both the page and the
 *  config preview run, so a hidden step (React read tracking, once a non-React framework is
 *  picked) can never leak a stale choice into the generated YAML while disappearing from the UI. */
export function visibleSteps(selection: Record<string, string>): WizardStep[] {
  return WIZARD_STEPS.filter((step) => !step.visibleWhen || step.visibleWhen(selection));
}

/** Builds the state.config.yaml preview from the current selections — future tense, because
 *  `state init` itself does not exist yet. Only keys from spec.md §17.1 ever appear. */
export function buildConfigYaml(selection: Record<string, string>): string {
  const draft: ConfigDraft = {};
  for (const step of visibleSteps(selection)) {
    selectedChoice(step, selection).apply?.(draft);
  }
  const lines = ['# what `state init` will write, once the CLI ships'];
  lines.push(draft.framework ? `framework: ${draft.framework}` : '# framework: (none) — core only, no adapter');
  if (draft.reactMode) lines.push(`react: { mode: ${draft.reactMode} }`);
  if (draft.sources?.length) lines.push(`sources: { allowed: [${draft.sources.join(', ')}] }`);
  if (draft.persist?.length) lines.push(`persist: { allowed: [${draft.persist.join(', ')}] }`);
  if (draft.devtools) lines.push(`devtools: ${draft.devtools}`);
  return lines.join('\n');
}

/** Every choice across every step that makes a real/designed claim (an 'na' choice — "off",
 *  "none", "skip" — asserts nothing and is excluded from both sides of the ratio). Derived
 *  from WIZARD_STEPS so the count on the page can never drift from the data above (R64's
 *  derived-count convention, same as data/facts.ts). Counts every choice ever defined, not just
 *  the ones visible for the current selection — the ratio describes the wizard's content, not
 *  one click-path through it. */
export const RATED_CHOICES = WIZARD_STEPS.flatMap((s) => s.choices).filter((c) => c.reality !== 'na');
export const REAL_CHOICE_COUNT = RATED_CHOICES.filter((c) => c.reality === 'prototyped').length;
export const RATED_CHOICE_COUNT = RATED_CHOICES.length;
