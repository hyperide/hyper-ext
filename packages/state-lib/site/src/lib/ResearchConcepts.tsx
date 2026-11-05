import { RESEARCH_CONCEPTS, type ResearchConceptId } from '../data/research';
import { href } from './router';

const explanations = {
  'compile-time-qualification': {
    use: 'Use it when a project already declares the fields or capabilities it needs. The compiler can specialize that known boundary without asking the browser to rediscover it on every call.',
    boundary:
      'Declare an operation once. The compiler emits a direct immutable command and the workbench shows it beside the runtime implementation.',
    simpler:
      'Without qualifying evidence, keep the reference module. A build-time fallback preserves the current Runtime contract; it does not prove that Runtime is as fast as an earlier mutable application.',
    spec: '/spec#s5-2',
  },
  'snapshot-ownership': {
    use: 'Use it when history, asynchronous saves or UI readers keep an earlier version alive. A newer edit must not change what those readers consider the earlier value.',
    boundary:
      'Historical snapshots keep their own values while new commands publish the next version. Use Undo and Redo in the board example to inspect that boundary.',
    simpler:
      'Copying everything is a simple reference implementation. Structural sharing instead keeps untouched subtrees; direct object spread is still a useful baseline for a small, known shape.',
    spec: '/spec#s4-4',
  },
  'command-shaped-optimization': {
    use: 'A checkbox, a bulk edit and a move touch different parts of the data. Separate declared commands make those boundaries available to static analysis and to a meaningful benchmark.',
    boundary:
      'Point commands copy changed paths, batch commands construct changed rows once, and moves preserve payload identity. Edit either data model and compare its generated implementation in the REPL.',
    simpler:
      'Keep the audited general path for unknown callbacks and aliasing. Do not run an expensive callback once, then replay it with another algorithm: its side effects may repeat and its first cost is already spent.',
    spec: '/spec#s4-5',
  },
} satisfies Record<ResearchConceptId, { use: string; boundary: string; simpler: string; spec: string }>;

const TOPICS: Record<ResearchConceptId, string> = {
  'compile-time-qualification': 'Compiler · specialization',
  'snapshot-ownership': 'History · data ownership',
  'command-shaped-optimization': 'Performance · commands',
};

export function ResearchConcepts() {
  return (
    <div className="research-concepts">
      {RESEARCH_CONCEPTS.map((concept) => {
        const explanation = explanations[concept.id];
        return (
          <section key={concept.id} id={concept.id} className="concept research-concept" data-research-concept>
            <p className="research-eyebrow">{TOPICS[concept.id]}</p>
            <h2>{concept.title}</h2>
            <p className="lead">{concept.summary}</p>
            <div className="research-concept-detail">
              <div>
                <h3>When it matters</h3>
                <p>{explanation.use}</p>
                <h3>What is implemented</h3>
                <p>{explanation.boundary}</p>
                <h3>Compared with the simpler option</h3>
                <p>{explanation.simpler}</p>
                <p className="research-related">
                  <a
                    href={href(
                      concept.id === 'command-shaped-optimization' ? '/repl/issue-triage' : '/repl/board-commands',
                    )}
                  >
                    Edit and measure this mechanism →
                  </a>
                  <a href={href(explanation.spec)}>Specification →</a>
                  <a href={href('/spec#algorithm-portfolio')}>Algorithms and comparison plan →</a>
                </p>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
