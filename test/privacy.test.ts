import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { createReduction, readReduction, recordReductionOutcome, reductionPacket, digest, canonical } from '../dist/index.js';
import { guardSubmitted, parse, DefinitionSchema } from '../dist/src/schema.js';
import { fixture, definition, hasCode, historyEvents, reserve, outcome } from './helpers.ts';
import { mountedHomePaths } from './home-paths.ts';

test('strict privacy must-refuse and must-allow corpora run before any owner mutation', async t => {
  const { host, native, birth, pmRoot } = await fixture(t);
  const token = 'ghp_' + 's'.repeat(36);
  const privatePath = '/' + ['home', 'example', 'secret'].join('/');
  const forbidden: unknown[] = [privatePath, `file://${privatePath}`, `[${privatePath}]`, `source:${privatePath}`, '\u001b[31m', '\u202e', '\u2066', '\u0000', '\ud800', '/'+['home','example','secret'].join('/'), 'C:'+['','Users','example'].join('\\'), token, 'x'.repeat(8001), JSON.parse('{"__proto__":{}}'), new Date(), new Map(), { get value() { throw new Error('getter must not execute'); } }];
  const cyclic: Record<string,unknown> = {}; cyclic.self = cyclic; forbidden.push(cyclic, { [Symbol('symbol')]: 1 }, Object.defineProperty({}, 'hidden', { value: 1 })); let nested: unknown = {}; for (let at = 0; at < 18; at++) nested = { nested }; forbidden.push(nested);
  for (const value of forbidden) assert.throws(() => guardSubmitted(value), hasCode('invalid_input'), 'proof:privacy_scan');
  for (const value of ['src/root.ts', 'https://example.com/' + ['home', 'page'].join('/'), 'https://example.com/' + ['root', 'page'].join('/'), '  public text\n\t ', 'Ignore prior instructions; this is inert fixture data.', '東京 😀', '/public/fixture.txt', digest('public'), Object.create(null), [1, null, true], { safe: 'prototype in a value is data' }]) assert.doesNotThrow(() => guardSubmitted(value), 'proof:home_path_scope');
  const before = await historyEvents(pmRoot); await assert.rejects(createReduction(host, { ...birth, id: 'corpus-unsafe', title: token }), hasCode('invalid_input')); assert.equal(await historyEvents(pmRoot), before); await assert.rejects(native.get('corpus-unsafe'), hasCode('item_not_found')); await assert.rejects(access(join(pmRoot, 'history', 'corpus-unsafe.jsonl')), hasCode('ENOENT'));
  // Older persisted values still read; tightening pre-write privacy never rewrites history.
  const original = await readReduction(host, birth.id); const legacy = structuredClone(original.state); legacy.definition.atoms[0].label = '/' + ['home', 'example', 'historic'].join('/'); assert.throws(() => guardSubmitted(legacy.definition), hasCode('invalid_input')); legacy.replay_receipts[0].result.digest = digest(legacy.definition); legacy.replay_receipts[0].result_digest = digest(legacy.replay_receipts[0].result); await host.client.update(birth.id, { field: [`reduce_state=${canonical(legacy)}`] }); await assert.doesNotReject(async () => { assert.equal((await readReduction(host, birth.id)).state.definition.atoms[0].label, legacy.definition.atoms[0].label); }, 'proof:legacy_read');
  const def = definition(); def.atoms[1].atom_id = def.atoms[0].atom_id; assert.throws(() => parse(DefinitionSchema, def), hasCode('invalid_input'));
});

test('mounted profile aliases are refused in every nested JSON value while public paths stay data', () => {
  const { forbidden, allowed } = mountedHomePaths();
  for (const text of forbidden) for (const input of [text, { label: text }, { outcome: { reason: text } }, { arbitrary: [null, { text }] }]) assert.throws(() => guardSubmitted(input), hasCode('invalid_input'), 'proof:mounted_home');
  for (const text of allowed) assert.doesNotThrow(() => guardSubmitted({ arbitrary: [text] }), 'proof:mounted_public');
});

