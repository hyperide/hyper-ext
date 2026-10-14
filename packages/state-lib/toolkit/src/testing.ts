/** Testing entrypoint for the headless async contract (source only, not shipped).
 * The production barrel (`index.ts`) never re-exports this module: importing
 * the headless toolkit in a browser or worker must not load test harnesses.
 * Test runners import the conformance scenarios from here. */
export {
  CONFORMANCE_SCENARIOS,
  checkCommittedErrorDistinct,
  checkExhaustiveMatch,
  runConformanceScenario,
  runFullConformance,
} from './async-conformance.js';
export type { ConformanceAssert, ConformanceFactory, ConformanceScenario } from './async-conformance.js';
