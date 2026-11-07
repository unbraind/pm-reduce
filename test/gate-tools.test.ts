import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProcessStatus } from './gate-tools.ts';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureEnvironment } from '../scripts/environment.ts';
import { captureProcessResult, processDiagnostics } from '../scripts/process-tools.ts';

test('child assertions retain stderr stdout execution errors and the stable proof marker', () => {
  for (const changed of [{ stderr: 'synthetic stderr' }, { stdout: 'synthetic stdout' }, { error: new Error('synthetic execution error') }, { signal: 'SIGTERM' as const }]) {
    const result = { status: 1, stderr: '', stdout: '', error: undefined, signal: null, ...changed };
    assert.throws(() => assertProcessStatus(result, 0, 'proof:child'), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /proof:child/, 'proof:gate_diagnostics');
      assert.ok(error.message.includes(Object.values(changed)[0] instanceof Error ? result.error!.message : String(Object.values(changed)[0])), 'proof:gate_diagnostics');
      return true;
    });
  }
});

test('real spawn failure retains its original error and proof with absent streams', t => {
  const root = mkdtempSync(join(tmpdir(), 'reduce-missing-tool-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const missing = spawnSync(join(root, 'missing-executable'), [], { encoding: 'utf8', env: fixtureEnvironment(process.env) });
  assert.equal(missing.status, null); assert.ok(missing.error); assert.equal(missing.stdout ?? null, null); assert.equal(missing.stderr ?? null, null);
  assert.throws(() => assertProcessStatus(missing, 0, 'proof:child'), (error: unknown) => {
    assert.ok(error instanceof assert.AssertionError, 'proof:spawn_diagnostics');
    assert.ok(error.message.includes('proof:child') && error.message.includes(missing.error!.message), 'proof:spawn_diagnostics');
    return true;
  });
  for (const stdout of [null, undefined, 'stdout']) for (const stderr of [null, undefined, 'stderr']) {
    const result = { ...missing, stdout, stderr }; const captured = captureProcessResult(result);
    assert.equal(captured.stdout, stdout ?? ''); assert.equal(captured.stderr, stderr ?? ''); assert.equal(captured.error, missing.error);
    assert.ok(processDiagnostics(result).includes(missing.error.message), 'proof:spawn_diagnostics');
  }
});

test('real max-buffer failure retains collected streams and its execution error', () => {
  const result = spawnSync(process.execPath, ['-e', "process.stderr.write('synthetic child diagnostic');process.stdout.write('x'.repeat(10000))"], { encoding: 'utf8', maxBuffer: 128, env: fixtureEnvironment(process.env) });
  assert.ok(result.error);
  const diagnostics = processDiagnostics(result); assert.ok(diagnostics.includes(result.error.message));
  const captured = captureProcessResult(result); assert.ok(captured.stdout.length + captured.stderr.length > 0);
  for (const text of [captured.stdout, captured.stderr]) assert.ok(diagnostics.includes(text.slice(-2000)));
});

test('package enumeration reports its real missing npm executable and bounds all diagnostics', t => {
  const root = mkdtempSync(join(tmpdir(), 'reduce-empty-path-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = captureProcessResult(spawnSync(process.execPath, [resolve('scripts/pack-gate.ts')], { encoding: 'utf8', env: { ...fixtureEnvironment(process.env), PATH: root } }));
  assert.equal(result.status, 1); assert.match(result.stderr, /Package enumeration failed:.*ENOENT/u, 'proof:pack_spawn');
  const failure = { status: null, signal: null, error: new Error('x'.repeat(10000) + ' original failure'), stdout: 'y'.repeat(10000), stderr: 'z'.repeat(10000) };
  const diagnostics = processDiagnostics(failure); assert.ok(diagnostics.length <= 6004); assert.match(diagnostics, /original failure/);
});
