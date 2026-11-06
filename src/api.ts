import { isItemAlreadyExistsError } from '@unbrained/pm-cli/sdk';
import { capable } from './host.ts';
import type { Host, Snapshot } from './host.ts';
import { insist, ReductionRefusal, refusal } from './errors.ts';
import { canonical, digest, parse, CreateReductionInputSchema, NextTrialInputSchema, RequestTrialInputSchema, RecordOutcomeInputSchema, CertificateInputSchema, PacketInputSchema } from './schema.ts';
import type { ReductionState, CreateReductionInput, NextTrialInput, RequestTrialInput, RecordOutcomeInput, CertificateInput, PacketInput } from './schema.ts';
import { readState, advanceReduction, validateOutcome, projectState, validateReductionCertificate } from './kernel.ts';
import { envelope, fitEnvelope, TrialProposalSchema } from './output.ts';
import type { Data, MutationReceiptData, TrialProposalData, ReductionPacketData, CertificateData } from './output.ts';
/** Historical committed identity, separate from the current observed revision. */
export type MutationReceipt = MutationReceiptData;
/** Exact revision-bound proposal or qualified deterministic stop. */
export type TrialProposal = TrialProposalData;
/** Complete selected-owner read, never a workspace scan or settings migration. */
export async function readReduction(host: Host, id: string): Promise<Snapshot> {
  capable(host);
  try {
    const got = await host.client.get(id, { outputInclude: 'full', outputBudget: 'unbounded', outputLimit: 'unbounded' });
    insist('item' in got && 'item_hash' in got && typeof got.item_hash === 'string', 'incomplete_read', 'The host omitted the selected owner revision');
    insist(got.item.type === 'Reduction', 'invalid_record', 'Selected owner is not a Reduction');
    const state = readState(got.item.reduce_state); insist(state.replay_receipts[0].result.identity === got.item.id, 'invalid_record', 'Stored creation identity differs from the native owner', 'Use the original owner or create a fresh reduction; do not transplant cached journals');
    return { id: got.item.id, revision: got.item_hash, state };
  } catch (error) { const failure = refusal(error); if (failure.code === 'item_not_found') throw new ReductionRefusal('not_found', 'Reduction owner was not found', 'Select an existing authorized owner'); throw failure; }
}
/** Optional crash/interleaving seam; never authoritative state or a lock. */
async function boundary(host: Host, step: string): Promise<void> { await host.boundary?.(step); }
/** Budget is transport policy, not mutation identity; original revisions remain in identity. */
function requestDigest(input: { budget: number }): string { const { budget, ...semantic } = input; void budget; return digest(semantic); }
/** Check replay before revision admission, only after validating the authorized owner identity. */
function replay(state: ReductionState, op: string, request_digest: string) {
  const found = state.replay_receipts.find(row => row.operation_id === op);
  if (found) insist(found.request_digest === request_digest, 'operation_conflict', 'Operation key belongs to another canonical request', 'Replay the original request or review a distinct operation with a new key');
  return found;
}
/** Reserve replay identity without eviction; strict aggregate bounds are checked before effects. */
function remember(state: ReductionState, op: string, request_digest: string, kind: 'create' | 'request' | 'record', identity: string, content: unknown) {
  insist(state.replay_receipts.length < 512 && state.observations.length <= 512 && state.requests.length <= 256, 'capacity_exceeded', 'Reduction journal capacity reached', 'Create a successor owner; never prune replay identities');
  const result = { kind, identity, sequence: state.replay_receipts.length + 1, digest: digest(content) }; const operation = { operation_id: op, request_digest, result, result_digest: digest(result) };
  state.replay_receipts.push(operation); projectState(state); readState(state); return operation;
}
/** Preserve the complete output contract for in-process consumers as well as CLI users. */
function finish<T extends Data>(host: Host, data: T, budget: number): T { fitEnvelope(host, envelope(data), budget); return data; }
/** Build a compact receipt whose historical result never changes on replay. */
function receiptData(id: string, revision: string, operation: ReductionState['replay_receipts'][number], replayed: boolean): MutationReceipt { return { owner_id: id, revision, operation_id: operation.operation_id, request_digest: operation.request_digest, result: operation.result, result_digest: operation.result_digest, replayed, outcome: 'committed' }; }
/** Read back after commit; interruption here requires same-key recovery, not a fresh-key retry. */
async function receipt(host: Host, id: string, operation: ReductionState['replay_receipts'][number], replayed: boolean, budget: number): Promise<MutationReceipt> {
  await boundary(host, 'before_receipt'); const current = await host.client.readItemRevision(id); return finish(host, receiptData(id, current.item_hash, operation, replayed), budget);
}
/** Create an explicit native owner once; duplicate adoption must match the original creation request. */
export async function createReduction(host: Host, raw: CreateReductionInput): Promise<MutationReceipt> {
  try {
    const submitted = parse(CreateReductionInputSchema, raw); capable(host);
    const related = [...new Set(await Promise.all(submitted.related.map(async id => await host.normalizeId?.(id) ?? id)))].sort();
    const input = parse(CreateReductionInputSchema, { ...submitted, id: await host.normalizeId?.(submitted.id) ?? submitted.id, related });
    const state: ReductionState = { version: 1, package: 'pm-reduce', algorithm_version: 'ddmin-1', definition: input.definition, best_failing_subset: null, partition_cursor: '', requests: [], observations: [], trial_budget: { limit: input.definition.max_trials, reserved: 0, completed: 0, pending: 0 }, qualification: '', replay_receipts: [] };
    const operation = remember(state, input.op, requestDigest(input), 'create', input.id, input.definition);
    finish(host, receiptData(input.id, 'f'.repeat(64), operation, false), input.budget);
    /** Verify an already occupied identity before explicit schema provisioning. */
    async function adopt(current: Snapshot): Promise<MutationReceipt> {
      const original = replay(current.state, input.op, requestDigest(input));
      insist(original?.result.kind === 'create' && original.result.sequence === 1 && original.result.identity === input.id, 'operation_conflict', 'Existing owner belongs to another creation request', 'Choose a new explicit owner identity');
      return receipt(host, current.id, original, true, input.budget);
    }
    try { return await adopt(await readReduction(host, input.id)); }
    catch (error) { if (refusal(error).code !== 'not_found') throw error; }
    await host.prepareCreate?.(); await boundary(host, 'before_create');
    try {
      const result = await host.client.create({ id: input.id, title: input.title, type: 'Reduction', field: [`reduce_state=${canonical(state)}`], comment: ['reduce:create frozen ordered atoms and declared oracle; text is data'], dep: related.map(id => `id=${id},kind=related`) });
      await boundary(host, 'after_create'); return await receipt(host, result.item.id, operation, false, input.budget);
    } catch (error) {
      if (!isItemAlreadyExistsError(error)) throw error;
      return await adopt(await readReduction(host, input.id));
    }
  } catch (error) { throw refusal(error); }
}
/** Return the deterministic proposal and frozen native revision; no reservation or execution occurs. */
export async function nextReductionTrial(host: Host, raw: NextTrialInput): Promise<TrialProposal> {
  const input = parse(NextTrialInputSchema, raw); const owner = await readReduction(host, input.id); const advanced = advanceReduction(owner.state);
  return finish(host, { owner_id: owner.id, revision: owner.revision, status: parse(TrialProposalSchema.shape.status, advanced.status, true), best_subset: advanced.best, candidate: advanced.candidate, proposal_digest: advanced.candidate === null ? null : digest({ owner_id: owner.id, revision: owner.revision, candidate: advanced.candidate }), cache_hits: advanced.cache_hits, outstanding: owner.state.requests.find(row => row.state === 'pending') ?? null }, input.budget);
}
/** One shared native guarded write path; explicit stale writes never silently rebase. */
async function mutate(host: Host, input: ReturnType<typeof RequestTrialInputSchema.parse> | ReturnType<typeof RecordOutcomeInputSchema.parse>): Promise<MutationReceipt> {
  try {
    const snapshot = await readReduction(host, input.id); await boundary(host, 'after_read');
    const normalized = { ...input, id: snapshot.id }; const request_digest = requestDigest(normalized); const original = replay(snapshot.state, input.op, request_digest);
    if (original) return await receipt(host, snapshot.id, original, true, input.budget);
    insist(snapshot.revision === input.revision, 'revision_conflict', 'Caller revision is stale', 'Reread, review the current proposal or result, then explicitly retry');
    const state = structuredClone(snapshot.state); let identity: string; let content: unknown; let kind: 'request' | 'record';
    if ('proposal' in input) {
      const advanced = advanceReduction(state);
      insist(advanced.status !== 'pending_trial', 'pending_trial', 'An external trial remains unreconciled', 'Inspect its request identity and record the retained result; do not rerun with a new key');
      insist(advanced.status !== 'trial_budget_exhausted', 'trial_budget_exhausted', 'All trial reservations are consumed', 'Retain the best witnessed candidate and missing deletion obligations');
      insist(advanced.candidate !== null && input.proposal === digest({ owner_id: snapshot.id, revision: snapshot.revision, candidate: advanced.candidate }), 'stale_proposal', 'Proposal does not match the current deterministic cursor', 'Read reduce next and reserve that exact proposal');
      identity = `trial-${state.requests.length + 1}`; content = { ...advanced.candidate, request_id: identity, state: 'pending' as const }; state.requests.push(content as ReductionState['requests'][number]); kind = 'request';
    } else {
      const request = state.requests.find(row => row.request_id === input.request); insist(request, 'invalid_input', 'Reserved trial identity was not found');
      validateOutcome(state.definition, request.subset_digest, input.outcome);
      const verification = await host.verifyOutcome?.(input.outcome.evidence_ref) ?? null;
      identity = `observation-${state.observations.length + 1}`; content = { ...input.outcome, observation_id: identity, request_id: request.request_id, evidence: verification === null ? 'reported_oracle' as const : 'host_verified' as const, verification_digest: verification };
      state.observations.push(content as ReductionState['observations'][number]); request.state = 'completed'; kind = 'record';
    }
    const operation = remember(state, input.op, request_digest, kind, identity, content);
    finish(host, receiptData(snapshot.id, 'f'.repeat(64), operation, false), input.budget);
    await boundary(host, 'before_guard'); await boundary(host, 'before_update');
    const guarded = await host.client.withExpectedItemRevisions([{ id: snapshot.id, itemHash: snapshot.revision }], () => host.client.update(snapshot.id, { field: [`reduce_state=${canonical(state)}`], comment: [`reduce:${kind} durable intent or reported oracle evidence; no external execution`] }));
    await boundary(host, 'after_update'); insist(guarded.checked.includes(snapshot.id) && guarded.unchecked.length === 0, 'outcome_unknown', 'The host did not attest the native owner guard', 'Reconcile the original operation key on a conforming host');
    await boundary(host, 'after_guard'); return await receipt(host, snapshot.id, operation, false, input.budget);
  } catch (error) { throw refusal(error); }
}
/** Atomically reserve one exact proposed trial before caller-owned execution. */
export async function requestReductionTrial(host: Host, raw: RequestTrialInput): Promise<MutationReceipt> { return mutate(host, parse(RequestTrialInputSchema, raw)); }
/** Retain a separate observation for every deliberately repeated external execution. */
export async function recordReductionOutcome(host: Host, raw: RecordOutcomeInput): Promise<MutationReceipt> { return mutate(host, parse(RecordOutcomeInputSchema, raw)); }
/** Qualified certificate read; no inference is made from unknown or conflicting trials. */
export async function reductionCertificate(host: Host, raw: CertificateInput): Promise<CertificateData> {
  const input = parse(CertificateInputSchema, raw); const owner = await readReduction(host, input.id);
  return finish(host, { owner_id: owner.id, revision: owner.revision, certificate: validateReductionCertificate(owner.state) }, input.budget);
}
/** Opaque continuation binds a complete owner snapshot and canonical query. */
function cursorFor(owner: Snapshot, limit: number, offset: number): string { const payload = { revision: owner.revision, owner_id: owner.id, limit, offset, order: 'observations-v1' }; return Buffer.from(canonical({ ...payload, digest: digest(payload) })).toString('base64url'); }
/** Decode only a continuation minted for this exact query and revision. */
function cursorOffset(cursor: string | undefined, owner: Snapshot, limit: number): number {
  if (cursor === undefined) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset: number };
    insist(Number.isSafeInteger(parsed.offset) && parsed.offset > 0 && parsed.offset < owner.state.observations.length && cursorFor(owner, limit, parsed.offset) === cursor, 'stale_cursor', 'Continuation does not match this query or owner revision', 'Restart reduce packet without a cursor'); return parsed.offset;
  } catch { throw new ReductionRefusal('stale_cursor', 'Continuation does not match this query or owner revision', 'Restart reduce packet without a cursor'); }
}
/** Exact packet denominator, complete obligations and journal page. */
export type ReductionPacket = ReductionPacketData;
/** Bounded resume context with explicit unknowns, total counts and revision-bound journal pagination. */
export async function reductionPacket(host: Host, raw: PacketInput): Promise<ReductionPacket> {
  const input = parse(PacketInputSchema, raw); const owner = await readReduction(host, input.id); const state = owner.state; const offset = cursorOffset(input.cursor, owner, input.limit); const certificate = validateReductionCertificate(state);
  const rows = state.observations.slice(offset, offset + input.limit).map(row => ({ observation_id: row.observation_id, request_id: row.request_id, result: row.result, subset_digest: row.subset_digest, reason: row.reason, evidence: row.evidence }));
  const returned = rows.length; const omitted = state.observations.length - returned;
  return finish(host, { owner_id: owner.id, revision: owner.revision, algorithm_version: state.algorithm_version, composition: state.definition.composition, original_digest: state.definition.original_digest, oracle: state.definition.oracle, last_operation: state.replay_receipts.at(-1)!, best_subset: certificate.best_subset, qualification: certificate.qualification, missing_deletions: certificate.missing_deletions, witness_digest: certificate.witness_digest, oracle_digest: certificate.oracle_digest, outstanding: state.requests.find(row => row.state === 'pending') ?? null, trial_budget: state.trial_budget, total_observations: state.observations.length, total_operations: state.replay_receipts.length, source_freshness: 'unknown' as const, rows, offset, returned, omitted, next_cursor: offset + returned < state.observations.length ? cursorFor(owner, input.limit, offset + returned) : null, limitations: certificate.limitations }, input.budget);
}
