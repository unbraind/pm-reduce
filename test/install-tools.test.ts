import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBudgetRefusal, selectNodeRuntime } from './install-tools.ts';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureEnvironment } from '../scripts/environment.ts';

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
