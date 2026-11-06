/** Behavioral safeguard removals run only in disposable emitted-code copies. */
import { mkdtempSync, cpSync, symlinkSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { npmEnvironment, testEnvironment } from '../scripts/environment.ts';
const changes = [
  { name: 'complete witness content binding removed', file: 'kernel', pattern: /witness_digest: digest\(\{ certificate: content, owner_identity: state.replay_receipts\[0\].result.identity, algorithm_version: state.algorithm_version, definition: state.definition, requests: state.requests, observations: state.observations \}\)/, replacement: 'witness_digest: digest(content)', test: 'kernel', filter: 'certificate digest binds full' },
  { name: 'native CAS removed', file: 'api', pattern: /const guarded = await host\.client\.withExpectedItemRevisions\(\[\{ id: snapshot.id, itemHash: snapshot.revision \}\], \(\) => host\.client\.update\(snapshot.id, (\{[^\n]+\})\)\);/, replacement: 'const guarded = { result: await host.client.update(snapshot.id, $1), checked: [snapshot.id], unchecked: [] };', test: 'concurrency', filter: 'a competing native write' },
  { name: 'durable replay removed', file: 'api', pattern: /const found = state.replay_receipts.find\(row => row.operation_id === op\);/, replacement: 'const found = undefined;', test: 'api', filter: 'native no-git round trips' },
  { name: 'caller revision check removed', file: 'api', pattern: /snapshot.revision === input.revision/, replacement: 'true', test: 'api', filter: 'typed guards and output budget' },
  { name: 'oracle signature check removed', file: 'kernel', pattern: /outcome.actual_signature === oracle.target_failure_signature/, replacement: 'true', test: 'kernel', filter: 'subset identity preserves' },
  { name: 'missing deletions incorrectly certified', file: 'kernel', pattern: /missing.length === 0 && failing.length > 0/, replacement: 'failing.length > 0', test: 'kernel', filter: 'baseline, unresolved' },
  { name: 'SDK privacy scanner removed', file: 'schema', pattern: /scanMutationSecrets\(value\).length === 0/, replacement: 'true', test: 'privacy', filter: 'strict privacy' },
  { name: 'write budget admission removed', file: 'api', pattern: /finish\(host, receiptData\(snapshot.id, 'f'.repeat\(64\), operation, false\), input.budget\);/, replacement: '', test: 'api', filter: 'typed guards and output budget' },
  { name: 'fatal UTF-8 decoding removed', file: 'commands', pattern: /fatal: true/, replacement: 'fatal: false', test: 'contracts', filter: 'structured input rejects' },
];
for (const change of changes) {
  const root = mkdtempSync(join(tmpdir(), 'reduce-revert-'));
  try {
    for (const file of ['dist', 'test', 'scripts', 'docs', '.github', 'package.json', 'manifest.json']) cpSync(file, join(root, file), { recursive: true }); symlinkSync(join(process.cwd(), 'node_modules'), join(root, 'node_modules'), 'dir');
    const file = join(root, `dist/src/${change.file}.js`); const source = readFileSync(file, 'utf8'); assert.match(source, change.pattern, `Mutation did not match ${change.name}`); writeFileSync(file, source.replace(change.pattern, change.replacement));
    const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', `--test-name-pattern=${change.filter}`, `test/${change.test}.test.ts`], { cwd: root, env: testEnvironment(npmEnvironment(process.env)), encoding: 'utf8', timeout: 120000 });
    assert.notEqual(result.status, 0, `Safeguard removal incorrectly passed: ${change.name}`); assert.match(result.stdout + result.stderr, /AssertionError|Missing expected rejection|Missing expected exception|ReductionRefusal:/); console.log(`EXPECTED FAIL: ${change.name}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const restored = spawnSync(process.execPath, ['--test', '--test-concurrency=2', 'test/api.test.ts', 'test/kernel.test.ts', 'test/privacy.test.ts'], { env: testEnvironment(npmEnvironment(process.env)), encoding: 'utf8', timeout: 180000 });
assert.equal(restored.status, 0, restored.stdout + restored.stderr); const count = restored.stdout.match(/tests (\d+)/); assert.ok(count && Number(count[1]) > 0); console.log(`revert-gate: ${changes.length} behavioral failures; ${count[1]} fixed tests pass`);
