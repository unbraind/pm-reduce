import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { createReduction, readReduction, recordReductionOutcome, reductionPacket, digest, canonical } from '../dist/index.js';
import { guardSubmitted, parse, DefinitionSchema } from '../dist/src/schema.js';
import { fixture, definition, hasCode, historyEvents, reserve, outcome } from './helpers.ts';
import { mountedHomePaths, homeProbePaths, publicRootPaths } from './home-paths.ts';
import { containsPrivateHomePath } from '../dist/src/privacy.js';
import { regexWork, linearPattern } from './privacy-tools.ts';

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
  for (const text of forbidden) { assert.equal(containsPrivateHomePath(text), true, 'proof:path_aliases'); for (const input of [text, { label: text }, { outcome: { reason: text } }, { arbitrary: [null, { text }] }]) assert.throws(() => guardSubmitted(input), hasCode('invalid_input'), 'proof:mounted_home'); }
  for (const text of allowed) assert.doesNotThrow(() => guardSubmitted({ arbitrary: [text] }), 'proof:mounted_public');
});

test('root-named public directories retain their Windows drive or network share scope', () => {
  for (const path of publicRootPaths()) assert.equal(containsPrivateHomePath(path), false, 'proof:public_root_scope');
});

test('home classification has a linear work budget for overlapping flags and preserves long flags', () => {
  for (const size of [64, 512, 2600]) for (const input of ['-a' + '--a'.repeat(size), ':'.repeat(size), ('public ').repeat(size)]) {
    const work = regexWork(() => { for (let attempt = 0; attempt < 20; attempt++) assert.equal(containsPrivateHomePath(input), false); });
    assert.ok(work <= 20 * 64 * (input.length + 1), 'proof:path_complexity');
  }
  const corpus = mountedHomePaths();
  for (const input of [...corpus.forbidden, ...corpus.allowed, ...publicRootPaths()]) assert.ok(regexWork(() => { containsPrivateHomePath(input); }) <= 64 * (input.length + 1), 'proof:path_complexity');
  const hostile = '-a' + '--a'.repeat(2600);
  const path = mountedHomePaths().forbidden[0]; assert.equal(containsPrivateHomePath(hostile + path), true, 'proof:long_flag');
});

