import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fixtureEnvironment } from '../scripts/environment.ts';

test('revert acceptance reports all missing and ambiguous seams before running proofs', t => {
  const root = mkdtempSync(join(tmpdir(), 'revert-seam-diagnostics-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of ['dist', 'test', 'scripts', 'src', 'index.ts', 'package.json', 'manifest.json', 'README.md', 'docs', '.github']) cpSync(file, join(root, file), { recursive: true });
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');

  const failures = [
    { file: 'README.md', before: '`1..8192`', after: '`1..8192` and `1..8192`', label: 'documented settings upper bound removed', count: 2 },
    { file: 'scripts/environment.ts', before: '!/^GITHUB_/i.test(key)', after: 'true', label: 'fixture inherits parent GitHub event context', count: 0 },
    { file: 'test/kernel.test.ts', before: "assert.ok(certifiedScenarios > 0, 'proof:seeded_certificates');", after: 'void certifiedScenarios;', label: 'seeded certificate nonvacuity removed', count: 0 },
  ];
  for (const failure of failures) {
    const file = join(root, failure.file); const source = readFileSync(file, 'utf8');
    assert.equal(source.split(failure.before).length, 2);
    writeFileSync(file, source.replace(failure.before, failure.after));
  }
  const result = spawnSync(process.execPath, ['test/revert.acceptance.ts'], { cwd: root, env: fixtureEnvironment(process.env), encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  const output = result.stdout + result.stderr;
  assert.ok(output.includes('Stale revert seams (expected exactly one match):'), 'proof:seam_diagnostics');
  for (const failure of failures) {
    assert.ok(output.includes(`${failure.file}: ${failure.label}: ${failure.count} matches`), 'proof:seam_diagnostics');
    assert.ok(readFileSync(join(root, failure.file), 'utf8').includes(failure.after));
  }
  assert.doesNotMatch(result.stdout, /EXPECTED FAIL:/);
});
