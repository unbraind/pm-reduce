import test from 'node:test';
import assert from 'node:assert/strict';
import { assertIntendedFailure } from './revert-tools.ts';
test('revert evidence rejects unrelated assertions, failed execution, signals and timeouts', () => {
  const ordinary = { status: 1, signal: null, stdout: 'AssertionError [ERR_ASSERTION]: proof:expected', stderr: '', error: undefined };
  assertIntendedFailure(ordinary, 'proof:expected');
  for (const changed of [{ ...ordinary, status: 0 }, { ...ordinary, status: null }, { ...ordinary, signal: 'SIGTERM' as const }, { ...ordinary, error: new Error('ETIMEDOUT') }, { ...ordinary, stdout: 'AssertionError [ERR_ASSERTION]: unrelated' }, { ...ordinary, stdout: 'AssertionError [ERR_ASSERTION]: unrelated\nsource snippet contains proof:expected' }]) assert.throws(() => assertIntendedFailure(changed, 'proof:expected'));
});
