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
