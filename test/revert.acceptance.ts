/** Behavioral safeguard removals run only in disposable emitted-code copies. */
import { mkdtempSync, cpSync, symlinkSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { assertIntendedFailure } from './revert-tools.ts';
import { npmEnvironment, testEnvironment } from '../scripts/environment.ts';
const changes = [
  { name: 'complete witness content binding removed', file: 'kernel', pattern: /witness_digest: digest\(\{ certificate: content, owner_identity: state.replay_receipts\[0\].result.identity, algorithm_version: state.algorithm_version, definition: state.definition, requests: state.requests, observations: state.observations \}\)/, replacement: 'witness_digest: digest(content)', test: 'kernel', filter: 'certificate digest binds full', proof: 'proof:witness_binding' },
  { name: 'native CAS removed', file: 'api', pattern: /const guarded = await host\.client\.withExpectedItemRevisions\(\[\{ id: snapshot.id, itemHash: snapshot.revision \}\], \(\) => host\.client\.update\(snapshot.id, (\{[^\n]+\})\)\);/, replacement: 'const guarded = { result: await host.client.update(snapshot.id, $1), checked: [snapshot.id], unchecked: [] };', test: 'concurrency', filter: 'a competing native write', proof: 'proof:native_cas' },
  { name: 'durable replay removed', file: 'api', pattern: /const found = state.replay_receipts.find\(row => row.operation_id === op\);/, replacement: 'const found = undefined;', test: 'api', filter: 'native no-git round trips', proof: 'proof:durable_replay' },
  { name: 'caller revision check removed', file: 'api', pattern: /snapshot.revision === input.revision/, replacement: 'true', test: 'api', filter: 'typed guards and output budget', proof: 'proof:caller_revision' },
  { name: 'oracle signature check removed', file: 'kernel', pattern: /outcome.actual_signature === oracle.target_failure_signature/, replacement: 'true', test: 'kernel', filter: 'subset identity preserves', proof: 'proof:oracle_signature' },
  { name: 'missing deletions incorrectly certified', file: 'kernel', pattern: /missing.length === 0 && failing.length > 0/, replacement: 'failing.length > 0', test: 'kernel', filter: 'baseline, unresolved', proof: 'proof:deletion_obligations' },
  { name: 'SDK privacy scanner removed', file: 'schema', pattern: /scanMutationSecrets\(value\).length === 0/, replacement: 'true', test: 'privacy', filter: 'strict privacy', proof: 'proof:privacy_scan' },
  { name: 'write budget admission removed', file: 'api', pattern: /finish\(host, receiptData\(snapshot.id, 'f'.repeat\(64\), operation, false\), input.budget\);/, replacement: '', test: 'api', filter: 'typed guards and output budget', proof: 'proof:write_budget' },
  { name: 'fatal UTF-8 decoding removed', file: 'commands', pattern: /fatal: true/, replacement: 'fatal: false', test: 'contracts', filter: 'structured input rejects', proof: 'proof:fatal_utf8' },
  { name: 'creation identity policy removed', file: 'api', pattern: /insist\(host.normalizeId !== undefined \|\| host.idPrefix !== undefined,[^\n]+\);/, replacement: '', test: 'contracts', filter: 'creation identity policy', proof: 'proof:identity_policy' },
  { name: 'refusal fitter fallback removed', file: 'commands', pattern: /catch \{\s+return refusalEnvelope\(new ReductionRefusal\('outcome_unknown', 'Host refusal fitting failed',[^\n]+\);\s+\}/, replacement: 'catch (error) { throw error; }', test: 'contracts', filter: 'creation identity policy', proof: 'proof:fitter_fallback' },
  { name: 'native exit preservation removed', file: 'errors', pattern: /if \(nativeExit !== undefined\)\s+return nativeExit;/, replacement: '', test: 'contracts', filter: 'creation identity policy', proof: 'proof:native_exit' },
  { name: 'adapter JSON error translation removed', file: 'host', pattern: /throw new ReductionRefusal\('invalid_input', 'Malformed reduce_state JSON'\)/, replacement: "throw new SyntaxError('Malformed JSON')", test: 'contracts', filter: 'schema ownership', proof: 'proof:adapter_json' },
  { name: 'adapter object-root check removed', file: 'host', pattern: /insist\(reduceState !== null && typeof reduceState === 'object' && !Array.isArray\(reduceState\),[^\n]+\);/, replacement: '', test: 'contracts', filter: 'schema ownership', proof: 'proof:adapter_json' },
  { name: 'TOON string quoting removed', file: 'output', pattern: /encode\(value, \{ replacer: [^\n]+? \}\)/, replacement: 'encode(value)', test: 'contracts', filter: 'refusal mapping and rendering', proof: 'proof:inert_roundtrip' },
  { name: 'privacy traversal work bound removed', file: 'schema', pattern: /insist\(\+\+visits <= 32768,[^\n]+\);/, replacement: '', test: 'privacy', filter: 'privacy traversal bounds', proof: 'proof:traversal_budget' },
  { name: 'legacy reads reclassified as new submissions', file: 'api', pattern: /const state = readState\(got.item.reduce_state\);/, replacement: 'parse(CreateReductionInputSchema.shape.definition, got.item.reduce_state.definition); const state = readState(got.item.reduce_state);', test: 'privacy', filter: 'strict privacy', proof: 'proof:legacy_read' },

  { name: 'private home check overmatches relative and URL paths', file: 'schema', pattern: /insist\(!\/.*'Private home paths are forbidden'\);/, replacement: String.raw`insist(!/(?:[\\/](?:home|Users)[\\/]|[\\/]root(?:[\\/]|\b))/iu.test(value), 'invalid_input', 'Private home paths are forbidden');`, test: 'privacy', filter: 'strict privacy', proof: 'proof:home_path_scope' },

  { name: 'native normalizer receiver binding removed', file: 'api', pattern: /host.normalizeId\?\.bind\(host\)/, replacement: 'host.normalizeId', test: 'contracts', filter: 'creation identity policy', proof: 'proof:normalizer_binding' },

];
for (const change of changes) {
  const root = mkdtempSync(join(tmpdir(), 'reduce-revert-'));
  try {
    for (const file of ['dist', 'test', 'scripts', 'docs', '.github', 'package.json', 'manifest.json']) cpSync(file, join(root, file), { recursive: true }); symlinkSync(join(process.cwd(), 'node_modules'), join(root, 'node_modules'), 'dir');
    const file = join(root, `dist/src/${change.file}.js`); const source = readFileSync(file, 'utf8'); assert.match(source, change.pattern, `Mutation did not match ${change.name}`); writeFileSync(file, source.replace(change.pattern, change.replacement));
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', '--test-concurrency=2', `--test-name-pattern=${change.filter}`, `test/${change.test}.test.ts`], { cwd: root, env: testEnvironment(npmEnvironment(process.env)), encoding: 'utf8', timeout: 120000 });
    assertIntendedFailure(result, change.proof); console.log(`EXPECTED FAIL: ${change.name}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const restored = spawnSync(process.execPath, ['--test', '--test-concurrency=2', 'test/api.test.ts', 'test/kernel.test.ts', 'test/privacy.test.ts'], { env: testEnvironment(npmEnvironment(process.env)), encoding: 'utf8', timeout: 180000 });
assert.equal(restored.status, 0, restored.stdout + restored.stderr); const count = restored.stdout.match(/tests (\d+)/); assert.ok(count && Number(count[1]) > 0); console.log(`revert-gate: ${changes.length} behavioral failures; ${count[1]} fixed tests pass`);
