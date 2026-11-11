import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBudgetRefusal, selectNodeRuntime, assertArchiveChecksum } from './install-tools.ts';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fixtureEnvironment } from '../scripts/environment.ts';

test('archive checksum works without external tools and rejects replaced bytes and wrong digests', t => {
  const root = mkdtempSync(join(tmpdir(), 'reduce-checksum-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const archive = join(root, 'package.tgz'); const bytes = Buffer.from([0, 255, 1, 128]); writeFileSync(archive, bytes);
  const expected = createHash('sha256').update(bytes).digest('hex');
  const module = pathToFileURL(resolve('test/install-tools.ts')).href;
  const script = `import { assertArchiveChecksum } from ${JSON.stringify(module)}; assertArchiveChecksum(${JSON.stringify(archive)}, ${JSON.stringify(expected)});`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, env: { ...fixtureEnvironment(process.env), PATH: root }, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, `proof:portable_checksum ${result.stderr}`);
  assertArchiveChecksum(archive, expected);
  for (const digest of ['', '0'.repeat(64), expected.toUpperCase()]) assert.throws(() => assertArchiveChecksum(archive, digest), /proof:archive_checksum/, 'proof:checksum_strict');
  writeFileSync(archive, 'replaced archive');
  assert.throws(() => assertArchiveChecksum(archive, expected), /proof:archive_checksum/, 'proof:checksum_tamper');
});

test('package budget admission rejects native errors while host budget transport permits them', () => {
  for (const flag of ['--budget', '--output-budget']) assertBudgetRefusal(flag, { refusal: { code: 'output_budget' } });
  for (const result of [{ code: 'native_error' }, { code: 'output_budget', refusal: { code: 'invalid_input' } }]) {
    assert.throws(() => assertBudgetRefusal('--budget', result), /proof:package_budget/, 'proof:budget_specificity');
    assertBudgetRefusal('--output-budget', result);
  }
  for (const flag of ['--budget', '--output-budget']) for (const result of [{}, { code: 2 }, { refusal: { code: 'invalid_input' } }]) assert.throws(() => assertBudgetRefusal(flag, result));
});

test('runtime selection skips stale wrong-version missing and nonexecutable candidates', t => {
  const root = mkdtempSync(join(tmpdir(), 'reduce-runtime-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const wrong = join(root, 'wrong-node'); writeFileSync(wrong, '#!/bin/sh\necho v0.0.0\n', { mode: 0o755 });
  const unusable = join(root, 'unusable-node'); writeFileSync(unusable, 'synthetic', { mode: 0o644 });
  const directory = join(root, 'directory'); mkdirSync(directory);
  const version = process.versions.node; const env = fixtureEnvironment(process.env);
  for (const candidate of [undefined, '', 'node', join(root, 'missing'), wrong, unusable, directory]) {
    assert.equal(selectNodeRuntime(version, [candidate, process.execPath], root, env), process.execPath, 'proof:node_runtime_selection');
    assert.throws(() => selectNodeRuntime(version, [candidate], root, env), new RegExp(`PM_REDUCE_NODE_${version.split('.')[0]}`), 'proof:node_runtime_selection');
  }
});
