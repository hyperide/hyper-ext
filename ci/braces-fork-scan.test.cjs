/**
 * Fail-closed checks for CI's supplemental alias inventory and real Trivy gate.
 * Fixtures alter identity/pins; the vulnerable control must fail the same scanner
 * used for the generated inventory, not a mocked vulnerability result.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { generateForkSbom, scanSbom } = require('./braces-fork-scan.cjs');

const root = path.resolve(__dirname, '..');
function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-scan-test-'));
  try {
    for (const file of ['package.json', 'bun.lock']) fs.copyFileSync(path.join(root, file), path.join(directory, file));
    fs.mkdirSync(path.join(directory, 'node_modules'));
    fs.cpSync(path.join(root, 'node_modules/braces'), path.join(directory, 'node_modules/braces'), { recursive: true });
    run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('absent installed alias fails before scanning', () =>
  fixture((directory) => {
    fs.rmSync(path.join(directory, 'node_modules/braces'), { recursive: true });
    assert.throws(() => generateForkSbom(directory, path.join(directory, 'bom.json')), /ENOENT/);
  }));

for (const [key, value] of [
  ['name', 'braces'],
  ['version', '3.0.3'],
]) {
  test(`misidentified installed ${key} fails before scanning`, () =>
    fixture((directory) => {
      const file = path.join(directory, 'node_modules/braces/package.json');
      const manifest = JSON.parse(fs.readFileSync(file));
      manifest[key] = value;
      fs.writeFileSync(file, JSON.stringify(manifest));
      assert.throws(() => generateForkSbom(directory, path.join(directory, 'bom.json')), /installed alias .* mismatch/);
    }));
}

test('unpinned root alias fails before scanning', () =>
  fixture((directory) => {
    const file = path.join(directory, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(file));
    manifest.overrides.braces = 'npm:@zklogic/braces@^3.0.7';
    fs.writeFileSync(file, JSON.stringify(manifest));
    assert.throws(() => generateForkSbom(directory, path.join(directory, 'bom.json')), /exact audited alias/);
  }));

test('mismatched lock integrity fails before scanning', () =>
  fixture((directory) => {
    const file = path.join(directory, 'bun.lock');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('sha512-+MYCuqCdcYsZCVkG7BkHX', 'sha512-invalid'));
    assert.throws(() => generateForkSbom(directory, path.join(directory, 'bom.json')), /integrity mismatch/);
  }));

test('unpinned lock alias fails before scanning', () =>
  fixture((directory) => {
    const file = path.join(directory, 'bun.lock');
    fs.writeFileSync(
      file,
      fs.readFileSync(file, 'utf8').replace('npm:@zklogic/braces@3.0.7', 'npm:@zklogic/braces@^3.0.7'),
    );
    assert.throws(() => generateForkSbom(directory, path.join(directory, 'bom.json')), /Bun override must be pinned/);
  }));

test('misidentified lock package fails before scanning', () =>
  fixture((directory) => {
    const file = path.join(directory, 'bun.lock');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('["@zklogic/braces@3.0.7"', '["braces@3.0.7"'));
    assert.throws(() => generateForkSbom(directory, path.join(directory, 'bom.json')), /Bun package identity mismatch/);
  }));

test('generated real inventory scans and a vulnerable SBOM component fails the same Trivy gate', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-trivy-test-'));
  try {
    const file = path.join(directory, 'bom.json');
    const output = path.join(directory, 'scan.json');
    const sbom = generateForkSbom(root, file);
    for (const name of ['%40zklogic/braces@3.0.7', 'fill-range@', 'to-regex-range@', 'is-number@']) {
      assert.ok(sbom.components.some((component) => component.purl.includes(`pkg:npm/${name}`)));
    }
    scanSbom(file, output);
    const ref = 'pkg:npm/proxy-addr@2.0.7';
    sbom.components.push({ type: 'library', name: 'proxy-addr', version: '2.0.7', purl: ref, 'bom-ref': ref });
    sbom.dependencies[0].dependsOn.push(ref);
    sbom.dependencies.push({ ref, dependsOn: [] });
    fs.writeFileSync(file, JSON.stringify(sbom));
    assert.throws(
      () => scanSbom(file, output),
      (error) => error.status === 1,
    );
    const result = JSON.parse(fs.readFileSync(output));
    assert.ok(
      result.Results.some((entry) =>
        entry.Vulnerabilities?.some(
          (vulnerability) => vulnerability.PkgName === 'proxy-addr' && vulnerability.Severity === 'CRITICAL',
        ),
      ),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
