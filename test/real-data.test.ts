import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.ts';
import { scenarios, reproduce, atomsFor, historicalOracle, sourceForScenario, oracleRecipeDigest, materialize } from './corpus.ts';
import { readFileSync } from 'node:fs';
import { digest } from '../dist/index.js';
for (const name of scenarios) test(`public historical reproduction: ${name}`, async t => {
  const { host } = await fixture(t, false); const receipt = await reproduce(host, 'corpus-repro', name); assert.ok(receipt.final_atoms <= 8); assert.equal(receipt.resumes, 5); assert.equal(receipt.resume_questions, 10); assert.ok(receipt.packet_estimated_tokens <= 1600);
  assert.equal(historicalOracle(name, atomsFor(name)), true); assert.equal(historicalOracle(name, []), false);
  const provenance = JSON.parse(readFileSync('test/fixtures/provenance.json', 'utf8')) as { fixture_sha256: string; sources: { file: string; source_sha256: string }[] };
  assert.equal(receipt.reduction_snapshot.definition.oracle.recipe_digest, oracleRecipeDigest(sourceForScenario(provenance.sources, name).source_sha256, provenance.fixture_sha256), 'proof:recipe_integration');
});

test('recipe identities cover complete fixture code independently of the historical source hash', () => {
  const source = digest('historical source'); const fixture = digest('fixture module'); const original = oracleRecipeDigest(source, fixture);
  assert.equal(original, digest({ harness: historicalOracle.toString(), materialize: materialize.toString(), historical_source: source, fixture_sha256: fixture }), 'proof:recipe_closure');
  for (let index = 0; index < 32; index++) {
    assert.notEqual(oracleRecipeDigest(source, digest(`changed helper or constant ${index}`)), original, 'proof:recipe_closure');
    assert.notEqual(oracleRecipeDigest(digest(`changed source ${index}`), fixture), original, 'proof:recipe_closure');
  }
  assert.equal(oracleRecipeDigest(source, fixture), original);
  for (const missing of [undefined, '', 'invalid', '0'.repeat(63)]) assert.throws(() => oracleRecipeDigest(source, missing), /proof:recipe_fixture_required/, 'proof:recipe_validation');
});

test('scenario provenance follows filenames through reorder and rejects missing sources', () => {
  const sources = [{ file: 'repair.ts', identity: 'beads' }, { file: 'exemplar-retrieval.ts', identity: 'jev' }];
  for (const rows of [sources, [...sources].reverse()]) for (const name of scenarios) assert.equal(sourceForScenario(rows, name).identity, name === 'beads-precision' ? 'beads' : 'jev');
  assert.throws(() => sourceForScenario([], 'beads-precision'), /Scenario source file must have provenance/);
});
