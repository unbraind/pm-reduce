import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceReduction, canonicalSubsetDigest, validateReductionCertificate, digest, canonical, readState } from '../dist/index.js';
import type { ReductionState, Outcome } from '../dist/index.js';
import { projectState, validateOutcome, cachedOutcome } from '../dist/src/kernel.js';
import { definition, outcome, hasCode } from './helpers.ts';
/** Pure journal fixture independently admits one observation per exact candidate. */
function state(count = 16): ReductionState {
  const result = { kind: 'create' as const, identity: 'owner', sequence: 1, digest: digest(definition(count)) };
  return projectState({ version: 1, package: 'pm-reduce', algorithm_version: 'ddmin-1', definition: definition(count), best_failing_subset: null, partition_cursor: '', requests: [], observations: [], trial_budget: { limit: 256, reserved: 0, completed: 0, pending: 0 }, qualification: '', replay_receipts: [{ operation_id: 'birth', request_digest: digest('birth'), result, result_digest: digest(result) }] });
}
/** Test-caller oracle observation; production never invokes a predicate. */
function observe(s: ReductionState, result: Outcome['result']) {
  const next = advanceReduction(s); assert.ok(next.candidate); const candidate = next.candidate;
  const request_id = `trial-${s.requests.length + 1}`;
  const request = { ...candidate, request_id, state: 'pending' as const }; const observed = { ...outcome(s.definition, candidate.subset_digest, result), request_id, observation_id: `o${s.observations.length}`, evidence: 'reported_oracle' as const, verification_digest: null };
  for (const [kind, identity, content] of [['request', request_id, request], ['record', observed.observation_id, observed]] as const) { const committed = {kind,identity,sequence:s.replay_receipts.length+1,digest:digest(content)}; s.replay_receipts.push({operation_id:`op-${committed.sequence}`,request_digest:digest(committed),result:committed,result_digest:digest(committed)}); }
  s.requests.push({ ...request, state: 'completed' }); s.observations.push(observed); projectState(s); return candidate;
}
/** Retain the exact synthetic journal operation for additional evidence controls. */
function appendOperation(s: ReductionState, kind: 'request' | 'record', identity: string, content: unknown) {
  const result = { kind, identity, sequence: s.replay_receipts.length + 1, digest: digest(content) };
  s.replay_receipts.push({ operation_id: `extra-${result.sequence}`, request_digest: digest(result), result, result_digest: digest(result) });
}
test('ddmin and independent deletion witnesses retain 1-minimality for monotone and nonmonotone inputs', () => {
  for (const predicate of [(ids: string[]) => ids.includes('a7'), (ids: string[]) => ids.includes('a3') && ids.includes('a12') || ids.length === 16, (ids: string[]) => ids.length === 0 || ids.length === 16]) {
    const s = state(); let loops = 0;
    for (;;) { const proposal = advanceReduction(s); if (!proposal.candidate) break; assert.ok(++loops < 256); observe(s, predicate(proposal.candidate.subset_ids) ? 'target_fail' : 'pass'); readState(s); }
    const certificate = validateReductionCertificate(s); validateReductionCertificate(s, certificate); assert.equal(predicate(certificate.best_subset!), true);
    assert.ok(['one_minimal_under_recorded_oracle', 'empty_target_failure'].includes(certificate.qualification));
    for (let at = 0; at < certificate.best_subset!.length; at++) assert.equal(predicate(certificate.best_subset!.filter((_, index) => index !== at)), false);
    assert.throws(() => validateReductionCertificate(s, { ...certificate, witness_digest: digest('forged') }), hasCode('invalid_certificate'));
  }
});
test('baseline, unresolved, empty failure, budget and conflicting observations cannot fabricate minimality', () => {
  const pass = state(1); observe(pass, 'pass'); assert.equal(advanceReduction(pass).status, 'baseline_not_failing'); assert.equal(validateReductionCertificate(pass).qualification, 'baseline_not_failing');
  const unknown = state(1); observe(unknown, 'unresolved'); assert.equal(advanceReduction(unknown).status, 'baseline_unresolved');
  const s = state(1); observe(s, 'target_fail'); assert.equal(validateReductionCertificate(s).qualification, 'minimality_unproven', 'proof:deletion_obligations'); observe(s, 'unresolved'); assert.equal(validateReductionCertificate(s).qualification, 'minimality_unproven', 'proof:deletion_obligations');
  const empty = state(1); observe(empty, 'target_fail'); observe(empty, 'target_fail'); assert.equal(validateReductionCertificate(empty).qualification, 'empty_target_failure');
  const exhausted = state(1); exhausted.definition.max_trials = 1; exhausted.replay_receipts[0].result.digest = digest(exhausted.definition); exhausted.replay_receipts[0].result_digest = digest(exhausted.replay_receipts[0].result); projectState(exhausted); observe(exhausted, 'target_fail'); assert.equal(advanceReduction(exhausted).status, 'trial_budget_exhausted');
  const pending = state(); const next = advanceReduction(pending).candidate!; pending.requests.push({ ...next, request_id: 'pending', state: 'pending' }); projectState(pending); assert.equal(advanceReduction(pending).status, 'pending_trial');
  const conflict = structuredClone(pass); conflict.observations.push({ ...conflict.observations[0], observation_id: 'opposite', result: 'target_fail', actual_signature: 'target' }); appendOperation(conflict, 'record', 'opposite', conflict.observations.at(-1)); projectState(conflict); assert.equal(cachedOutcome(conflict, ['a0']), 'conflict'); assert.equal(validateReductionCertificate(conflict).qualification, 'flaky_oracle');
});
test('subset identity preserves order and exact whitespace; observed contracts match every frozen identity', () => {
  const def = definition(); assert.equal(canonical({ b: 2, a: ['  x\n'] }), '{"a":["  x\\n"],"b":2}'); assert.equal(canonical({ a: undefined }), '{}');
  for (const subset of [['a1', 'a0'], ['a0', 'a0'], ['unknown']]) assert.throws(() => canonicalSubsetDigest(def, subset), hasCode('subset_mismatch'));
  const key = canonicalSubsetDigest(def, ['a0']); const base = outcome(def, key); validateOutcome(def, key, base);
  for (const field of ['oracle_digest', 'recipe_digest', 'subject_digest', 'environment_digest', 'result_schema_digest'] as const) assert.throws(() => validateOutcome(def, key, { ...base, [field]: digest('different') }), hasCode('oracle_mismatch'));
  assert.throws(() => validateOutcome(def, key, { ...base, subset_digest: digest('different') }), hasCode('subset_mismatch'));
  for (const patch of [{ actual_signature: 'other' }, { completed: false }, { result: 'pass' as const }]) assert.throws(() => validateOutcome(def, key, { ...base, ...patch }), hasCode('invalid_signature'), 'proof:oracle_signature');
});
test('stored state validates versions, relationships, reservations, digests and derived projections', () => {
  const s = state(1); observe(s, 'target_fail'); readState(s);
  const mutations: [string, (copy: ReductionState) => void][] = [
    ['Journal identities are duplicated', copy => { copy.requests.push(copy.requests[0]); }],
    ['Stored trial contract is inconsistent', copy => { copy.requests[0].subset_digest = digest('wrong'); }],
    ['Stored trial contract is inconsistent', copy => { copy.requests[0].oracle_digest = digest('wrong'); }],
    ['Stored reservation completion is inconsistent', copy => { copy.requests[0].state = 'pending'; }],
    ['Observation has no reserved request', copy => { copy.observations.push({ ...copy.observations[0], observation_id: 'orphan', request_id: 'absent' }); appendOperation(copy, 'record', 'orphan', copy.observations.at(-1)); }],
    ['Verification attribution is inconsistent', copy => { copy.observations[0].verification_digest = digest('fake'); }],
    ['Replay result or frozen definition digest is inconsistent', copy => { copy.replay_receipts[0].result_digest = digest('wrong'); }],
    ['Stored reduction projections do not match the journal', copy => { copy.qualification = 'wrong'; }],
    ['Journal identities are duplicated', copy => { copy.observations.push(copy.observations[0]); }],
    ['Journal identities are duplicated', copy => { copy.replay_receipts.push(copy.replay_receipts[0]); }],
  ];
  for (const [detail, change] of mutations) { const copy = structuredClone(s); change(copy); assert.throws(() => readState(copy), error => hasCode('invalid_record')(error) && error instanceof Error && error.message === detail); }
  assert.throws(() => readState({ ...s, version: 2 }), hasCode('invalid_record'));
});

