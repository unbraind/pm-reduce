import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createReduction, nextReductionTrial, readReduction, requestReductionTrial, recordReductionOutcome, reductionCertificate, createDirectoryHost } from '../dist/index.js';
import { fixture, reserve, outcome, hasCode, historyEvents, definition } from './helpers.ts';
import { npmEnvironment, testEnvironment } from '../scripts/environment.ts';
/** Launch a separate OS writer with no Git executable or credential variables. */
async function writer(pmRoot: string, mode: string, input: unknown, crash = ''): Promise<{ status: number; output: { ok: boolean; code?: string; receipt?: { replayed: boolean } } | null }> {
  const child = spawn(process.execPath, [resolve('test/writer.ts'), pmRoot, mode, JSON.stringify(input), crash], { env: { ...testEnvironment(npmEnvironment(process.env)), PATH: '', GIT_CEILING_DIRECTORIES: pmRoot }, stdio: ['ignore', 'pipe', 'pipe'] }); let text = ''; let errors = '';
  child.stdout.on('data', chunk => { text += String(chunk); }); child.stderr.on('data', chunk => { errors += String(chunk); });
  const status = await new Promise<number>(done => { child.on('close', code => done(code ?? -1)); }); assert.equal(errors, ''); return { status, output: text.trim() ? JSON.parse(text) as { ok: boolean; code?: string; receipt?: { replayed: boolean } } : null };
}
test('two OS writers reserve at most once; rejected stale writes have no history effect', async t => {
  const { host, id, pmRoot } = await fixture(t); const next = await nextReductionTrial(host, { id }); const before = await historyEvents(pmRoot);
  const input = { id, op: 'writer-a', revision: next.revision, proposal: next.proposal_digest! };
  const results = await Promise.all([writer(pmRoot, 'request', input), writer(pmRoot, 'request', { ...input, op: 'writer-b' })]);
  assert.equal(results.filter(row => row.output?.ok).length, 1); assert.equal(results.filter(row => row.output?.code === 'revision_conflict').length, 1);
  assert.equal((await readReduction(host, id)).state.requests.length, 1); assert.equal(await historyEvents(pmRoot), before + 1);
});
test('a competing native write at every mutation boundary survives once without silent rebasing', async t => {
  for (const step of ['after_read', 'before_guard', 'before_update', 'after_update', 'after_guard', 'before_receipt']) {
    const { host, id, pmRoot } = await fixture(t); const reservation = await reserve(host); const snapshot = await readReduction(host, id);
    const input = { id, op: 'mine', revision: snapshot.revision, request: reservation.receipt.result.identity, outcome: outcome(snapshot.state.definition, reservation.candidate.subset_digest) };
    let injected = false; let competitorCode: string | undefined;
    host.boundary = async boundary => {
      if (boundary !== step || injected) return; injected = true;
      try { await recordReductionOutcome(createDirectoryHost(pmRoot, 'competitor'), { ...input, op: 'competitor' }); } catch (error) { competitorCode = (error as { code: string }).code; }
    };
    const before = await historyEvents(pmRoot);
    if (['after_read', 'before_guard', 'before_update'].includes(step)) await assert.rejects(recordReductionOutcome(host, input), hasCode('revision_conflict'));
    else { await recordReductionOutcome(host, input); assert.equal(competitorCode, 'revision_conflict'); }
    assert.equal(injected, true); const current = await readReduction(host, id); assert.equal(current.state.observations.length, 1); assert.equal(await historyEvents(pmRoot), before + 1);
    host.boundary = undefined;
    const winning = current.state.replay_receipts.at(-1)!.operation_id; const replay = await recordReductionOutcome(host, { ...input, op: winning }); assert.equal(replay.replayed, true); assert.equal(await historyEvents(pmRoot), before + 1);
  }
});
test('process interruption before and after every durable boundary converges under original replay identity', async t => {
  for (const step of ['after_read', 'before_guard', 'before_update', 'after_update', 'after_guard', 'before_receipt']) {
    const { host, id, pmRoot } = await fixture(t); const next = await nextReductionTrial(host, { id }); const input = { id, op: 'interrupted', revision: next.revision, proposal: next.proposal_digest! }; const before = await historyEvents(pmRoot);
    assert.equal((await writer(pmRoot, 'request', input, step)).status, 79);
    const committed = ['after_update', 'after_guard', 'before_receipt'].includes(step); const receipt = await requestReductionTrial(host, input); assert.equal(receipt.replayed, committed); assert.equal(await historyEvents(pmRoot), before + 1);
    const current = await readReduction(host, id); assert.equal(current.state.requests.length, 1); assert.equal((await reductionCertificate(host, { id })).certificate.qualification, 'baseline_unresolved');
    // Retained caller result after external execution but before record: pending survives a fresh process.
    const observed = { id, op: 'retained-result', revision: current.revision, request: receipt.result.identity, outcome: outcome(current.state.definition, current.state.requests[0].subset_digest) };
    assert.equal((await writer(pmRoot, 'record', observed, 'after_update')).status, 79); assert.equal((await recordReductionOutcome(host, observed)).replayed, true); assert.equal((await readReduction(host, id)).state.observations.length, 1);
  }
});
test('create interruption and competing creates verify ownership before same-key adoption', async t => {
  for (const step of ['before_create', 'after_create', 'before_receipt']) {
    const { host, pmRoot, birth } = await fixture(t, false); assert.equal((await writer(pmRoot, 'create', birth, step)).status, 79); const result = await createReduction(host, birth); assert.equal(result.replayed, step !== 'before_create'); assert.equal(await historyEvents(pmRoot), 1);
  }
  const { host, birth, pmRoot } = await fixture(t, false); const results = await Promise.all([writer(pmRoot, 'create', birth), writer(pmRoot, 'create', birth)]); assert.ok(results.every(row => row.output?.ok)); assert.equal(results.filter(row => row.output?.receipt?.replayed).length, 1); assert.equal(await historyEvents(pmRoot), 1);
  await assert.rejects(createReduction(host, { ...birth, op: 'different-birth', definition: definition(1) }), hasCode('operation_conflict'));
});