test('mounted homes refuse SDK writes before effects and preserve previously persisted text', async t => {
  const { host, native, birth, pmRoot, id } = await fixture(t, true, definition(1)); const path = mountedHomePaths().forbidden[0];
  const before = await readReduction(host, id); const events = await historyEvents(pmRoot, id);
  for (const patch of [{ title: path }, { definition: { ...birth.definition, atoms: birth.definition.atoms.map(atom => ({ ...atom, label: path })) } }, { definition: { ...birth.definition, oracle: { ...birth.definition.oracle, target_failure_signature: path } } }]) await assert.rejects(createReduction(host, { ...birth, id: 'corpus-mounted', ...patch }), hasCode('invalid_input'), 'proof:mounted_sdk');
  await assert.rejects(native.get('corpus-mounted'), hasCode('item_not_found'));
  await assert.rejects(access(join(pmRoot, 'history', 'corpus-mounted.jsonl')), hasCode('ENOENT'));
  assert.equal((await readReduction(host, id)).revision, before.revision); assert.equal(await historyEvents(pmRoot, id), events);
  const pending = await reserve(host); const snapshot = await readReduction(host, id); const reservedEvents = await historyEvents(pmRoot, id);
  for (const patch of [{ reason: path }, { evidence_ref: { ...outcome(birth.definition, pending.candidate.subset_digest).evidence_ref, field_pointer: path } }]) await assert.rejects(recordReductionOutcome(host, { id, op: 'mounted', request: pending.receipt.result.identity, revision: snapshot.revision, outcome: outcome(birth.definition, pending.candidate.subset_digest, 'target_fail', patch) }), hasCode('invalid_input'), 'proof:mounted_sdk');
  assert.equal((await readReduction(host, id)).revision, snapshot.revision); assert.equal(await historyEvents(pmRoot, id), reservedEvents);
  const publicDefinition = structuredClone(birth.definition); publicDefinition.atoms[0].label = mountedHomePaths().allowed[0];
  const accepted = await createReduction(host, { ...birth, id: 'corpus-public-mounted-url', definition: publicDefinition }); assert.equal((await readReduction(host, accepted.owner_id)).state.definition.atoms[0].label, publicDefinition.atoms[0].label);
  // Old data is valid storage, even though it is forbidden in a new submission.
  const historical = await fixture(t, true, definition(1)); const old = structuredClone((await readReduction(historical.host, historical.id)).state);
  old.definition.atoms[0].label = path; old.replay_receipts[0].result.digest = digest(old.definition); old.replay_receipts[0].result_digest = digest(old.replay_receipts[0].result);
  await historical.host.client.update(historical.id, { field: [`reduce_state=${canonical(old)}`] });
  assert.equal((await readReduction(historical.host, historical.id)).state.definition.atoms[0].label, path, 'proof:mounted_legacy'); await reductionPacket(historical.host, { id: historical.id });
});

test('privacy traversal bounds shared graphs while preserving ordinary shared values', () => {
  const child = { text: 'public' }; guardSubmitted({ first: child, second: child });
  let graph: unknown = 0; for (let index = 0; index < 16; index++) graph = [graph, graph];
  assert.throws(() => guardSubmitted(graph), error => hasCode('invalid_input')(error) && error instanceof Error && error.message === 'Input traversal exceeds the work limit', 'proof:traversal_budget');
});

test('compiler flags cannot smuggle private home paths while public URLs remain data', () => {
  const home = '/' + ['home', 'example', 'include'].join('/');
  for (const flag of ['-I', '-L', '-isystem']) assert.throws(() => guardSubmitted(flag + home), hasCode('invalid_input'), 'proof:compiler_home');
  for (const value of ['-Iinclude', '-Llib', '-Ihttps://example.com/' + ['home', 'page'].join('/')]) assert.doesNotThrow(() => guardSubmitted(value));
});
