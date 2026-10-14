/**
 * Supplemental CI inventory for the audited npm alias Trivy's Bun parser misses.
 * npm generates CycloneDX from copied installed packages under their real names;
 * lock/manifest identity checks fail closed. The full repository scan and the
 * source/provenance/depth regressions remain independent required checks.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const name = '@zklogic/braces';
const version = '3.0.7';
const alias = `npm:${name}@${version}`;
const integrity = 'sha512-+MYCuqCdcYsZCVkG7BkHXWrkXklBDq+cTxrSMrCI8o1BQg6iAEPhkNuWrfwSt0LladX0XSx3V1HYV7RzMsKEWQ==';
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function generateForkSbom(root, output) {
  const manifest = read(path.join(root, 'package.json'));
  assert.equal(manifest.overrides?.braces, alias, 'root braces must retain the exact audited alias');
  const parsed = ts.parseConfigFileTextToJson('bun.lock', fs.readFileSync(path.join(root, 'bun.lock'), 'utf8'));
  assert.equal(parsed.error, undefined, 'invalid Bun lock');
  const lock = parsed.config;
  assert.equal(lock.overrides?.braces, alias, 'Bun override must be pinned');
  assert.equal(lock.packages?.braces?.[0], `${name}@${version}`, 'Bun package identity mismatch');
  assert.equal(lock.packages.braces[3], integrity, 'Bun fork integrity mismatch');
  const forkPath = path.join(root, 'node_modules/braces/package.json');
  const fork = read(forkPath);
  assert.equal(fork.name, name, 'installed alias name mismatch');
  assert.equal(fork.version, version, 'installed alias version mismatch');

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'braces-sbom-'));
  const expected = new Map();
  try {
    function copyPackage(manifestPath) {
      const pkg = read(manifestPath);
      if (expected.has(pkg.name)) {
        assert.equal(expected.get(pkg.name), pkg.version, 'ambiguous transitive package version');
        return;
      }
      expected.set(pkg.name, pkg.version);
      if (pkg.name !== name) {
        assert.ok(
          Object.values(lock.packages).some((entry) => entry[0] === `${pkg.name}@${pkg.version}`),
          `transitive ${pkg.name}@${pkg.version} missing from normal scanner lock inventory`,
        );
      }
      const destination = path.join(scratch, 'node_modules', pkg.name);
      fs.cpSync(path.dirname(manifestPath), destination, {
        recursive: true,
        filter: (source) => path.basename(source) !== 'node_modules',
      });
      const requirePackage = createRequire(manifestPath);
      for (const dependency of Object.keys(pkg.dependencies || {})) {
        copyPackage(requirePackage.resolve(`${dependency}/package.json`));
      }
    }
    copyPackage(forkPath);
    fs.writeFileSync(
      path.join(scratch, 'package.json'),
      JSON.stringify({
        name: 'hyperide-audited-fork-inventory',
        version: '1.0.0',
        private: true,
        dependencies: { [name]: version },
      }),
    );
    const raw = execFileSync('npm', ['sbom', '--sbom-format=cyclonedx', '--offline'], {
      cwd: scratch,
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const sbom = JSON.parse(raw);
    assert.equal(sbom.bomFormat, 'CycloneDX');
    for (const [packageName, packageVersion] of expected) {
      const purl = `pkg:npm/${packageName.replaceAll('@', '%40')}@${packageVersion}`;
      assert.ok(
        sbom.components.some((component) => component.purl === purl && component.version === packageVersion),
        `generated SBOM omitted or misidentified ${purl}`,
      );
    }
    assert.ok(
      !sbom.components.some((component) => component.purl === 'pkg:npm/braces@3.0.7'),
      'fork must never be disguised as upstream braces',
    );
    fs.writeFileSync(output, raw);
    return sbom;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function scanSbom(file, output) {
  execFileSync(
    'trivy',
    [
      'sbom',
      '--scanners',
      'vuln',
      '--severity',
      'CRITICAL,HIGH',
      '--exit-code',
      '1',
      '--format',
      'json',
      '--output',
      output,
      file,
    ],
    {
      stdio: 'inherit',
      timeout: 120000,
    },
  );
  const scanned = read(output).Results.flatMap((result) => result.Packages || []);
  for (const component of read(file).components) {
    assert.ok(
      scanned.some((pkg) => pkg.Identifier?.PURL === component.purl && pkg.Version === component.version),
      `Trivy did not inventory ${component.purl}`,
    );
  }
}

module.exports = { generateForkSbom, scanSbom };
if (require.main === module) {
  const output = path.resolve(process.argv[2] || 'braces-fork.cdx.json');
  generateForkSbom(path.resolve(__dirname, '..'), output);
  scanSbom(output, `${output}.trivy.json`);
}
