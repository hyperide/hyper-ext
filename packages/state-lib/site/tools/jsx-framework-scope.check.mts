import assert from 'node:assert/strict';
import { reactScope } from '../src/lib/jsx-sandbox';

const scope = reactScope();
const react = scope.React as Record<string, unknown>;
for (const name of ['createElement', 'Fragment', 'useState', 'useEffect', 'useSyncExternalStore']) {
  assert.equal(react[name], scope[name], `React.${name} must use the same real framework binding as ${name}`);
}
assert.equal(
  new Function(
    ...Object.keys(scope),
    'return React.useEffect === useEffect && React.useSyncExternalStore === useSyncExternalStore',
  )(...Object.values(scope)),
  true,
);
console.info('PASS: explicit React hook namespace and named framework bindings agree in the actual JSX environment');
