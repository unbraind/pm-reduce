import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PmClient } from '@unbrained/pm-cli/sdk/core';
import { createDirectoryHost, createReduction, readReduction, nextReductionTrial, requestReductionTrial, recordReductionOutcome, digest } from '../dist/index.js';
import type { Host, ReductionDefinition, Outcome } from '../dist/index.js';
import type { TestContext } from 'node:test';
/** Synthetic public immutable source reference; contains no input body. */
export function source() { return { item_id: 'corpus-source', item_hash: digest('source'), field_pointer: '/fixture', content_digest: digest('fixture') }; }
/** Fixed ordered atoms; labels preserve data whitespace exactly. */
export function definition(count = 4): ReductionDefinition {
  return { atoms: Array.from({ length: count }, (_, at) => ({ atom_id: `a${at}`, payload_digest: digest(`atom ${at}`), source_ref: source(), label: `  atom ${at}\n ` })), composition: 'ordered_subset', original_digest: digest('original'), oracle: { oracle_key: 'fixture', recipe_digest: digest('recipe'), subject_digest: digest('subject'), environment_digest: digest('environment'), target_failure_signature: 'target', result_schema_digest: digest('schema'), deterministic_declared: true }, max_trials: 256 };
}
/** Real SDK plain tracker; all cleanup is registered before initialization. */
export async function fixture(t: TestContext, provision = true, def = definition()) {
  const root = await mkdtemp(join(tmpdir(), 'pm-reduce-')); t.after(() => rm(root, { recursive: true, force: true }));
  const pmRoot = join(root, '.agents/pm'); const native = new PmClient({ cwd: root, pmRoot, author: 'fixture', noExtensions: true });
  await native.init('corpus', { defaults: true, agentGuidance: 'skip', mergeFence: false });
  const host = createDirectoryHost(pmRoot, 'fixture'); const birth = { id: 'corpus-repro', op: 'birth', title: 'Public reproduction', definition: def, related: [] };
  if (provision) await createReduction(host, birth); return { root, pmRoot, native, host, birth, id: birth.id };
}
/** Exact oracle contract for an explicitly completed or unresolved external verdict. */
export function outcome(def: ReductionDefinition, subset_digest: string, result: Outcome['result'] = 'target_fail', patch: Partial<Outcome> = {}): Outcome {
  const oracle = def.oracle; return { result, completed: result !== 'unresolved', actual_signature: result === 'target_fail' ? oracle.target_failure_signature : null, reason: result === 'unresolved' ? 'unable to materialize' : '', evidence_ref: source(), observed_at: '2026-11-06T00:00:00Z', recorder: 'fixture', subset_digest, oracle_digest: digest(oracle), recipe_digest: oracle.recipe_digest, subject_digest: oracle.subject_digest, environment_digest: oracle.environment_digest, result_schema_digest: oracle.result_schema_digest, ...patch };
}
/** Reserve a freshly reviewed exact proposal. */
export async function reserve(host: Host, id = 'corpus-repro', op = 'reserve') {
  const next = await nextReductionTrial(host, { id });
  const input = { id, op, revision: next.revision, proposal: next.proposal_digest! }; const receipt = await requestReductionTrial(host, input); return { input, receipt, candidate: next.candidate! };
}
/** Deliberately execute the synthetic predicate in the test caller, then record it. */
export async function runTrial(host: Host, id: string, op: string, predicate: (subset: string[]) => Outcome['result']) {
  const reserved = await reserve(host, id, `reserve-${op}`); const snap = await readReduction(host, id);
  const input = { id, op: `record-${op}`, revision: snap.revision, request: reserved.receipt.result.identity, outcome: outcome(snap.state.definition, reserved.candidate.subset_digest, predicate(reserved.candidate.subset_ids)) };
  return { ...reserved, record: await recordReductionOutcome(host, input), recordInput: input };
}
/** Match a stable typed refusal without exposing submitted input. */
export function hasCode(code: string): (error: unknown) => boolean { return error => typeof error === 'object' && error !== null && 'code' in error && error.code === code; }
/** Count native journal events to verify replay has no side effects. */
export async function historyEvents(pmRoot: string, id = 'corpus-repro'): Promise<number> { return (await readFile(join(pmRoot, 'history', `${id}.jsonl`), 'utf8')).trim().split('\n').length; }
