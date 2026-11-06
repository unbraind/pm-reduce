import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.ts';
import { scenarios, reproduce, atomsFor, historicalOracle, sourceForScenario } from './corpus.ts';
for (const name of scenarios) test(`public historical reproduction: ${name}`, async t => {
  const { host } = await fixture(t, false); const receipt = await reproduce(host, 'corpus-repro', name); assert.ok(receipt.final_atoms <= 8); assert.equal(receipt.resumes, 5); assert.equal(receipt.resume_questions, 10); assert.ok(receipt.packet_estimated_tokens <= 1600);
  assert.equal(historicalOracle(name, atomsFor(name)), true); assert.equal(historicalOracle(name, []), false);
});

test('scenario provenance follows filenames through reorder and rejects missing sources', () => {
  const sources = [{ file: 'repair.ts', identity: 'beads' }, { file: 'exemplar-retrieval.ts', identity: 'jev' }];
  for (const rows of [sources, [...sources].reverse()]) for (const name of scenarios) assert.equal(sourceForScenario(rows, name).identity, name === 'beads-precision' ? 'beads' : 'jev');
  assert.throws(() => sourceForScenario([], 'beads-precision'), /Scenario source file must have provenance/);
});
