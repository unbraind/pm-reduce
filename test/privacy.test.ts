import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { createReduction, readReduction, digest, canonical } from '../dist/index.js';
import { guardSubmitted, parse, DefinitionSchema } from '../dist/src/schema.js';
import { fixture, definition, hasCode, historyEvents } from './helpers.ts';

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

test('privacy traversal bounds shared graphs while preserving ordinary shared values', () => {
  const child = { text: 'public' }; guardSubmitted({ first: child, second: child });
  let graph: unknown = 0; for (let index = 0; index < 16; index++) graph = [graph, graph];
  assert.throws(() => guardSubmitted(graph), error => hasCode('invalid_input')(error) && error instanceof Error && error.message === 'Input traversal exceeds the work limit', 'proof:traversal_budget');
});