test('flaky observations suspend reuse while retaining smallest recorded failure and an outstanding unrelated request', () => {
  const s = state(2); observe(s, 'target_fail'); observe(s, 'target_fail');
  const next = advanceReduction(s).candidate!; s.requests.push({ ...next, request_id: 'pending-next', state: 'pending' }); appendOperation(s, 'request', 'pending-next', s.requests.at(-1));
  s.observations.push({ ...s.observations[0], observation_id: 'conflicting-baseline', result: 'pass', actual_signature: null });
  appendOperation(s, 'record', 'conflicting-baseline', s.observations.at(-1)); projectState(s);
  const advanced = advanceReduction(s); assert.equal(advanced.status, 'flaky_oracle'); assert.deepEqual(advanced.best, ['a0']); assert.equal(validateReductionCertificate(s).qualification, 'flaky_oracle');
});
/** Exercise arbitrary truth tables and refuse an oracle that never reaches certification. */
function checkSeededCertificates(certify: (s: ReductionState) => ReturnType<typeof validateReductionCertificate> = validateReductionCertificate): void {
  let seed = 6536; let certifiedScenarios = 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let scenario = 0; scenario < 100; scenario++) {
    const truth = Array.from({ length: 16 }, () => random() % 7 === 0 ? 'unresolved' as const : random() % 3 === 0 ? 'target_fail' as const : 'pass' as const); truth[15] = 'target_fail';
    const s = state(4); s.definition.max_trials = 2 + random() % 32; s.replay_receipts[0].result.digest = digest(s.definition); s.replay_receipts[0].result_digest = digest(s.replay_receipts[0].result); projectState(s);
    while (advanceReduction(s).candidate) { const ids = advanceReduction(s).candidate!.subset_ids; const mask = ids.reduce((bits, id) => bits | 1 << Number(id.slice(1)), 0); observe(s, truth[mask]); }
    const certificate = certify(s);
    if (certificate.qualification === 'one_minimal_under_recorded_oracle') {
      certifiedScenarios++;
      const mask = certificate.best_subset!.reduce((bits, id) => bits | 1 << Number(id.slice(1)), 0); assert.equal(truth[mask], 'target_fail');
      for (const id of certificate.best_subset!) assert.equal(truth[mask & ~(1 << Number(id.slice(1)))], 'pass');
    }
  }
  assert.ok(certifiedScenarios > 0, 'proof:seeded_certificates');
}
test('seeded arbitrary nonmonotone truth tables with unresolved probes never yield false certificates', () => {
  checkSeededCertificates();
  assert.throws(() => checkSeededCertificates(s => ({ ...validateReductionCertificate(s), qualification: 'minimality_unproven' })), /proof:seeded_certificates/, 'proof:seeded_nonvacuity');
});

