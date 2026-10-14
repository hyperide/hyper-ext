/**
 * The step instrumenter (R81). Every check here is a shape that appears in the
 * playground's own examples, because the failure mode of a hand-rolled splitter
 * is silent: it produces syntactically valid but wrongly-cut code, and the
 * reader gets a debugger that skips lines.
 */
import { splitTopLevel, declaredIn, declaredNames, instrument } from '../src/lib/instrument';
import { EXAMPLES } from '../src/data/examples';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

console.log('\nsplitting');
{
  const s = splitTopLevel(`const a = 1\nconst b = 2`);
  check('one statement per line', s.length === 2, JSON.stringify(s.map((c) => c.text)));
  check('line numbers are 1-based', s[0]!.line === 1 && s[1]!.line === 2);

  const multi = splitTopLevel(`const f = () => {\n  return 1\n}\nconst g = 2`);
  check('a brace block is one statement', multi.length === 2, JSON.stringify(multi.map((c) => c.text)));

  const tmpl = splitTopLevel('const s = `a\nb\nc`\nconst t = 1');
  check('a multi-line template is one statement', tmpl.length === 2, JSON.stringify(tmpl.map((c) => c.text)));

  const brace = splitTopLevel(`const s = '}'\nconst t = 2`);
  check('a brace inside a string does not split', brace.length === 2, JSON.stringify(brace.map((c) => c.text)));

  const cmt = splitTopLevel(`// a comment\nconst a = 1`);
  check('a comment line attaches to the next statement', cmt.length === 1, JSON.stringify(cmt.map((c) => c.text)));

  const chained = splitTopLevel(`const x = foo()\n  .bar()\n  .baz()\nconst y = 1`);
  check('a chained call is one statement', chained.length === 2, JSON.stringify(chained.map((c) => c.text)));
}

console.log('\ndeclarations');
{
  check('plain const', declaredIn('const a = 1').join() === 'a');
  check('array destructuring', declaredIn('const [a, b] = f()').join() === 'a,b');
  check('object destructuring', declaredIn('const { a, b } = f()').join() === 'a,b');
  check('renamed destructuring takes the local name', declaredIn('const { a: x } = f()').join() === 'x');
  check('function declaration', declaredIn('function go() {}').join() === 'go');
  check('a bare call declares nothing', declaredIn('log(1)').length === 0);
}

console.log('\ninstrumenting');
{
  const { code, steps } = instrument(`const a = 1\nconst b = a + 1\nlog(b)`);
  check('a step per statement', steps.length === 3, String(steps.length));
  check(
    'scope grows, never shrinks',
    steps.map((s) => s.names.length).join() === '1,2,2',
    steps.map((s) => s.names.join('+')).join(' | '),
  );
  check('the first capture cannot read a later const', !/__step\(0, \{[^}]*"b"/.test(code), code.split('\n')[1]);
  check('the last capture sees both', /__step\(2, \{"a": a, "b": b\}\)/.test(code), code);
}

console.log('\nseeded scope');
{
  const seed = declaredNames(`const store = createStore({})\nconst setN = store.action('setN', () => {})`);
  check('setup bindings are found', seed.join() === 'store,setN', seed.join());
  const { code, steps } = instrument('log(1)', seed);
  check('the first frame already sees them', steps[0]!.names.join() === 'store,setN', steps[0]!.names.join());
  check('and the capture lists them', /__step\(0, \{"store": store, "setN": setN\}\)/.test(code), code);
}

console.log('\nevery shipped example instruments and still parses');
for (const ex of EXAMPLES) {
  const { code, steps } = instrument(ex.code, declaredNames(ex.setup));
  let ok = steps.length > 0;
  let why = `${steps.length} steps`;
  try {
    // The same shape the page builds: an async IIFE with the helpers injected.
    new Function(
      '__step',
      'log',
      'createStore',
      'signal',
      'derive',
      'watch',
      'delay',
      'createScope',
      'deriveCollection',
      'storageAdapter',
      'REGION_POLICY',
      'DateType',
      'customType',
      'presented',
      'field',
      'CancelError',
      'sleep',
      'memoryStorage',
      `return (async () => {\n${ex.setup}\n${code}\n})()`,
    );
  } catch (e) {
    ok = false;
    why = (e as Error).message;
  }
  check(`${ex.id} (${steps.length} steps)`, ok, why);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall assertions passed');
process.exit(failures ? 1 : 0);
