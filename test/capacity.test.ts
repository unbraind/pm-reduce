import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createReduction, readReduction, readState, recordReductionOutcome, requestReductionTrial, nextReductionTrial, canonical, digest, ReductionRefusal } from '../dist/index.js';
import { assertCompletionCapacity } from '../dist/src/api.js';
import { projectState } from '../dist/src/kernel.js';
import { fixture, runTrial, outcome, historyEvents, definition, hasCode } from './helpers.ts';
import { fillJournal, largestOutcome } from './capacity-tools.ts';

/** Initialize a real nongit owner with an independently validated near-full legacy journal. */
async function completionFixture(t: TestContext, ceiling: number) {
  const def = definition(2); def.oracle.target_failure_signature = '\u0800'.repeat(128);
  const context = await fixture(t, true, def); const { host, id } = context;
  const baseline = await runTrial(host, id, 'baseline', () => 'target_fail');
  const state = fillJournal((await readReduction(host, id)).state, ceiling);
  await host.client.update(id, { field: [`reduce_state=${canonical(state)}`] });
  return { ...context, def, baseline, state };
}

test('completion capacity checks independent receipt and byte frontiers', () => {
  for (let receipts = 1; receipts <= 513; receipts++) for (const bytes of [0, 229376, 229377, 262144]) {
    if (receipts < 512 && bytes <= 229376) assert.doesNotThrow(() => assertCompletionCapacity(receipts, bytes));
    else assert.throws(() => assertCompletionCapacity(receipts, bytes), hasCode('capacity_exceeded'), 'proof:completion_frontier');
  }
});

test('reservation leaves outcome capacity before effects in a nongit tracker', async t => {
  const { host, id, pmRoot, state } = await completionFixture(t, 232000);
  assert.ok(Buffer.byteLength(canonical(state)) > 229376);
  const next = await nextReductionTrial(host, { id }); const before = await readReduction(host, id); const events = await historyEvents(pmRoot);
  await assert.rejects(requestReductionTrial(host, { id, op: 'cannot-finish', revision: next.revision, proposal: next.proposal_digest! }), hasCode('capacity_exceeded'), 'proof:completion_reservation');
  assert.equal((await readReduction(host, id)).revision, before.revision); assert.equal(await historyEvents(pmRoot), events);
  assert.equal((await readReduction(host, id)).state.trial_budget.pending, 0);
});

test('pending completion headroom survives extra observations', async t => {
  const { host, id, pmRoot, def, baseline } = await completionFixture(t, 227000);
  const next = await nextReductionTrial(host, { id }); const reserved = await requestReductionTrial(host, { id, op: 'room', revision: next.revision, proposal: next.proposal_digest! });
  const before = await readReduction(host, id); const events = await historyEvents(pmRoot);
  await assert.rejects(recordReductionOutcome(host, { id, op: 'extra-result', revision: before.revision, request: baseline.receipt.result.identity, outcome: largestOutcome(outcome(def, baseline.candidate.subset_digest)) }), hasCode('capacity_exceeded'), 'proof:completion_write');
  assert.equal((await readReduction(host, id)).revision, before.revision); assert.equal(await historyEvents(pmRoot), events);
  const recorded = await recordReductionOutcome({ ...host, verifyOutcome: async () => 'f'.repeat(64) }, { id, op: 'finish', revision: reserved.revision, request: reserved.result.identity, outcome: largestOutcome(outcome(def, next.candidate!.subset_digest)) });
  assert.equal((await readReduction(host, id)).state.trial_budget.pending, 0); assert.equal(recorded.outcome, 'committed');
});

test('admitted trials accept maximum legal outcome encodings for every result and verifier', async t => {
  for (const result of ['target_fail', 'pass', 'unresolved'] as const) for (const verified of [false, true]) {
    const { host, id, def } = await completionFixture(t, 227000);
    const next = await nextReductionTrial(host, { id }); const reserved = await requestReductionTrial(host, { id, op: 'reserve', revision: next.revision, proposal: next.proposal_digest! });
    const input = { id, op: 'complete'.padEnd(96, 'x'), revision: reserved.revision, request: reserved.result.identity, outcome: largestOutcome(outcome(def, next.candidate!.subset_digest, result)) };
    assert.equal(input.outcome.observed_at.length, 8000);
    const port = verified ? { ...host, verifyOutcome: async () => 'e'.repeat(64) } : host;
    await recordReductionOutcome(port, input); assert.equal((await readReduction(host, id)).state.trial_budget.pending, 0);
    assert.equal((await recordReductionOutcome(port, input)).replayed, true);
  }
});

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

 test('declared trial ceiling accepts 255 through completion and rejects 256 before creation', async t => {
  const def = definition(4); def.max_trials = 255;
  const { host, id, birth } = await fixture(t, true, def);
  for (let index = 0; index < 255; index++) {
    const next = await nextReductionTrial(host, { id });
    if (!next.candidate) { assert.equal(next.status, 'search_complete'); break; }
    await runTrial(host, id, `boundary-${index}`, subset => subset.includes('a0') ? 'target_fail' : 'pass');
  }
  assert.equal((await readReduction(host, id)).state.trial_budget.pending, 0);
  assert.equal((await nextReductionTrial(host, { id })).candidate, null);
  await assert.rejects(createReduction(host, { ...birth, id: 'too-many', op: 'too-many', definition: { ...def, max_trials: 256 } }), hasCode('invalid_input'), 'proof:trial_ceiling');
});
