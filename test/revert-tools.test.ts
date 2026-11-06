import test from 'node:test';
import assert from 'node:assert/strict';
import { assertIntendedFailure, assertRestoredTests } from './revert-tools.ts';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
test('revert evidence rejects unrelated assertions, failed execution, signals and timeouts', () => {
  const ordinary = { status: 1, signal: null, stdout: 'AssertionError [ERR_ASSERTION]: proof:expected', stderr: '', error: undefined };
  assertIntendedFailure(ordinary, 'proof:expected');
  for (const changed of [{ ...ordinary, status: 0 }, { ...ordinary, status: null }, { ...ordinary, signal: 'SIGTERM' as const }, { ...ordinary, error: new Error('ETIMEDOUT') }, { ...ordinary, stdout: 'AssertionError [ERR_ASSERTION]: unrelated' }, { ...ordinary, stdout: 'AssertionError [ERR_ASSERTION]: unrelated\nsource snippet contains proof:expected' }]) assert.throws(() => assertIntendedFailure(changed, 'proof:expected'));
});
test('restored baseline includes every mutation suite and deduplicates paths', t => {
  const root = mkdtempSync(join(tmpdir(), 'reduce-restored-')); t.after(() => rmSync(root, { recursive: true, force: true })); mkdirSync(join(root, 'test'));
  const changes = ['api', 'kernel', 'privacy', 'contracts', 'concurrency', 'contracts'].map(test => ({ test }));
  for (const { test } of changes) writeFileSync(join(root, `test/${test}.test.ts`), "import test from 'node:test'; test('baseline', () => {});\n");
  for (const suite of ['contracts', 'concurrency']) {
    const file = join(root, `test/${suite}.test.ts`); const passing = "import test from 'node:test'; test('baseline', () => {});\n";
    writeFileSync(file, "import test from 'node:test'; import assert from 'node:assert/strict'; test('baseline', () => assert.fail('unmodified baseline failure'));\n");
    assert.throws(() => assertRestoredTests(changes, root), /unmodified baseline failure/, 'proof:restored_suites');
    writeFileSync(file, passing);
  }
  assert.equal(assertRestoredTests(changes, root), 5);
});
