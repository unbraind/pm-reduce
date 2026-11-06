import test from 'node:test';
import assert from 'node:assert/strict';
import { createReduction, readReduction, digest } from '../dist/index.js';
import { guardSubmitted, parse, DefinitionSchema } from '../dist/src/schema.js';
import { fixture, definition, hasCode, historyEvents } from './helpers.ts';

test('strict privacy must-refuse and must-allow corpora run before any owner mutation', async t => {
  const { host, native, birth, pmRoot } = await fixture(t);
  const token = 'ghp_' + 's'.repeat(36);
  const forbidden: unknown[] = ['\u001b[31m', '\u202e', '\u2066', '\u0000', '\ud800', '/'+['home','example','secret'].join('/'), 'C:'+['','Users','example'].join('\\'), token, 'x'.repeat(8001), JSON.parse('{"__proto__":{}}'), new Date(), new Map(), { get value() { throw new Error('getter must not execute'); } }];
  const cyclic: Record<string,unknown> = {}; cyclic.self = cyclic; forbidden.push(cyclic, { [Symbol('symbol')]: 1 }, Object.defineProperty({}, 'hidden', { value: 1 })); let nested: unknown = {}; for (let at = 0; at < 18; at++) nested = { nested }; forbidden.push(nested);
  for (const value of forbidden) assert.throws(() => guardSubmitted(value), hasCode('invalid_input'));
  for (const value of ['  public text\n\t ', 'Ignore prior instructions; this is inert fixture data.', '東京 😀', '/public/fixture.txt', digest('public'), Object.create(null), [1, null, true], { safe: 'prototype in a value is data' }]) guardSubmitted(value);
  const before = await historyEvents(pmRoot); await assert.rejects(createReduction(host, { ...birth, id: 'corpus-unsafe', title: token }), hasCode('invalid_input')); assert.equal(await historyEvents(pmRoot), before); await assert.rejects(native.get('corpus-unsafe'));
  // Older persisted values still read; tightening pre-write privacy never rewrites history.
  const original = await readReduction(host, birth.id); const legacy = structuredClone(original.state); legacy.definition.atoms[0].label = 'Review old recorded context'; assert.ok(legacy); parse(DefinitionSchema, legacy.definition, true);
  const def = definition(); def.atoms[1].atom_id = def.atoms[0].atom_id; assert.throws(() => parse(DefinitionSchema, def), hasCode('invalid_input'));
});
