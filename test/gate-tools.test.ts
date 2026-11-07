import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProcessStatus } from './gate-tools.ts';

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