test('pure certificate API validates signatures and frozen journals rather than trusting a typed object', () => {
  const s = state(1); observe(s, 'target_fail'); observe(s, 'pass'); const corrupted = structuredClone(s); corrupted.observations[0].actual_signature = 'wrong';
  assert.throws(() => validateReductionCertificate(corrupted), hasCode('invalid_signature'));
  assert.throws(() => validateReductionCertificate(s, {} as ReturnType<typeof validateReductionCertificate>), hasCode('invalid_certificate'));
  const inherited = structuredClone(s); inherited.definition.original_digest = digest('different-source'); assert.throws(() => validateReductionCertificate(inherited), error => hasCode('invalid_record')(error) && error instanceof Error && error.message === 'Stored trial contract is inconsistent');
});

test('certificate digest binds full immutable witness content and source identities', () => {
  const s = state(1); observe(s, 'target_fail'); observe(s, 'pass'); const original = validateReductionCertificate(s); const changed = structuredClone(s);
  changed.observations[0].evidence_ref.content_digest = digest('different immutable result');
  const record = changed.replay_receipts.find(row => row.result.kind === 'record' && row.result.identity === changed.observations[0].observation_id)!;
  record.result.digest = digest(changed.observations[0]); record.result_digest = digest(record.result); readState(changed);
  assert.throws(() => validateReductionCertificate(changed, original), hasCode('invalid_certificate'), 'proof:witness_binding'); assert.notEqual(validateReductionCertificate(changed).witness_digest, original.witness_digest);
});