test('two OS outcome writers preserve both acknowledged observations and rerun convergence', async t => {
  const { host, id, pmRoot } = await fixture(t); const reserved = await reserve(host); const current = await readReduction(host, id); const before = await historyEvents(pmRoot);
  const base = { id, revision: current.revision, request: reserved.receipt.result.identity, outcome: outcome(current.state.definition, reserved.candidate.subset_digest) };
  const inputs = ['execution-a', 'execution-b'].map(op => ({ ...base, op })); const results = await Promise.all(inputs.map(input => writer(pmRoot, 'record', input)));
  assert.equal(results.filter(row => row.output?.ok).length, 1); const loser = results.findIndex(row => !row.output?.ok); assert.equal(results[loser].output?.code, 'revision_conflict');
  const reviewed = { ...inputs[loser], revision: (await readReduction(host, id)).revision }; await recordReductionOutcome(host, reviewed);
  assert.equal((await readReduction(host, id)).state.observations.length, 2); assert.equal((await readReduction(host, id)).state.requests.length, 1); assert.equal(await historyEvents(pmRoot), before + 2);
  assert.equal((await recordReductionOutcome(host, reviewed)).replayed, true); assert.equal((await recordReductionOutcome(host, inputs[1 - loser])).replayed, true); assert.equal(await historyEvents(pmRoot), before + 2);
});
test('competing create at each creation boundary verifies matching native ownership and keeps one history event', async t => {
  for (const step of ['before_create', 'after_create', 'before_receipt']) {
    const { host, pmRoot, birth } = await fixture(t, false); let interleaved = false;
    host.boundary = async boundary => { if (boundary === step && !interleaved) { interleaved = true; await createReduction(createDirectoryHost(pmRoot, 'competitor'), birth); } };
    const receipt = await createReduction(host, birth); assert.equal(receipt.replayed, step === 'before_create'); assert.equal(interleaved, true); assert.equal(await historyEvents(pmRoot), 1);
  }
});
