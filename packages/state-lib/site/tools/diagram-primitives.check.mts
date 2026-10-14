import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  asciiToSvg,
  diagramFrame,
  diagramTable,
  diagramArrow,
  renderDiagram,
  DIAGRAM_PRESETS,
} from '../../../vector-cli/src/diagram.ts';
// Count string materialization through the public renderer without a machine-dependent timer.
const scene = Array.from({ length: 1998 }, (_, i) => ({
  type: 'label' as const,
  x: (i % 3) * 5000,
  y: Math.floor(i / 3) * 22,
  text: 'x'.repeat(500),
}));
const originalFrom = Array.from;
let materializedCharacters = 0;
Array.from = new Proxy(originalFrom, {
  apply(target, receiver, args) {
    if (typeof args[0] === 'string') materializedCharacters += args[0].length;
    return Reflect.apply(target, receiver, args);
  },
});
let sceneSvg: string;
try {
  sceneSvg = renderDiagram(scene);
} finally {
  Array.from = originalFrom;
}
assert.equal((sceneSvg.match(/x{500}/g) ?? []).length, scene.length);
assert.equal(materializedCharacters, 0, `SVG escaping materialized ${materializedCharacters} characters`);
for (const preset of Object.keys(DIAGRAM_PRESETS) as (keyof typeof DIAGRAM_PRESETS)[]) {
  const svg = diagramFrame(
    { title: 'Command', text: '<script>alert(1)</script> & "quoted"\npatches → view' },
    { preset },
  );
  assert(svg.startsWith('<svg'));
  assert(!svg.includes('<script>'));
  assert(svg.includes('&lt;script&gt;'));
  assert.equal(
    svg,
    diagramFrame({ title: 'Command', text: '<script>alert(1)</script> & "quoted"\npatches → view' }, { preset }),
  );
}
assert(
  diagramTable([
    ['Phase', 'Outcome'],
    ['commit', 'patch'],
    ['publish', 'view'],
  ]).includes('<tspan'),
);
assert.throws(() => diagramTable([['A', 'B'], ['C']]));
assert.throws(() => diagramTable([['A']], { widths: [-1] }));
assert.throws(() => diagramFrame({ width: NaN }));
assert.throws(() => diagramFrame({ height: 32, title: 'Long title', text: 'one\ntwo\nthree' }));
const controls = String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index));
const escapedControls = diagramFrame({}, { title: `before${controls}after 🧭` });
assert(escapedControls.includes('<title>before\t\n\rafter 🧭</title>'));
const xmlTitle = diagramFrame(
  {},
  { title: `&<>"'\t\n\r${String.fromCharCode(0, 8, 11, 12, 31, 127, 128, 159)}é漢字🧭` },
);
assert(xmlTitle.includes(`<title>&amp;&lt;&gt;&quot;&apos;\t\n\r${String.fromCharCode(127, 128, 159)}é漢字🧭</title>`));
assert(diagramArrow([0, 0], [200, 0], { label: 'patch', both: true }).match(/<polygon/g)?.length === 2);
assert.throws(() => diagramArrow([0, 0], [0, 0]));
for (const source of [
  '+-------+    +------+\n| store |--->| view |\n+-------+    +------+',
  '┌───────┐\n│ state │\n└───────┘',
]) {
  const svg = asciiToSvg(source);
  assert(svg.includes('<path'));
  assert(!/<tspan[^>]*>.*[┌┐└┘]/.test(svg));
}
assert(asciiToSvg('state-lib').includes('state-lib'));
assert.throws(() => asciiToSvg(''));
assert.throws(() => asciiToSvg('x'.repeat(401)));
const cli = fileURLToPath(new URL('../../../vector-cli/bin/vecli.ts', import.meta.url));
const tsx = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
// Raw JavaScript callers can bypass TypeScript; those inputs must still be rejected.
const diagram = fileURLToPath(new URL('../../../vector-cli/src/diagram.ts', import.meta.url));
for (const expression of ["diagramFrame({}, {preset:'<script>'})", "renderDiagram([{type:'evil'}])"]) {
  execFileSync(
    tsx,
    [
      '--eval',
      `import assert from 'node:assert/strict'; import {diagramFrame,renderDiagram} from ${JSON.stringify(diagram)}; assert.throws(() => ${expression});`,
    ],
    { encoding: 'utf8', timeout: 10000 },
  );
}
const run = (args: string[], input?: string) =>
  execFileSync(tsx, [cli, ...args], { encoding: 'utf8', input, timeout: 10000 });
assert.match(run(['--help', 'diagram']), /no WASM/);
assert.match(run(['diagram', 'frame', '--title', 'Hi']), /^<svg/);
assert.match(run(['diagram', 'ascii'], '+---+\n| A |\n+---+'), /^<svg/);
for (const args of [
  ['diagram', 'frame', '--unknown'],
  ['diagram', 'table', '{bad}'],
  ['diagram', 'arrow', '--from', '0,0', '--to', '0,0'],
  ['diagram', 'scene', '[]'],
  ['diagram', 'frame', '--preset', 'wrong'],
]) {
  const r = spawnSync(tsx, [cli, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert(r.stderr.includes('Error:'));
  assert(!r.stdout.includes('<svg'));
}
console.log('SVG primitives + ASCII + CLI validation passed (including no-WASM entry path)');
