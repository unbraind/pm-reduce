import test from 'node:test';
import assert from 'node:assert/strict';
import { PmClient } from '@unbrained/pm-cli/sdk/core';
import { createReduction, readReduction, nextReductionTrial, requestReductionTrial, recordReductionOutcome, reductionCertificate, reductionPacket, digest, createDirectoryHost } from '../dist/index.js';
import type { Host } from '../dist/index.js';
import { fixture, definition, source, reserve, runTrial, outcome, hasCode, historyEvents } from './helpers.ts';

test('native no-git round trips preserve exact text, links, comments, replay and complete certificate', async t => {
  const { host, native, id, pmRoot, birth } = await fixture(t, false, definition(4));
  const related = (await native.create({ id: 'corpus-related', title: 'Investigation', type: 'Task' })).item.id;
  const input = { ...birth, related: [related, related] }; const created = await createReduction(host, input);
  assert.equal(created.result.kind, 'create'); const count = await historyEvents(pmRoot); const repeated = await createReduction(host, { ...input, id: 'repro', op: ' birth ', budget: 1800 }); assert.equal(repeated.replayed, true); assert.equal(await historyEvents(pmRoot), count);
  await assert.rejects(createReduction(host, { ...input, title: 'Changed' }), hasCode('operation_conflict'));
  const got = await native.get(id, { outputInclude: 'full', outputBudget: 'unbounded' }); assert.ok('item' in got); assert.ok(got.item.dependencies?.some(row => row.id === related)); assert.equal((await readReduction(host, id)).state.definition.atoms[0].label, '  atom 0\n ');
  let index = 0;
  for (;;) { const next = await nextReductionTrial(host, { id }); if (!next.candidate) break; const trial = await runTrial(host, id, `${index++}`, ids => ids.includes('a2') ? 'target_fail' : 'pass'); const history = await historyEvents(pmRoot); const replayed = await recordReductionOutcome(host, trial.recordInput); assert.equal(replayed.replayed, true); assert.equal(replayed.result_digest, trial.record.result_digest); assert.equal(await historyEvents(pmRoot), history); }
  const certificate = await reductionCertificate(host, { id }); assert.equal(certificate.certificate.qualification, 'one_minimal_under_recorded_oracle'); assert.deepEqual(certificate.certificate.best_subset, ['a2']);
  const before = await historyEvents(pmRoot); const packet = await reductionPacket(host, { id, limit: 1 }); assert.equal(packet.returned, 1); assert.ok(packet.omitted! > 0); assert.equal(packet.source_freshness, 'unknown'); assert.equal(await historyEvents(pmRoot), before);
  const nextPage = await reductionPacket(host, { id, limit: 1, cursor: packet.next_cursor as string }); assert.equal(nextPage.offset, 1);
  for (const cursor of ['garbage', Buffer.from('null').toString('base64url'), packet.next_cursor as string]) await assert.rejects(reductionPacket(host, { id, limit: 2, cursor }), hasCode('stale_cursor'));
  const old = await createReduction(host, input); assert.equal(old.replayed, true); assert.notEqual(old.revision, created.revision); assert.deepEqual(old.result, created.result);
  await assert.rejects(readReduction(host, 'corpus-missing'), hasCode('not_found'));
});
test('typed guards and output budget refuse before native side effects', async t => {
  const { host, native, id, pmRoot, birth } = await fixture(t); const before = await historyEvents(pmRoot); const next = await nextReductionTrial(host, { id });
  await assert.rejects(requestReductionTrial(host, { id, op: 'bad', revision: next.revision, proposal: digest('wrong') }), hasCode('stale_proposal'));
  await assert.rejects(requestReductionTrial(host, { id, op: 'bad', revision: digest('stale'), proposal: next.proposal_digest! }), hasCode('revision_conflict'));
  await assert.rejects(requestReductionTrial(host, { id, op: 'bad', revision: next.revision, proposal: next.proposal_digest!, budget: 1 }), hasCode('output_budget')); assert.equal(await historyEvents(pmRoot), before);
  await assert.rejects(createReduction(host, { ...birth, id: 'corpus-small', budget: 1 }), hasCode('output_budget')); await assert.rejects(native.get('corpus-small'));
  const reservation = await reserve(host); const snapshot = await readReduction(host, id); const record = { id, op: 'result', revision: snapshot.revision, request: reservation.receipt.result.identity, outcome: outcome(birth.definition, reservation.candidate.subset_digest) };
  await assert.rejects(requestReductionTrial(host, { id, op: 'duplicate', revision: snapshot.revision, proposal: next.proposal_digest! }), hasCode('pending_trial'));
  assert.equal((await nextReductionTrial(host, { id })).status, 'pending_trial');
  for (const patch of [{ subset_digest: digest('wrong') }, { environment_digest: digest('wrong') }, { actual_signature: 'other' }]) await assert.rejects(recordReductionOutcome(host, { ...record, outcome: { ...record.outcome, ...patch } }));
  await assert.rejects(recordReductionOutcome(host, { ...record, request: 'missing' }), hasCode('invalid_input'));
  await recordReductionOutcome(host, record);
  await assert.rejects(recordReductionOutcome(host, { ...record, outcome: { ...record.outcome, reason: 'different' } }), hasCode('operation_conflict'));
  const now = await readReduction(host, id); const opposite = { ...record, op: 'repeat-execution', revision: now.revision, outcome: { ...record.outcome, result: 'pass' as const, actual_signature: null } };
  await recordReductionOutcome(host, opposite); assert.equal((await nextReductionTrial(host, { id })).status, 'flaky_oracle'); assert.equal((await reductionCertificate(host, { id })).certificate.qualification, 'flaky_oracle');
});
test('directory and injected contract adapters preserve native CAS and optional trusted verification', async t => {
  const { host, id, pmRoot } = await fixture(t);
  const client = new PmClient({ cwd: pmRoot, pmRoot, author: 'injected', noExtensions: true }); const injected = { ...host, client: { ...host.client, get: client.get.bind(client), readItemRevision: client.readItemRevision.bind(client), withExpectedItemRevisions: client.withExpectedItemRevisions.bind(client) }, normalizeId: undefined, prepareCreate: undefined, verifyOutcome: async () => digest('verified') };
  const trial = await runTrial(injected, id, 'trusted', () => 'pass'); assert.equal(trial.record.outcome, 'committed'); assert.equal((await readReduction(host, id)).state.observations[0].evidence, 'host_verified');
  const unsupported = { ...host, capabilities: { native_item_cas: false, create_if_absent: false, provider: 'unsupported' } }; await assert.rejects(readReduction(unsupported, id), hasCode('backend_unsupported')); await assert.rejects(createReduction(unsupported, { id: 'new', op: 'birth', title: 'New', definition: definition() }), hasCode('backend_unsupported'));
  for (const patch of [{ client: undefined }, { client: { ...host.client, create: undefined } }, { capabilities: undefined }, { capabilities: { ...host.capabilities, create_if_absent: false } }]) await assert.rejects(readReduction({ ...host, ...patch } as unknown as Host, id), hasCode('backend_unsupported'));
  const persisted = createDirectoryHost(pmRoot, 'fixture'); assert.equal((await readReduction(persisted, id)).id, id); assert.equal(await persisted.settings!(), undefined);
});
test('budget exhaustion retains exact remaining obligations and no extra reservation', async t => {
  const def = definition(1); def.max_trials = 1; const { host, id, pmRoot } = await fixture(t, true, def); await runTrial(host, id, 'baseline', () => 'target_fail');
  const before = await historyEvents(pmRoot); const next = await nextReductionTrial(host, { id }); assert.equal(next.status, 'trial_budget_exhausted');
  await assert.rejects(requestReductionTrial(host, { id, op: 'extra', revision: next.revision, proposal: digest('anything') }), hasCode('trial_budget_exhausted'));
  assert.deepEqual((await reductionCertificate(host, { id })).certificate.missing_deletions, ['a0']); assert.equal(await historyEvents(pmRoot), before);
});
