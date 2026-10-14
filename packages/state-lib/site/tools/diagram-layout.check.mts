import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { asciiToSvg } from '../../../vector-cli/src/diagram.ts';

const crooked = '┌────────────┐\n│ hello    │\n│ world       │\n└────────────┘';
const straight = '┌─────────────┐\n│ hello       │\n│ world       │\n└─────────────┘';
assert(
  asciiToSvg(crooked) === asciiToSvg(straight),
  'Ragged frame must render as the same repaired rectangle, not disconnected segments',
);
const ascii = '+----------+\n| first |\n| second   |\n+----------+';
const aligned = '+----------+\n| first    |\n| second   |\n+----------+';
assert(asciiToSvg(ascii) === asciiToSvg(aligned), 'ASCII box padding is repaired too');
const adjacent = '+------+   +------+\n| A |----->| B    |\n+------+   +------+';
const adjacentFixed = '+------+   +------+\n| A    |-->| B    |\n+------+   +------+';
assert(asciiToSvg(adjacent) === asciiToSvg(adjacentFixed), 'Repair keeps the neighboring box and arrow destination');
const nested = '┌──────────────┐\n│ ┌──────┐     │\n│ │ X │       │\n│ └──────┘    │\n└──────────────┘';
const nestedFixed = '┌──────────────┐\n│ ┌──────┐     │\n│ │ X    │     │\n│ └──────┘     │\n└──────────────┘';
assert(asciiToSvg(nested) === asciiToSvg(nestedFixed), 'Nested frames are independently aligned');
const architecture = readFileSync(
  new URL('../../../vector-cli/examples/diagrams/architecture.txt', import.meta.url),
  'utf8',
);
const svg = asciiToSvg(architecture);
assert(svg.includes('build time') && svg.includes('run time'), 'Architecture titles survive normalization');
assert(!svg.includes('<script>'), 'Diagram text remains inert');
console.info('PASS: ragged Unicode/ASCII frames, neighboring connectors, nested frames and actual architecture');
