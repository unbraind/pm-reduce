import test from 'node:test';
import assert from 'node:assert/strict';
import { readReduction, readState, recordReductionOutcome, canonical, digest, ReductionRefusal } from '../dist/index.js';
import { projectState } from '../dist/src/kernel.js';
import { fixture, runTrial, outcome, historyEvents } from './helpers.ts';

test('aggregate state capacity refuses before effects and retains every older replay identity', async t => {
  const { host, id, pmRoot } = await fixture(t); const trial = await runTrial(host, id, 'baseline', () => 'target_fail');
  let state = (await readReduction(host, id)).state; let admitted = 0;
  for (let at = 0; at < 512; at++) {
    const copy = structuredClone(state); const observed = { ...copy.observations[0], observation_id: `observation-seed-${at}`, reason: 'Public context. '.repeat(16) };
    copy.observations.push(observed); const result = { kind: 'record' as const, identity: observed.observation_id, sequence: copy.replay_receipts.length + 1, digest: digest(observed) };
    copy.replay_receipts.push({ operation_id: `seed-${at}`, request_digest: digest(at), result, result_digest: digest(result) }); projectState(copy);
    try { readState(copy); state = copy; admitted++; }
    catch (error) { assert.ok(error instanceof ReductionRefusal); assert.equal(error.code, 'capacity_exceeded'); break; }
  }
  assert.ok(admitted > 100); await host.client.update(id, { field: [`reduce_state=${canonical(state)}`] });
  const before = await readReduction(host, id); const events = await historyEvents(pmRoot);
  await assert.rejects(recordReductionOutcome(host, { id, op: 'over-capacity', revision: before.revision, request: trial.receipt.result.identity, outcome: outcome(state.definition, state.requests[0].subset_digest, 'target_fail', { reason: 'Public context. '.repeat(16) }) }), (error: unknown) => error instanceof ReductionRefusal && error.code === 'capacity_exceeded');
  assert.equal((await readReduction(host, id)).revision, before.revision); assert.equal(await historyEvents(pmRoot), events); assert.equal((await recordReductionOutcome(host, trial.recordInput)).replayed, true); assert.equal(await historyEvents(pmRoot), events);
});
