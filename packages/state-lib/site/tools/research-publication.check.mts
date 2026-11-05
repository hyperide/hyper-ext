import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

assert(existsSync('src/data/research.ts'), 'The public research catalogue has not been implemented');
const { RESEARCH_CONCEPTS, EVIDENCE, controllerComparison } = await import('../src/data/research');
assert.equal(RESEARCH_CONCEPTS.length, 3);
assert.equal(EVIDENCE.controller.rows.length, 63, 'Three backends × three sizes × seven operations');
assert(
  EVIDENCE.controller.rows.every((row) => !('samples' in row)),
  'Raw trial arrays belong in the evidence download, not in the main site bundle',
);
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const input = readFileSync(resolve('../docs/research/datasets/2026-09-20-public-evidence.json'), 'utf8');
const raw = JSON.parse(input);
assert.equal(raw.controller.rows.length, 63);
for (const row of raw.controller.rows) {
  assert.equal(row.samples.length, 17);
  assert(row.samples.every((n: number) => Number.isFinite(n) && n >= 0));
  assert.equal(row.medianMs, median(row.samples));
}
const all = [30, 300, 1200].flatMap(controllerComparison);
assert.equal(all.length, 21);
assert.equal(all.filter((row) => row.pass).length, 13);
assert(
  all.some((row) => row.cow > row.original),
  'Regressions must remain visible',
);
assert.deepEqual(EVIDENCE.projection.bytes, { baseline: { raw: 171, gzip: 153 }, generated: { raw: 64, gzip: 80 } });
assert.equal(EVIDENCE.projection.authoredCandidateFiles, 0);
assert.equal(EVIDENCE.controller.promotion, 'rejected');
assert.match(EVIDENCE.provenance.revision, /^[a-f0-9]{40}$/);
for (const source of EVIDENCE.provenance.sources) assert.match(source.sha256, /^[a-f0-9]{64}$/);
const serialized = JSON.stringify(EVIDENCE);
assert(
  !/\/Users\/|@glide|workspace_id|assignee_id|HYP-\d|boards-app|tasks-app/.test(serialized),
  'Public evidence must not contain adopter or account details',
);
const expected = {
  ...raw,
  generatedFrom: createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
  controller: {
    ...raw.controller,
    rows: raw.controller.rows.map((row: { samples: number[] }) => {
      const { samples, ...fields } = row;
      return {
        ...fields,
        sampleCount: samples.length,
        minimumMs: Math.min(...samples),
        maximumMs: Math.max(...samples),
      };
    }),
  },
};
assert.deepEqual(
  EVIDENCE,
  expected,
  'The compact client data must be derived from the complete canonical observations',
);
assert(
  !/\/Users\/|@glide|workspace_id|assignee_id|HYP-\d|boards-app|tasks-app/.test(input),
  'The downloadable raw dataset must remain public-safe',
);
const spec = readFileSync(resolve('../docs/2026-09-01-state-master-spec.md'), 'utf8');
const sectionNumbers = [...spec.matchAll(/^## (\d+)\./gm)].map((match) => match[1]);
assert.equal(
  new Set(sectionNumbers).size,
  sectionNumbers.length,
  'New research sections must not reuse an existing specification anchor',
);
assert(spec.includes('## 23. Research publication and linked learning (R102)'));
assert(!existsSync('src/pages/Blog.tsx'), 'Withdraw premature marketing article component');
console.log(
  'PASS: complete source-pinned research cells, honest promotion, withdrawn marketing and retained research and public-safe evidence',
);
