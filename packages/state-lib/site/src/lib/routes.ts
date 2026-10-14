/** The nav route list — split out of App.tsx so it can be imported without pulling in the
 *  whole app shell (search.ts needs it too, and App.tsx -> SearchPalette -> search.ts ->
 *  App.tsx would be a cycle). */
export const ROUTES: [string, string][] = [
  ['/init', 'Get started'],
  ['/concepts', 'Concepts'],
  ['/learning', 'How it works'],
  ['/api', 'API'],
  ['/adapters', 'Adapters'],
  ['/query-research', 'TanStack DB'],
  ['/queries', 'Query operators'],
  ['/landscape', 'Landscape'],
  ['/compare', 'Compare'],
  ['/selectors-vs-datalog', 'Selectors→Datalog'],
  ['/repl', 'REPL'],
  ['/bench', 'Bench'],
  ['/cli', 'CLI'],
  ['/effects', 'No useEffect'],
  ['/devtools', 'Devtools'],
  ['/dive-data', 'Dive: data'],
  ['/dive-stores', 'Dive: stores'],
  ['/requirements', 'Requirements'],
  ['/decisions', 'Decisions'],
  ['/spec', 'Master spec'],
  ['/brief', 'Research brief'],
];

/** The six document pages live under one "Docs" group in the menu. */
export const DOC_ROUTES = new Set(['/dive-data', '/dive-stores', '/requirements', '/decisions', '/spec', '/brief']);
export const PRIMARY = ROUTES.filter(([r]) => !DOC_ROUTES.has(r));
export const DOCS = ROUTES.filter(([r]) => DOC_ROUTES.has(r));
