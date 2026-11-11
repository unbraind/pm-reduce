import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { captureProcessResult, processDiagnostics } from '../scripts/process-tools.ts';
import type { ProcessResult } from '../scripts/process-tools.ts';
import { npmEnvironment, testEnvironment } from '../scripts/environment.ts';
/** Certify the fixed baseline for every suite used by a behavioral mutation. */
export function assertRestoredTests(changes: readonly { test: string }[], cwd = process.cwd()): number {
  const files = [...new Set(changes.map(change => `test/${change.test}.test.ts`))];
  const restored = captureProcessResult(spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...files], { cwd, env: testEnvironment(npmEnvironment(process.env)), encoding: 'utf8', timeout: 180000 }));
  assert.equal(restored.status, 0, processDiagnostics(restored));
  const count = restored.stdout.match(/tests (\d+)/); assert.ok(count && Number(count[1]) > 0);
  return Number(count[1]);
}
/** Accept only an ordinary failing test that reached its named distinguishing assertion. */
export function assertIntendedFailure(raw: ProcessResult, proof: string): void {
  const result = captureProcessResult(raw);
  assert.equal(result.error, undefined, `Mutation child failed to execute: ${processDiagnostics(result)}`);
  assert.equal(result.signal, null, 'Mutation child terminated by a signal');
  assert.ok(result.status !== null && result.status > 0, 'Mutation must exit with an ordinary test failure');
  const output = result.stdout + result.stderr; const headers = output.split('\n').filter(line => /^\s*AssertionError \[ERR_ASSERTION\]:/.test(line));
  assert.ok(headers.some(line => line.includes(proof)), `Mutation did not reach intended assertion ${proof}: ${output.slice(-3500)}`);
}
