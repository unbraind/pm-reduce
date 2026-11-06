/** Run the packed public SDK in a real consumer, using only synthetic oracle reports. */
import assert from 'node:assert/strict';
import { createDirectoryHost, createReduction, readReduction, nextReductionTrial, requestReductionTrial, recordReductionOutcome, reductionCertificate, validateReductionCertificate, readState, canonical, digest, ReductionRefusal } from 'pm-reduce';
import type { Outcome, ReductionState } from 'pm-reduce';
/** Match one stable packed refusal without depending on its diagnostics. */
function code(expected: string) { return (error: unknown) => error instanceof ReductionRefusal && error.code === expected; }
const host = createDirectoryHost(process.cwd() + '/.agents/pm', 'consumer'); const owner = await readReduction(host, 'packed-repro');
const { observation_id, request_id, evidence, verification_digest, ...observed } = owner.state.observations[0]; void observation_id; void evidence; void verification_digest;
const input = { id: owner.id, op: 'packed-sdk-write', revision: owner.revision, request: request_id, outcome: observed };
await recordReductionOutcome(host, input); assert.equal((await recordReductionOutcome(host, input)).replayed, true); assert.equal((await readReduction(host, owner.id)).state.observations.length, 3);
const current = await readReduction(host, owner.id); const proof = await reductionCertificate(host, { id: owner.id });
assert.throws(() => validateReductionCertificate(current.state, { ...proof.certificate, witness_digest: digest('forged') }), code('invalid_certificate'));
await assert.rejects(readReduction({ ...host, capabilities: { ...host.capabilities, native_item_cas: false } }, owner.id), code('backend_unsupported'));
await host.client.create({ id: 'packed-peer', title: 'Peer task', type: 'Task' }); await assert.rejects(readReduction(host, 'packed-peer'), code('invalid_record'));
await createReduction(host, { id: 'packed-capacity', op: 'birth', title: 'Capacity boundary', definition: owner.state.definition });
const next = await nextReductionTrial(host, { id: 'packed-capacity' }); const reserved = await requestReductionTrial(host, { id: next.owner_id, op: 'reserve', revision: next.revision, proposal: next.proposal_digest! });
await recordReductionOutcome(host, { id: next.owner_id, op: 'baseline', revision: reserved.revision, request: reserved.result.identity, outcome: observed });
let state = (await readReduction(host, next.owner_id)).state; let bounded = false;
for (let index = 0; index < 512; index++) {
  const copy: ReductionState = structuredClone(state); const row = { ...copy.observations[0], observation_id: `seed-observation-${index}`, reason: 'x'.repeat(256) }; copy.observations.push(row);
  const result = { kind: 'record' as const, identity: row.observation_id, sequence: copy.replay_receipts.length + 1, digest: digest(row) };
  copy.replay_receipts.push({ operation_id: `seed-${index}`, request_digest: digest(index), result, result_digest: digest(result) });
  try { readState(copy); state = copy; } catch (error) { assert.ok(code('capacity_exceeded')(error)); bounded = true; break; }
}
assert.equal(bounded, true); await host.client.update(next.owner_id, { field: [`reduce_state=${canonical(state)}`] });
const full = await readReduction(host, next.owner_id); const excessive: Outcome = { ...observed, reason: 'x'.repeat(256) };
await assert.rejects(recordReductionOutcome(host, { id: next.owner_id, op: 'over-'.padEnd(96, 'x'), revision: full.revision, request: reserved.result.identity, outcome: excessive }), code('capacity_exceeded'));
assert.equal((await readReduction(host, next.owner_id)).revision, full.revision);
console.log('SDK WRITE AND BOUNDARIES OK');
