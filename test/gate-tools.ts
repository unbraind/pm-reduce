import assert from 'node:assert/strict';
import type { SpawnSyncReturns } from 'node:child_process';

/** Retain bounded child diagnostics with the stable assertion marker. */
export function assertProcessStatus(result: Pick<SpawnSyncReturns<string>, 'status' | 'stdout' | 'stderr' | 'error' | 'signal'>, expected: number, proof: string): void {
  assert.equal(result.status, expected, `${proof}: ${result.stderr.slice(-2000)} ${result.stdout.slice(-2000)} ${result.error?.message ?? ''} ${result.signal ?? ''}`);
}
