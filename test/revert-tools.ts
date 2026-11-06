import assert from 'node:assert/strict';
import type { SpawnSyncReturns } from 'node:child_process';
/** Accept only an ordinary failing test that reached its named distinguishing assertion. */
export function assertIntendedFailure(result: Pick<SpawnSyncReturns<string>, 'error' | 'signal' | 'status' | 'stdout' | 'stderr'>, proof: string): void {
  assert.equal(result.error, undefined, 'Mutation child failed to execute');
  assert.equal(result.signal, null, 'Mutation child terminated by a signal');
  assert.ok(result.status !== null && result.status > 0, 'Mutation must exit with an ordinary test failure');
  const output = result.stdout + result.stderr; const headers = output.split('\n').filter(line => /^\s*AssertionError \[ERR_ASSERTION\]:/.test(line));
  assert.ok(headers.some(line => line.includes(proof)), `Mutation did not reach intended assertion ${proof}: ${output.slice(-3500)}`);
}
