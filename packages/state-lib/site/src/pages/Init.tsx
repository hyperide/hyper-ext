import { useState } from 'react';
import { href } from '../lib/router';
import { T } from '../lib/T';
import { Code } from '../lib/Code';
import { exampleById } from '../data/examples';
import {
  WIZARD_STEPS,
  DEFAULT_SELECTION,
  selectedChoice,
  visibleSteps,
  buildConfigYaml,
  REAL_CHOICE_COUNT,
  RATED_CHOICE_COUNT,
  type WizardChoice,
  type WizardStep,
} from '../data/init-wizard';

/** R24/R26/R38 — a web version of `state init`: the same questions the CLI page's static
 *  transcript already promises, made interactive, with a live config preview and — for
 *  every choice the prototype actually does something for — the real example that proves it. */

function StepList({
  steps,
  activeId,
  selection,
  onSelect,
}: {
  steps: WizardStep[];
  activeId: string;
  selection: Record<string, string>;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="cli-list">
      {steps.map((step) => (
        <button
          key={step.id}
          className={`cli-item${step.id === activeId ? ' on' : ''}`}
          onClick={() => onSelect(step.id)}
        >
          <span>{step.title}</span>
          <span className="tag">{selectedChoice(step, selection).label}</span>
        </button>
      ))}
    </div>
  );
}

/** Every example id the wizard can show, named as a literal per branch (never a computed
 *  `repl={...}` prop) — `tools/run-buttons.check.mts` requires the run button's target to be
 *  a literal string next to its own `exampleById(...)` call, so the two cannot drift apart. */
function ExampleFor({ id }: { id: string }) {
  switch (id) {
    case 'task-screen':
      // The runnable example in full: Run executes setup + code step by step and mounts ui,
      // so this block shows all three — nothing below is display-only.
      return (
        <>
          <p className="lnote">
            <em>
              Store setup, then the prepared script Run executes, then the screen component — the complete runnable
              example, not an excerpt.
            </em>
          </p>
          <Code repl="task-screen">{`${exampleById('task-screen')!.setup}\n\n${exampleById('task-screen')!.code}\n\n${exampleById('task-screen')!.ui}`}</Code>
        </>
      );
    case 'collection':
      return <Code repl="collection">{exampleById('collection')!.code}</Code>;
    case 'queries':
      return <Code repl="queries">{exampleById('queries')!.code}</Code>;
    case 'regions':
      return <Code repl="regions">{exampleById('regions')!.code}</Code>;
    case 'undo':
      return <Code repl="undo">{exampleById('undo')!.code}</Code>;
    case 'read-write':
      return <Code repl="read-write">{exampleById('read-write')!.code}</Code>;
    default:
      return null;
  }
}

function ChoiceDetail({ choice }: { choice: WizardChoice }) {
  return (
    <div className="wiz-choice-detail">
      <p>
        {choice.reality !== 'na' && <span className={`tag t-${choice.reality}`}>{choice.reality}</span>}{' '}
        <T as="span">{choice.note}</T>
      </p>
      {choice.citations && (
        <p className="lnote">
          Source:{' '}
          {choice.citations.map((c, i) => (
            <span key={c.url}>
              {i > 0 && ' · '}
              <a href={c.url} target="_blank" rel="noreferrer">
                {c.label}
              </a>
            </span>
          ))}
        </p>
      )}
      {choice.sketch && (
        <>
          <p className="lnote">
            <em>an API sketch, not runnable — nothing behind it exists yet</em>
          </p>
          <Code lang="ts">{choice.sketch}</Code>
        </>
      )}
      {choice.example && (
        <>
          {choice.exampleCaption && (
            <p className="lnote">
              <em>{choice.exampleCaption}</em>
            </p>
          )}
          <ExampleFor id={choice.example} />
        </>
      )}
    </div>
  );
}

function StepDetail({
  step,
  selection,
  onPick,
}: {
  step: WizardStep;
  selection: Record<string, string>;
  onPick: (choiceId: string) => void;
}) {
  const current = selectedChoice(step, selection);
  return (
    <div className="cli-detail">
      <h2>{step.question}</h2>
      <T as="p" className="lead">
        {step.about}
      </T>
      <div className="wiz-choices">
        {step.choices.map((c) => (
          <button key={c.id} className={`cli-item${c.id === current.id ? ' on' : ''}`} onClick={() => onPick(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <ChoiceDetail choice={current} />
    </div>
  );
}

function ConfigPreview({ selection }: { selection: Record<string, string> }) {
  return (
    <section className="wiz-config">
      <h2>state.config.yaml</h2>
      <T as="p" className="lead">
        {
          'What `state init` will write, built live from the choices above — the CLI has not shipped, so this has not actually run anywhere; the keys are exactly the schema in the master spec (§17.1), nothing invented.'
        }
      </T>
      <Code lang="yaml">{buildConfigYaml(selection)}</Code>
    </section>
  );
}

function RealitySummary() {
  return (
    <p className="hero-honest">
      <b>
        {REAL_CHOICE_COUNT} of {RATED_CHOICE_COUNT} choices above are real today
      </b>{' '}
      — try them in the <a href={href('/repl')}>REPL</a>. The rest are the roadmap: specified in the master spec, not
      built.
    </p>
  );
}

export default function Init() {
  const [activeId, setActiveId] = useState(WIZARD_STEPS[0].id);
  const [selection, setSelection] = useState<Record<string, string>>(DEFAULT_SELECTION);
  const steps = visibleSteps(selection);
  const step = steps.find((s) => s.id === activeId) ?? steps[0];
  const pick = (choiceId: string) => setSelection((s) => ({ ...s, [step.id]: choiceId }));

  return (
    <div className="wrap wide">
      <header className="page">
        <T as="p" className="kicker">
          {'state init · web version · R19 R24 R26 R38'}
        </T>
        <h1>Configure state</h1>
        <T as="p" className="lead">
          {
            'A web version of the setup wizard `state init` will run, before the CLI exists. Click through the same questions the CLI page already promises, and see, for each answer, whether it is something the prototype does today or only something the spec describes.'
          }
        </T>
      </header>
      <section id="react-screen">
        <h2>A screen before a configuration file.</h2>
        <p>
          One store owns the checklist. Named actions change it. TaskScreen subscribes to values; TaskView and TaskRow
          receive plain props and event callbacks. The presentational components have no store import and can be
          exercised with a test or story fixture.
        </p>
        <p>
          The workbench supplies React and createStore for this prototype. The model and component source below belong
          to the same runnable example, not a production npm installation recipe.
        </p>
        <ExampleFor id="task-screen" />
        <p>
          <a href={href('/repl/task-screen')}>Open the screen, live state and editable code →</a>
        </p>
        <p>
          Every test or Storybook story should create its own model. “Global” means one coherent app model, not a
          singleton shared between requests, users or tests. Standalone signals are a lower-level tool, not another
          piece of state you must keep synchronized with each store field.
        </p>
        <p>
          <a href="https://storybook.js.org/docs/writing-stories/build-pages-with-storybook">
            Storybook’s container/presentational-component guidance ↗
          </a>
        </p>
      </section>
      <h2>Optional configuration choices</h2>
      <div className="cli-layout">
        <StepList steps={steps} activeId={step.id} selection={selection} onSelect={setActiveId} />
        <StepDetail step={step} selection={selection} onPick={pick} />
      </div>
      <ConfigPreview selection={selection} />
      <RealitySummary />
      <footer>
        These are the same questions the <code>state init</code> transcript on the <a href={href('/cli')}>CLI page</a>{' '}
        shows; this page just lets you answer them.
      </footer>
    </div>
  );
}
