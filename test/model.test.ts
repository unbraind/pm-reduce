import test from 'node:test';
import assert from 'node:assert/strict';
import { readReduction, nextReductionTrial, createReduction, recordReductionOutcome, requestReductionTrial, digest } from '../dist/index.js';
import type { RecordOutcomeInput, RequestTrialInput, ReductionDefinition } from '../dist/index.js';
import { fixture, definition, outcome, hasCode, historyEvents } from './helpers.ts';

test('500 seeded random operation sequences agree with an independent journal model and SDK read-back', async t => {
  const { host, native, pmRoot } = await fixture(t, false); let seed = 28067;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const owners: { id: string; def: ReductionDefinition; related: string; requests: {id: string; digest: string}[]; observations: {request: string; result: string; reason: string}[]; old: (RecordOutcomeInput | RequestTrialInput)[]; histories: number }[] = [];
  for (let at = 0; at < 4; at++) {
    const id = `corpus-model-${at}`; const related = (await native.create({ id: `corpus-investigation-${at}`, title: 'Investigation', type: 'Task' })).item.id;
    const def = definition(4); def.atoms[0].label = `  whitespace\n\t${at}  `; await createReduction(host, { id, op: 'birth', title: 'Modeled owner', definition: def, related: [related] });
    owners.push({ id, def, related, requests: [] as { id: string; digest: string }[], observations: [] as { request: string; result: string; reason: string }[], old: [] as (RecordOutcomeInput | RequestTrialInput)[], histories: await historyEvents(pmRoot, id) });
  }
  for (let sequence = 0; sequence < 500; sequence++) {
    const model = owners[random() % owners.length]; const original = await readReduction(host, model.id);
    for (let operation = 0; operation < 3 + random() % 3; operation++) {
      const choice = random() % 5;
      if (choice === 0 && model.old.length > 0) {
        const prior = model.old[random() % model.old.length]; const replayed = 'proposal' in prior ? await requestReductionTrial(host, prior) : await recordReductionOutcome(host, prior); assert.equal(replayed.replayed, true);
      } else if (choice === 1) {
        const next = await nextReductionTrial(host, { id: model.id }); await assert.rejects(requestReductionTrial(host, { id: model.id, op: `stale-${sequence}-${operation}`, revision: digest('stale'), proposal: next.proposal_digest ?? digest('none') }), hasCode('revision_conflict'));
      } else if (choice === 2) {
        const current = await readReduction(host, model.id); const pending = current.state.requests.find(row => row.state === 'pending');
        if (pending) {
          const reason = `  reported ${sequence}\n\t `; const observed = pending.subset_ids.includes('a2') ? 'target_fail' as const : 'pass' as const;
          const input = { id: model.id, op: `observe-${sequence}-${operation}`, revision: current.revision, request: pending.request_id, outcome: outcome(model.def, pending.subset_digest, observed, { reason }) }; await recordReductionOutcome(host, input);
          model.old.push(input); model.observations.push({ request: pending.request_id, result: observed, reason }); model.histories++;
        } else {
          const next = await nextReductionTrial(host, { id: model.id });
          if (next.candidate) { const input = { id: model.id, op: `reserve-${sequence}-${operation}`, revision: next.revision, proposal: next.proposal_digest! }; const result = await requestReductionTrial(host, input); model.old.push(input); model.requests.push({ id: result.result.identity, digest: next.candidate.subset_digest }); model.histories++; }
        }
      } else { const current = await readReduction(host, model.id); assert.equal(current.state.replay_receipts.length, 1 + model.old.length); }
    }
    const snapshot = await readReduction(host, model.id); assert.deepEqual(snapshot.state.definition, model.def);
    assert.deepEqual(snapshot.state.requests.map(row => ({ id: row.request_id, digest: row.subset_digest })), model.requests);
    assert.deepEqual(snapshot.state.observations.map(row => ({ request: row.request_id, result: row.result, reason: row.reason })), model.observations); assert.equal(await historyEvents(pmRoot, model.id), model.histories);
    const got = await native.get(model.id, { outputInclude: 'full', outputBudget: 'unbounded' }); assert.ok('item' in got); assert.ok(got.item.dependencies?.some(row => row.id === model.related));
    assert.ok(original.state.version === snapshot.state.version);
  }
});
