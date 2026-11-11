import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeToon } from '@unbrained/pm-cli/sdk/testing';
import { canonical, digest, DefinitionSchema } from '../dist/index.js';
import { MAX_TRIALS } from '../dist/src/schema.js';
import { definition } from './helpers.ts';

test('documented request limits match schema admission in both public guides', () => {
  for (const file of ['README.md', 'ARCHITECTURE.md']) {
    const limit = readFileSync(file, 'utf8').match(/(\d+) requests/);
    assert.equal(Number(limit?.[1]), MAX_TRIALS, 'proof:request_limit_docs');
  }
  assert.ok(DefinitionSchema.safeParse({ ...definition(), max_trials: MAX_TRIALS }).success);
  assert.ok(!DefinitionSchema.safeParse({ ...definition(), max_trials: MAX_TRIALS + 1 }).success);
});

test('documented canonical and digest semantics distinguish JSON from SHA-256', () => {
  const text = readFileSync('README.md', 'utf8');
  assert.ok(text.includes('`canonical` returns canonical JSON; `digest` hashes that JSON with SHA-256.'), 'proof:canonical_docs');
  const input = { z: [' z ', 'a'], a: 1 };
  assert.equal(canonical(input), '{"a":1,"z":[" z ","a"]}');
  assert.deepEqual(JSON.parse(canonical(input)), input); assert.match(digest(input), /^[a-f0-9]{64}$/);
});

test('linked release tests build before directly importing emitted modules', () => {
  const item = decodeToon(readFileSync('.agents/pm/epics/reduce-release.toon', 'utf8')) as { tests: { command: string }[] };
  const direct = item.tests.filter(row => row.command.includes('node --test'));
  assert.ok(direct.length >= 2);
  for (const { command } of direct) assert.ok(/(?:npm|bun) run build &&/.test(command.split('node --test')[0]), 'proof:linked_test_build');
});

test('historical UTF-8 budget disagreement is explicitly documented', () => {
  const text = readFileSync('test/corpus.ts', 'utf8');
  assert.ok(/jev-utf8-budget, UTF-8 bytes deliberately disagree with exemplarContext's\s+\* UTF-16 string.length budget/.test(text), 'proof:utf8_intent_docs');
});
