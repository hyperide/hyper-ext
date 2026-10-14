/** The fixture/worker evaluator treats these libraries as opaque runtime namespaces.
 * Their APIs live in the authored JS programs and are exercised by real-library tests.
 * Do not use this intentionally narrow boundary as type declarations for app development. */
declare module 'lodash' { const runtime: unknown; export default runtime; }
declare module 'ramda' { const runtime: Readonly<Record<string, unknown>>; export = runtime; }