test('deterministic work guard rejects overlapping regex starts and nested repetition independently of CPU readings', () => {
  for (const source of ['(?:^|[^a])(?:-[a-z][a-z0-9_-]*)?/private', '^(a+)+$', '^a*a*$', '^(a+){1,2}$', '^([^.]+.){1,2}$', '^a|a*$', '^a{1,}$', '^a\\1']) assert.equal(linearPattern(source), false, 'proof:linear_grammar');
  for (const source of ['[a-z]+', '\\/+', '^a+$', '^(?:[^/]+\\/){1,2}users']) assert.equal(linearPattern(source), true);
  const execute = RegExp.prototype.exec;
  assert.throws(() => regexWork(() => /(?:^|[^a])(?:-[a-z][a-z0-9_-]*)?\/private/u.test('-a--a')), /proof:path_complexity/, 'proof:linear_guard');
  assert.throws(() => regexWork(() => /^[\s\S]*a/m.test('z\nz')), /proof:path_complexity/, 'proof:linear_guard');
  assert.equal(RegExp.prototype.exec, execute);
  const original = process.cpuUsage;
  process.cpuUsage = () => { assert.fail('proof:deterministic_work'); };
  try { assert.ok(regexWork(() => containsPrivateHomePath('-a--a')) > 0, 'proof:regex_count'); } finally { process.cpuUsage = original; }
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

test('delimited root and resolved home aliases refuse SDK mutations while old records remain readable', async t => {
  const { host, id, birth, pmRoot, native } = await fixture(t, true, definition(1)); const pending = await reserve(host);
  const before = await readReduction(host, id); const events = await historyEvents(pmRoot, id);
  for (const path of homeProbePaths()) {
    await assert.rejects(createReduction(host, { ...birth, id: 'corpus-resolved-private', title: path }), hasCode('invalid_input'), 'proof:home_sdk_boundaries');
    await assert.rejects(recordReductionOutcome(host, { id, op: 'resolved-private', request: pending.receipt.result.identity, revision: before.revision, outcome: outcome(birth.definition, pending.candidate.subset_digest, 'target_fail', { reason: path }) }), hasCode('invalid_input'), 'proof:home_sdk_boundaries');
    assert.equal((await readReduction(host, id)).revision, before.revision); assert.equal(await historyEvents(pmRoot, id), events);
  }
  await assert.rejects(native.get('corpus-resolved-private'), hasCode('item_not_found'));
  const historical = await fixture(t, true, definition(1)); const legacy = structuredClone((await readReduction(historical.host, historical.id)).state); legacy.definition.atoms[0].label = homeProbePaths()[1];
  legacy.replay_receipts[0].result.digest = digest(legacy.definition); legacy.replay_receipts[0].result_digest = digest(legacy.replay_receipts[0].result);
  await historical.host.client.update(historical.id, { field: [`reduce_state=${canonical(legacy)}`] });
  assert.equal((await readReduction(historical.host, historical.id)).state.definition.atoms[0].label, legacy.definition.atoms[0].label); await reductionPacket(historical.host, { id: historical.id });
});

test('privacy traversal bounds shared graphs while preserving ordinary shared values', () => {
  const child = { text: 'public' }; guardSubmitted({ first: child, second: child });
  let graph: unknown = 0; for (let index = 0; index < 16; index++) graph = [graph, graph];
  assert.throws(() => guardSubmitted(graph), error => hasCode('invalid_input')(error) && error instanceof Error && error.message === 'Input traversal exceeds the work limit', 'proof:traversal_budget');
});

test('privacy scans bound repeated string references by distinct content', () => {
  /** Deterministic regex-execution counter: repeated references must never multiply content scans. */
  const scanExecutions = (action: () => void): number => {
    const native = RegExp.prototype.exec; let count = 0;
    RegExp.prototype.exec = function (this: RegExp, input: string): RegExpExecArray | null { count++; return native.call(this, input); };
    try { action(); } finally { RegExp.prototype.exec = native; }
    return count;
  };
  const shared = 'public fixture text '.repeat(400);
  const single = scanExecutions(() => guardSubmitted({ label: shared }));
  for (const references of [2, 64, 2048]) {
    const repeated = scanExecutions(() => guardSubmitted({ rows: Array(references).fill(shared), nested: [[shared], { deep: shared }] }));
    assert.ok(repeated <= single * 2 + 16, `proof:string_scan_budget (${references} references)`);
  }
  const distinct = Array.from({ length: 8 }, (_, index) => `distinct public text ${index} `.repeat(40));
  const scanned = scanExecutions(() => guardSubmitted({ rows: distinct }));
  assert.ok(scanned > single && scanned <= single * 8 + 16, 'proof:string_scan_budget (distinct content)');
  guardSubmitted({ first: { text: shared }, second: { text: shared }, third: shared });
  const privatePath = '/' + ['home', 'example', 'secret'].join('/');
  for (const input of [Array(64).fill(privatePath), { safe: Array(64).fill('public'), evil: privatePath }]) assert.throws(() => guardSubmitted(input), hasCode('invalid_input'), 'proof:string_scan_refusal');
});

test('SDK admission bounds repeated string references before any owner mutation', async t => {
  const { host, native, birth, pmRoot } = await fixture(t, true, definition(1));
  const filler = 'public fixture text '.repeat(64); const before = await historyEvents(pmRoot, birth.id);
  const hostile = { ...birth, id: 'corpus-repeated', repeated: Array(4096).fill(filler) };
  await assert.rejects(createReduction(host, hostile as unknown as Parameters<typeof createReduction>[1]), hasCode('invalid_input'), 'proof:string_scan_sdk');
  await assert.rejects(native.get('corpus-repeated'), hasCode('item_not_found'));
  assert.equal(await historyEvents(pmRoot, birth.id), before);
});

test('compiler flags cannot smuggle private home paths while public URLs remain data', () => {
  const home = '/' + ['home', 'example', 'include'].join('/');
  for (const flag of ['-I', '-L', '-isystem']) assert.throws(() => guardSubmitted(flag + home), hasCode('invalid_input'), 'proof:compiler_home');
  for (const value of ['-Iinclude', '-Llib', '-Ihttps://example.com/' + ['home', 'page'].join('/')]) assert.doesNotThrow(() => guardSubmitted(value));
});
