/** Run the packed public SDK in a real consumer, using only synthetic oracle reports. */
import assert from 'node:assert/strict';
import { createDirectoryHost, createReduction, readReduction, nextReductionTrial, requestReductionTrial, recordReductionOutcome, reductionCertificate, reductionPacket, validateReductionCertificate, readState, canonical, digest, ReductionRefusal } from 'pm-reduce';
import type { Outcome, ReductionState } from 'pm-reduce';
import { mountedHomePaths } from './home-paths.ts';
import { appendObservation, fillJournal, largestOutcome } from './capacity-tools.ts';
/** Match one stable packed refusal without depending on its diagnostics. */
function code(expected: string) { return (error: unknown) => error instanceof ReductionRefusal && error.code === expected; }
const host = createDirectoryHost(process.cwd() + '/.agents/pm', 'consumer'); const owner = await readReduction(host, 'packed-repro');
const unavailable = { ...host, fitOutputEnvelope: () => { throw new Error('sensitive host diagnostics'); } };
for (const read of [nextReductionTrial, reductionCertificate, reductionPacket]) await assert.rejects(read(unavailable, { id: owner.id }), code('output_unavailable'));
await assert.rejects(createReduction(unavailable, { id: 'packed-fitter', op: 'birth', title: 'Public', definition: owner.state.definition }), code('outcome_unknown'));
await assert.rejects(readReduction(host, 'packed-fitter'), code('not_found'));
const { observation_id, request_id, evidence, verification_digest, ...observed } = owner.state.observations[0]; void observation_id; void evidence; void verification_digest;
const input = { id: owner.id, op: 'packed-sdk-write', revision: owner.revision, request: request_id, outcome: observed };
const privatePath = mountedHomePaths().forbidden[0]; const privateDefinition = structuredClone(owner.state.definition); privateDefinition.atoms[0].label = privatePath;
await assert.rejects(createReduction(host, { id: 'packed-private-sdk', op: 'birth', title: 'Public', definition: privateDefinition }), code('invalid_input'));
await assert.rejects(readReduction(host, 'packed-private-sdk'), code('not_found'));
await assert.rejects(recordReductionOutcome(host, { ...input, outcome: { ...observed, reason: privatePath } }), code('invalid_input'));
assert.equal((await readReduction(host, owner.id)).revision, owner.revision);
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
  const copy: ReductionState = appendObservation(state, index);
  try { readState(copy); state = copy; } catch (error) { assert.ok(code('capacity_exceeded')(error)); bounded = true; break; }
}
assert.equal(bounded, true); await host.client.update(next.owner_id, { field: [`reduce_state=${canonical(state)}`] });
const full = await readReduction(host, next.owner_id); const excessive: Outcome = { ...observed, reason: 'x'.repeat(256) };
await assert.rejects(recordReductionOutcome(host, { id: next.owner_id, op: 'over-'.padEnd(96, 'x'), revision: full.revision, request: reserved.result.identity, outcome: excessive }), code('capacity_exceeded'));
assert.equal((await readReduction(host, next.owner_id)).revision, full.revision);
const capacityDefinition = structuredClone(owner.state.definition); capacityDefinition.atoms.push({ ...capacityDefinition.atoms[0], atom_id: 'capacity-second' });
await createReduction(host, { id: 'packed-reservation', op: 'birth', title: 'Completion capacity', definition: capacityDefinition });
const first = await nextReductionTrial(host, { id: 'packed-reservation' });
const baseline = await requestReductionTrial(host, { id: first.owner_id, op: 'baseline-request', revision: first.revision, proposal: first.proposal_digest! });
await recordReductionOutcome(host, { id: first.owner_id, op: 'baseline-result', revision: baseline.revision, request: baseline.result.identity, outcome: { ...observed, subset_digest: first.candidate!.subset_digest } });
const completable = fillJournal((await readReduction(host, first.owner_id)).state, 227000);
await host.client.update(first.owner_id, { field: [`reduce_state=${canonical(completable)}`] });
const reviewed = await nextReductionTrial(host, { id: first.owner_id });
const admitted = await requestReductionTrial(host, { id: first.owner_id, op: 'admitted', revision: reviewed.revision, proposal: reviewed.proposal_digest! });
await recordReductionOutcome(host, { id: first.owner_id, op: 'maximum-outcome', revision: admitted.revision, request: admitted.result.identity, outcome: largestOutcome({ ...observed, subset_digest: reviewed.candidate!.subset_digest }) });
assert.equal((await readReduction(host, first.owner_id)).state.trial_budget.pending, 0);
const seeded = fillJournal((await readReduction(host, first.owner_id)).state, 242000);
await host.client.update(first.owner_id, { field: [`reduce_state=${canonical(seeded)}`] });
const blocked = await nextReductionTrial(host, { id: first.owner_id });
assert.ok(blocked.candidate);
await assert.rejects(requestReductionTrial(host, { id: first.owner_id, op: 'cannot-complete', revision: blocked.revision, proposal: blocked.proposal_digest! }), code('capacity_exceeded'));
assert.equal((await readReduction(host, first.owner_id)).revision, blocked.revision);
console.log('SDK WRITE AND BOUNDARIES OK');
