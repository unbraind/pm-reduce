import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('documented archive installs stop before installation when packing fails or yields no archive', t => {
  const readme = readFileSync('README.md', 'utf8').replaceAll('\r\n', '\n');
  const blocks = [...readme.matchAll(/^```sh\n([\s\S]*?)^```$/gm)]
    .map(match => match[1])
    .filter(block => /^[ \t]*(?:tarball=|(?:npm install|bun add) "\$archive")/m.test(block));
  assert.ok(blocks.length > 0, 'The README must document an archive installation');
  const source = mkdtempSync(join(tmpdir(), 'readme-pack-'));
  t.after(() => rmSync(source, { recursive: true, force: true }));
  writeFileSync(join(source, 'package.tgz'), 'synthetic archive');

  const stubs = String.raw`
pack_result=$1
npm() {
  case "$1" in
    ci) return 0 ;;
    pack)
      printf 'pack\n' >&2
      case "$pack_result" in
        failed) printf '%s\n' package.tgz; return 33 ;;
        empty) return 0 ;;
        missing) printf '%s\n' missing.tgz; return 0 ;;
      esac
      ;;
    *) printf 'npm %s\n' "$1" >&2; return 90 ;;
  esac
}
bun() { printf 'bun %s\n' "$1" >&2; return 90; }
npx() { printf 'npx\n' >&2; return 90; }
bunx() { printf 'bunx\n' >&2; return 90; }
mkdir() { printf 'mkdir\n' >&2; return 90; }
mktemp() { printf 'mktemp\n' >&2; return 90; }
`;
  for (const block of blocks) {
    assert.match(block.trim(), /^\(\n[\s\S]*\n\)$/, 'The archive install must run in a subshell');
    for (const packResult of ['failed', 'empty', 'missing']) {
      const result = spawnSync('sh', ['-c', `${stubs}\n${block}\nprintf 'shell continued: %s\\n' "$?"`, 'readme-pack', packResult], {
        cwd: source,
        encoding: 'utf8',
      });
      assert.ifError(result.error);
      assert.equal(result.stderr, 'pack\n', `${packResult}: only packing should run\n${block}`);
      assert.equal(result.status, 0, `${packResult}: the calling shell must continue`);
      assert.equal(result.stdout, 'shell continued: 1\n', `${packResult}: the snippet must return a failure`);
    }
  }
});
