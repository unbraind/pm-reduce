import assert from 'node:assert/strict';
import { processDiagnostics } from '../scripts/process-tools.ts';
import type { ProcessResult } from '../scripts/process-tools.ts';

/** Retain bounded child diagnostics with the stable assertion marker. */
export function assertProcessStatus(result: ProcessResult, expected: number, proof: string): void {
  assert.equal(result.status, expected, `${proof}: ${processDiagnostics(result)}`);
}
