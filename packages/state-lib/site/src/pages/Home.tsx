import { href } from '../lib/router';
import { LandingDemo } from '../lib/LandingDemo';
import { SiteIcon } from '../lib/SiteIcon';
import measurements from '../../tools/bench-results.json';

const measuredSuite = measurements.suites.find((suite) => suite.suite.startsWith('R66'));
const recompute = measuredSuite?.rows.find((row) => row.name === 'recompute · 10,000 rows');
const incremental = measuredSuite?.rows.find((row) => row.name.startsWith('deriveCollection · 10,000 rows'));
const familiar = (path: string, text: string) => <a href={href(path)}>{text} →</a>;
export default function Home() {
  return (
    <div className="landing-page model-landing">
      <header className="landing-hero wrap">
        <div className="landing-intro">
          <span className="landing-status">
            <span />
            Working prototype · public design in progress
          </span>
          <p className="kicker">STATE MANAGEMENT · UX BY DEFAULT</p>
          <h1>
            One state model. <br />
            <span>Fewer places for bugs to hide.</span>
          </h1>
          <p className="landing-lead">
            state is a client-state library built around one inspectable model: your data, form drafts and async states
            belong together. Components show values and send actions. The state layer coordinates the change.
          </p>
          <div className="landing-ctas">
            <a className="landing-primary" href={href('/repl/task-screen')}>
              Build a real screen <SiteIcon name="updates" />
            </a>
            <a className="landing-secondary" href={href('/landscape')}>
              Find the model you know →
            </a>
          </div>
          <p className="landing-subnote">
            Familiar store ergonomics. Fine-grained reads. A path to coherent updates, replayable scenarios and safer
            async UX.
          </p>
          <p className="landing-source-link">
            <a href="https://github.com/hyperide/hyper-saas/tree/main/packages/state-lib">
              Explore the source <SiteIcon name="updates" />
            </a>
            <span>Source available · Elastic-2.0 · not yet a stable v1 package</span>
          </p>
        </div>
        <LandingDemo />
      </header>

      <section className="landing-section wrap" aria-labelledby="one-model">
        <div className="section-heading">
          <p className="kicker">GLOBAL STATE. LOCAL INTEREST.</p>
          <h2 id="one-model">Share the address. Not every update.</h2>
          <p>
            The architectural choice is to keep application state in one model — including transient screen state. It
            does not mean one process-wide singleton, one giant subscription, or persisting every keystroke.
          </p>
        </div>
        <div className="model-comparison">
          <div>
            <h3>What stays familiar</h3>
            <p>
              Like Redux and Zustand, one store gives an update a home. Like tracked snapshots and signals, readers
              should depend on the values they actually use. A component does not need to maintain another signal for
              every store field.
            </p>
            {familiar('/lib/zustand', 'Compare the shared-store model')}{' '}
            {familiar('/concepts#push-pull', 'Understand the dependency layer')}
          </div>
          <div>
            <h3>What state is trying to make the default</h3>
            <p>
              Named changes, atomic publication, scoped ownership and inspectable history work together. A store is
              created per app session, test or story; regions own shorter lifetimes. Shared does not mean immortal or
              shared across users.
            </p>
            {familiar('/repl/task-screen', 'See two components read one model')}{' '}
            {familiar('/spec#s4-7', 'Read the ownership contract')}
          </div>
        </div>
      </section>

      <section className="landing-playband" aria-labelledby="why-global">
        <div className="wrap">
          <div className="section-heading">
            <p className="kicker">WHAT THE GLOBAL MODEL UNLOCKS</p>
            <h2 id="why-global">A bug report, a test and a story can start from the same state.</h2>
            <p>
              The benefit is not centralization for its own sake. It is having a complete application-level context that
              you can inspect, seed and deliberately change.
            </p>
          </div>
          <div className="global-benefits">
            <article>
              <span className="readiness">WORKING BUILDING BLOCKS · CAPTURE PIPELINE PLANNED</span>
              <h3>Turn a production failure into a reproducible scenario.</h3>
              <p>
                A snapshot plus named changes can preserve the state that led to a broken screen. Capture also needs the
                application version and relevant inputs: responses, time, randomness and event order. A store alone
                cannot reproduce every network, browser or timing bug.
              </p>
              {familiar('/devtools', 'Capture and replay boundaries')}{' '}
              {familiar('/repl/undo', 'Inspect actual changes')}
            </article>
            <article>
              <span className="readiness">RUNNABLE SCREEN FIXTURES</span>
              <h3>Test behavior without reconstructing the whole app.</h3>
              <p>
                Create a fresh store for each test. Give a presentational component plain data and event callbacks; give
                its connected wrapper an isolated model. Loading, validation failures and conflicts become fixtures
                instead of click-through rituals.
              </p>
              {familiar('/init#react-screen', 'Read the real React component')}
              <a href="https://storybook.js.org/docs/writing-stories/build-pages-with-storybook">
                Storybook: containers and presentational views ↗
              </a>
            </article>
            <article>
              <span className="readiness">SHARED DATA · SCOPED LIFETIME</span>
              <h3>Share a draft without lifting it out of a component.</h3>
              <p>
                When a summary, sidebar or another screen needs the field, subscribe to its existing address. The value
                does not need to move up the React tree. You still choose the region lifetime and permissions; changing
                who can read something is not the same as keeping it forever.
              </p>
              {familiar('/repl/task-screen', 'Use one model in several views')}{' '}
              {familiar('/concepts#signals-streams', 'Stores, signals and streams')}
            </article>
            <article>
              <span className="readiness">INSPECTION WORKS · FULL DEVTOOLS PLANNED</span>
              <h3>See the state you normally lose between components.</h3>
              <p>
                Form drafts, modal state and request phases can share an inspectable timeline. The same boundaries can
                support Undo, unsaved-work detection, navigation guards and recovery. DOM handles, secrets and
                unrecorded external effects are not magically captured.
              </p>
              {familiar('/repl/undo', 'Explore history')} {familiar('/repl/lifecycle', 'Explore task lifetime')}
            </article>
          </div>
          <p className="model-footnote">
            These are not exclusive to state: Redux already supports centralized debugging and time travel. The
            differentiator we are building is the combination of granular reads, coherent changes and lifecycle policies
            without rebuilding the glue for every screen.{' '}
            <a href="https://redux.js.org/">Redux’s own architectural overview ↗</a>
          </p>
        </div>
      </section>

      <section className="landing-section wrap" aria-labelledby="safe-async">
        <div className="section-heading">
          <p className="kicker">UX BY DEFAULT, NOT A REMINDER IN A CHECKLIST</p>
          <h2 id="safe-async">Loading and error are states of the feature — not optional decorations.</h2>
          <p>
            The design goal is an exhaustive rendering boundary: idle, loading, success, empty, error and cancellation
            have explicit behavior. An incomplete binding should be rejected or receive a defined fallback, not silently
            ship a blank screen.
          </p>
        </div>
        <div className="model-comparison">
          <div>
            <h3>What works today</h3>
            <p>
              The prototype and typed pilot provide task ownership, cancellation and protection against obsolete
              results. The workbench lets you inspect live state while exercising real actions. You can build explicit
              status models and test their visible outcomes.
            </p>
            {familiar('/repl/lifecycle', 'Run a cancellation scenario')}{' '}
            {familiar('/repl/task-screen', 'Explore a complete screen')}
          </div>
          <div>
            <h3>What is not yet a universal guarantee</h3>
            <p>
              Simply installing today’s package does not force every component to handle every state. A mandatory
              exhaustive async binding and full capture/replay remain implementation work. A valid type cannot, by
              itself, ensure an error message is useful or a retry policy is correct.
            </p>
            <a href="https://tanstack.com/query/latest/docs/framework/react/guides/queries">
              TanStack Query also models pending, error and success ↗
            </a>
            {familiar('/spec#s4-15', 'Read the task contract')}
          </div>
        </div>
      </section>

      <section className="landing-section wrap" aria-labelledby="forms-without-broadcasts">
        <div className="section-heading">
          <p className="kicker">THE REDUX-FORM LESSON</p>
          <h2 id="forms-without-broadcasts">A shared form must not become a global broadcast.</h2>
          <p>
            Keeping every draft in the model only helps if a keystroke does not copy the whole document, revalidate
            every field or rerender the entire form. Those are mechanisms to measure, not problems solved by renaming a
            store.
          </p>
        </div>
        <div className="global-benefits on-light">
          <article>
            <h3>Subscribe to the field, not the universe.</h3>
            <p>
              Read tracking and targeted subscriptions should update only interested views. Selectors need stable
              snapshots and dependencies; an unrelated write must leave them alone.
            </p>
            {familiar('/repl/derived', 'Inspect a patch-driven collection')}
          </article>
          <article>
            <h3>Keep incomplete input intact.</h3>
            <p>
              A user can type a partial date or a trailing decimal point without immediately overwriting it with a
              formatted domain value. Raw input, parsed value, validation and presentation need different
              responsibilities.
            </p>
            {familiar('/repl/conversion', 'Try incomplete input')}
          </article>
          <article>
            <h3>Apply policy at the right scope.</h3>
            <p>
              Persistence, expensive validation, cross-field derivation and history need explicit scheduling and
              retention. A shared address does not require serializing or saving every keystroke.
            </p>
            {familiar('/repl/regions', 'Inspect region policies')}
          </article>
          <article>
            <h3>Measure the typing path.</h3>
            <p>
              The common typed core, normalized data and structural sharing are still being integrated. Some measured
              app paths remain slower and have more glue than their baseline. No claim that all Redux-form-era costs are
              already eliminated.
            </p>
            {familiar('/bench', 'Review the measurements')}
          </article>
        </div>
        <p className="lnote">
          <a href="https://redux.js.org/faq/performance">
            Redux also recommends normalization, granular subscriptions and shallow copies
          </a>
          . <a href="https://redux.js.org/faq/organizing-state">Its form-state guidance</a> is the tradeoff this
          architecture must answer with evidence, not a claim that Redux inherently rerenders everything.
        </p>
      </section>

      <section className="landing-section wrap model-evidence" aria-labelledby="measured-value">
        <div className="section-heading">
          <p className="kicker">MEASUREMENT BEFORE SUPERLATIVES</p>
          <h2 id="measured-value">Show the mechanism. Show its cost.</h2>
          <p>
            A narrow improvement is not an application-wide speedup. The public harness records both wins and overhead,
            with the workload and environment next to the result.
          </p>
        </div>
        {recompute && incremental && (
          <div className="evidence-pair">
            <article>
              <p>Full view recomputation</p>
              <strong>{recompute.ms} ms</strong>
            </article>
            <article>
              <p>Actual patch-driven prototype</p>
              <strong>{incremental.ms} ms</strong>
            </article>
          </div>
        )}
        <p>
          Historical isolated workload: 10,000 rows and 200 single-item updates. Source run{' '}
          <code>{measurements.provenance.commit}</code>, {measurements.provenance.ranAt.slice(0, 10)},{' '}
          {measurements.provenance.cpu}, headless Chromium. Different runs and devices are not comparable. This does not
          measure a whole React screen, every selector, or the native kernel.
        </p>
        <p>
          {familiar('/bench', 'Rerun the harness and inspect the method')}{' '}
          {familiar('/query-research', 'Check where incremental queries actually help')}
        </p>
        <p className="contract-evidence">
          <strong>Checked behavior, not just timing:</strong> the global-model fixture changes one form field and
          observes one notification for its reader and zero for the unrelated preview reader. Separate story stores
          remain isolated, incomplete input stays intact, and a same-version deterministic action fixture rebuilds the
          same state. These are bounded prototype checks, not measurements of every React render or arbitrary production
          replay.
        </p>
        <div className="model-comparison">
          <div>
            <h3>Correctness is observable too.</h3>
            <p>
              The workbench shows whether two views agree after one change, whether Undo restores values and whether old
              async work can publish. These are executable contracts. A passing fixture is not a percentage of
              production bugs prevented.
            </p>
          </div>
          <div>
            <h3>Native is a foundation, not a browser claim.</h3>
            <p>
              The Rust/Verus kernel has a narrow atomic-write contract. Today’s browser demonstrations run TypeScript.
              End-to-end Wasm/GPU integration, universal performance wins and proof of the whole application are not
              shipped claims.
            </p>
            <a href="https://github.com/hyperide/hyper-saas/tree/main/packages/state-lib/native">
              Read the native source and proof boundary ↗
            </a>
          </div>
        </div>
      </section>

      <section className="landing-section wrap" aria-labelledby="not-one-tool-for-everything">
        <div className="section-heading">
          <p className="kicker">A SYNTHESIS, NOT A CLAIM TO HAVE INVENTED EVERYTHING</p>
          <h2 id="not-one-tool-for-everything">Keep the right boundary around each problem.</h2>
        </div>
        <div className="model-boundaries">
          <article>
            <h3>Immutable editing is not the whole store.</h3>
            <p>
              Immer is a useful model for immutable changes; state connects updates to subscriptions, commands and
              history. These are additional responsibilities, not proof that an update helper is deficient.
            </p>
            <a href="https://immerjs.github.io/immer/">Immer’s model ↗</a>
            {familiar('/landscape#h-immutability-patches', 'Immutability landscape')}
          </article>
          <article>
            <h3>Client state is not server truth.</h3>
            <p>
              TanStack Query handles server-cache concerns. A state model coordinates the local experience; it does not
              replace authorization, deduplication or cache freshness just by holding the response.
            </p>
            <a href="https://tanstack.com/query/latest/docs/framework/react/overview">Server-state boundary ↗</a>
            {familiar('/landscape#h-api-layer', 'API and cache landscape')}
          </article>
          <article>
            <h3>A named action is not a statechart.</h3>
            <p>
              XState models actors and orchestration, and XState Store supports event-driven state with extensions.
              state’s FSM layer is a proposed integration with its transaction model, not a reason to hide useful
              existing tools.
            </p>
            <a href="https://stately.ai/docs/xstate-store">XState Store ↗</a>
            {familiar('/landscape#h-stores', 'Compare event and store models')}
          </article>
          <article>
            <h3>Local Undo is not conflict-free collaboration.</h3>
            <p>
              Remote edits, optimistic responses and local history can overlap. Ownership and cancellation help, but
              sync protocols and an explicit conflict policy still decide what is valid.
            </p>
            {familiar('/landscape#h-sync-local-first', 'Sync and local-first landscape')}{' '}
            {familiar('/spec#s4-15', 'Cancellation and ownership')}
          </article>
        </div>
      </section>
      <section className="landing-finish wrap" aria-labelledby="start-with-a-screen">
        <p className="kicker">START WITH THE APP, NOT THE PRIMITIVES</p>
        <h2 id="start-with-a-screen">Use it. Inspect it. Challenge the difference.</h2>
        <p>
          Open a complete React screen with its state tree and editable code. Try manual changes, run the prepared
          script, then switch to the equivalent Zustand example.
        </p>
        <div className="landing-ctas">
          <a className="landing-primary" href={href('/repl/task-screen')}>
            Open the workbench <SiteIcon name="updates" />
          </a>
          <a className="landing-secondary" href={href('/init#react-screen')}>
            Read the screen-building path →
          </a>
        </div>
        <p className="lnote">
          Working prototype and implementation research. No npm installation or production-readiness promise is implied
          by the playground.
        </p>
      </section>
    </div>
  );
}
