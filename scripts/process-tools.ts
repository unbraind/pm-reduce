import type { SpawnSyncReturns } from 'node:child_process';

/** Node can return absent streams on spawn failure despite its string-encoding declarations. */
export type ProcessResult = Pick<SpawnSyncReturns<string>, 'status' | 'signal' | 'error'> & { stdout: string | null | undefined; stderr: string | null | undefined };

/** Normalize streams before formatting or parsing while retaining the original execution failure. */
export function captureProcessResult(result: ProcessResult) {
  return { ...result, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Bound diagnostic text without losing the execution error or termination signal. */
export function processDiagnostics(raw: ProcessResult): string {
  const result = captureProcessResult(raw);
  return `${result.stderr.slice(-2000)} ${result.stdout.slice(-2000)} ${(result.error?.message ?? '').slice(-2000)} ${result.signal ?? ''}`;
}
