/** Reviewed public-history harness. All source acquisition is frozen in local fixtures. */
import assert from 'node:assert/strict';
import { z } from 'zod';
import { editedText, tokenize, exemplarContext } from './fixtures/history.ts';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReduction, readReduction, nextReductionTrial, requestReductionTrial, recordReductionOutcome, reductionCertificate, reductionPacket, digest, fitEnvelope, envelope, OutcomeSchema, canonical, canonicalSubsetDigest } from '../dist/index.js';
import { wire } from '../dist/src/output.js';
import { definition, outcome } from './helpers.ts';
import type { Host } from '../dist/index.js';
/** Public regression scenarios contain only fixture-derived payloads. */
export const scenarios = ['beads-precision', 'jev-unicode', 'jev-utf8-budget'] as const;
/** Frozen fixture inputs expand documented regression triggers with irrelevant public data. */
export function atomsFor(name: typeof scenarios[number]): string[] {
  if (name === 'beads-precision') return Array.from({ length: 16 }, (_, index) => index === 9 ? '{"id":"x","title":"Precision","foreign_revision":9007199254740993,"dependencies":["x"]}' : JSON.stringify({ id: `row-${index}`, title: 'Keep', description: 'public fixture '.repeat(64) }));
  if (name === 'jev-unicode') return Array.from({ length: 16 }, (_, index) => index === 9 ? '東京' : 'unrelated '.repeat(100));
  return Array.from({ length: 16 }, () => JSON.stringify({ title: '東京', body: '漢'.repeat(100), labels: { type: '課題' } }));
}
/** Exact materialization is concatenation in original order, with a frozen separator. */
export function materialize(name: typeof scenarios[number], atoms: string[]): string { return atoms.join(name === 'jev-unicode' ? ' ' : '\n'); }
/** Caller-owned historical oracle; no production package API invokes this code. */
export function historicalOracle(name: typeof scenarios[number], atoms: string[]): boolean {
  const text = materialize(name, atoms);
  if (name === 'beads-precision') {
    const line = atoms.findIndex(row => row.includes('"id":"x"')); const remove = line < 0 ? [] : [{ line: line + 1, blocker: 'x' }];
    const actual = editedText({ lines: atoms }, remove);
    const expected = text.replace('"dependencies":["x"]', '"dependencies":[]'); return actual !== expected;
  }
  // By design the fixture tokenizer is ASCII-only while this oracle matches Unicode letters and digits:
  // that disagreement IS the historical pm-jev defect the scenario reproduces, not a harness bug.
  if (name === 'jev-unicode') return JSON.stringify(tokenize(text)) !== JSON.stringify(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const units = atoms.map(row => JSON.parse(row) as { title: string; body: string; labels: Record<string, string> });
  return Math.ceil(Buffer.byteLength(JSON.stringify(exemplarContext(units, 35))) / 4) > 35;
}
/** Hash exact fixture bytes, separately from canonical JSON identities in the domain API. */
export function bytesDigest(text: string): string { return createHash('sha256').update(text).digest('hex'); }
/** Bind the complete reviewed fixture module, including every transitive helper and constant. */
export function oracleRecipeDigest(historical_source: string, fixture_sha256: string | undefined): string {
  assert.match(fixture_sha256 ?? '', /^[a-f0-9]{64}$/u, 'proof:recipe_fixture_required');
  return digest({ harness: historicalOracle.toString(), materialize: materialize.toString(), historical_source, fixture_sha256 });
}
/** Bind scenarios to reviewed source filenames independently of provenance array order. */
export function sourceForScenario<T extends { file: string }>(sources: T[], name: typeof scenarios[number]): T {
  const sourceFile = name === 'beads-precision' ? 'repair.ts' : 'exemplar-retrieval.ts';
  const anchor = sources.find(source => source.file === sourceFile); assert.ok(anchor, 'Scenario source file must have provenance'); return anchor;
}
/** Execute a complete public reproduction using real SDK state and durable resumed requests. */
export async function reproduce(host: Host, id: string, name: typeof scenarios[number]) {
  let totalDeliveredBytes = 0; let completeReadBytes = 0; let auxiliaryBytes = 0; let deliveredResults = 0;
  const oracleEvidence: { source_ref: ReturnType<typeof outcome>['evidence_ref']; description: string }[] = [];
  /** Measure each complete consumer delivery, including framing and separately counted raw SDK snapshots. */
  async function delivered<T>(operation: Promise<T>, budget: number): Promise<T> {
    const value = await operation; const row = value as Record<string, unknown>; let bytes: number;
    if ('owner_id' in row) { const fitted = fitEnvelope(host, envelope(value as Parameters<typeof envelope>[0]), budget); bytes = Math.max(Buffer.byteLength(wire(fitted, 'json')), Buffer.byteLength(wire(fitted, 'toon'))); }
    else { bytes = Buffer.byteLength(JSON.stringify(value)); if ('state' in row) completeReadBytes += bytes; else auxiliaryBytes += bytes; }
    totalDeliveredBytes += bytes; deliveredResults++; return value;
  }
  /** Persist the caller-owned external result before recording it into the reduction journal. */
  async function evidence(subset: string[], result: 'target_fail' | 'pass', execution: number) {
    const observed_at = new Date().toISOString(); const description = canonical({ scenario: name, subset_ids: subset, subset_digest: canonicalSubsetDigest(def, subset), oracle_digest: digest(def.oracle), recipe_digest: def.oracle.recipe_digest, subject_digest: def.oracle.subject_digest, environment_digest: def.oracle.environment_digest, result_schema_digest: def.oracle.result_schema_digest, result, observed_at, signature: result === 'target_fail' ? name : null });
    const created = await delivered(host.client.create({ id: `${id}-evidence-${execution}`, title: 'Public historical oracle result', type: 'Task', description }), 1600);
    const revision = await delivered(host.client.readItemRevision(created.item.id), 1600);
    const source_ref = { item_id: created.item.id, item_hash: revision.item_hash, field_pointer: '/description', content_digest: digest(description) }; oracleEvidence.push({ source_ref, description }); return { evidence_ref: source_ref, observed_at };
  }
  const provenance = JSON.parse(await readFile('test/fixtures/provenance.json', 'utf8')) as { fixture_sha256: string; sources: { file: string; repository: string; revision: string; source_sha256: string; native_anchor: { item_id: string; item_hash: string; field_pointer: string; content_digest: string } }[] };
  const anchor = sourceForScenario(provenance.sources, name); const payloads = atomsFor(name); const def = definition(16);
  def.original_digest = bytesDigest(materialize(name, payloads)); def.oracle.oracle_key = name; def.oracle.recipe_digest = oracleRecipeDigest(anchor.source_sha256, provenance.fixture_sha256); def.oracle.environment_digest = digest({ runtime: process.version, platform: process.platform, architecture: process.arch, harness: 'historical-excerpts-v1' }); def.oracle.result_schema_digest = digest(z.toJSONSchema(OutcomeSchema)); def.oracle.subject_digest = anchor.source_sha256; def.oracle.target_failure_signature = name;
  def.atoms = payloads.map((text, index) => ({ atom_id: `a${index}`, payload_digest: bytesDigest(text), source_ref: { item_id: anchor.native_anchor.item_id, item_hash: anchor.native_anchor.item_hash, field_pointer: anchor.native_anchor.field_pointer, content_digest: anchor.native_anchor.content_digest, citation_id: anchor.revision } }));
  /** Verify every exact caller artifact byte digest and the original order before execution. */
  function materialized(ids: string[]): string[] {
    const selected = new Set(ids); assert.deepEqual(ids, def.atoms.filter(atom => selected.has(atom.atom_id)).map(atom => atom.atom_id));
    return ids.map(key => { const index = def.atoms.findIndex(atom => atom.atom_id === key); assert.ok(index >= 0); const text = payloads[index]; assert.equal(bytesDigest(text), def.atoms[index].payload_digest); return text; });
  }
  await delivered(createReduction(host, { id, op: 'birth', title: name, definition: def }), 1600); let actual = 0; let resumes = 0; let cacheHits = 0; const started = performance.now(); const log: { request: string; subset: string[]; result: 'target_fail' | 'pass' }[] = [];
  for (;;) {
    const next = await delivered(nextReductionTrial(host, { id }), 1600); cacheHits = Number(next.cache_hits); if (!next.candidate) break;
    const reserved = await delivered(requestReductionTrial(host, { id, op: `reserve-${actual}`, revision: next.revision, proposal: next.proposal_digest! }), 1600);
    const reservedInput = materialized(next.candidate.subset_ids); assert.equal(canonicalSubsetDigest(def, next.candidate.subset_ids), next.candidate.subset_digest);
    const result = historicalOracle(name, reservedInput) ? 'target_fail' as const : 'pass' as const; actual++; const retainedEvidence = await evidence(next.candidate.subset_ids, result, actual);
    // Caller resumes on the same host after an interruption, retaining the external result; package never reruns it.
    if (resumes < 5) { const resumed = await delivered(nextReductionTrial(host, { id }), 1600); assert.equal(resumed.status, 'pending_trial'); const packet = await delivered(reductionPacket(host, { id, limit: 1 }), 1600); assert.ok(packet.outstanding); resumes++; }
    const current = await delivered(readReduction(host, id), 1600); const request = reserved.result.identity;
    const input = { id, op: `record-${actual}`, revision: current.revision, request, outcome: outcome(def, next.candidate.subset_digest, result, retainedEvidence) };
    await delivered(recordReductionOutcome(host, input), 1600); if (actual === 1) assert.equal(result, 'target_fail', `${name} must reproduce before search`); log.push({ request, subset: next.candidate.subset_ids, result });
    const replay = await delivered(recordReductionOutcome(host, input), 1600); assert.equal(replay.replayed, true);
  }
  let certificate = (await delivered(reductionCertificate(host, { id, budget: 8192 }), 8192)).certificate; assert.equal(certificate.qualification, 'one_minimal_under_recorded_oracle');
  const best = certificate.best_subset!; const independent = [best, ...best.map((_, at) => best.filter((__, index) => index !== at))];
  for (let at = 0; at < independent.length; at++) {
    const subset = independent[at]; const result = historicalOracle(name, materialized(subset)) ? 'target_fail' as const : 'pass' as const; actual++;
    assert.equal(result, at === 0 ? 'target_fail' : 'pass'); const current = await delivered(readReduction(host, id), 1600); const request = current.state.requests.find(row => JSON.stringify(row.subset_ids) === JSON.stringify(subset))!;
    await delivered(recordReductionOutcome(host, { id, op: `independent-${at}`, revision: current.revision, request: request.request_id, outcome: outcome(def, request.subset_digest, result, await evidence(subset, result, actual)) }), 1600);
  }
  certificate = (await delivered(reductionCertificate(host, { id, budget: 8192 }), 8192)).certificate; const snapshot = await delivered(readReduction(host, id), 1600); const packet = await delivered(reductionPacket(host, { id, limit: 1 }), 1600);
  const fitted = fitEnvelope(host, envelope(packet)); const packetBytes = Math.max(Buffer.byteLength(wire(fitted, 'json')), Buffer.byteLength(wire(fitted, 'toon')));
  const manualBytes = Buffer.byteLength(JSON.stringify(snapshot.state)); assert.ok(packetBytes * 2 <= manualBytes);
  // Ten independently log-derived resume answers must agree with the bounded packet.
  const questions = [packet.owner_id === id, packet.revision === snapshot.revision, JSON.stringify(packet.best_subset) === JSON.stringify(best), packet.qualification === certificate.qualification, packet.outstanding === null, JSON.stringify(packet.trial_budget) === JSON.stringify(snapshot.state.trial_budget), packet.total_observations === snapshot.state.observations.length, packet.total_operations === snapshot.state.replay_receipts.length && canonical(packet.oracle) === canonical(snapshot.state.definition.oracle) && packet.original_digest === snapshot.state.definition.original_digest, JSON.stringify(packet.missing_deletions) === '[]', packet.witness_digest === certificate.witness_digest && canonical(packet.last_operation) === canonical(snapshot.state.replay_receipts.at(-1))]; assert.ok(questions.every(Boolean));
  return { scenario: name, owner_id: id, revision: snapshot.revision, reduction_snapshot: snapshot.state, certificate, total_delivered_bytes: totalDeliveredBytes, complete_sdk_snapshot_bytes: completeReadBytes, auxiliary_sdk_bytes: auxiliaryBytes, oracle_evidence: oracleEvidence, delivered_results: deliveredResults, source: `${anchor.repository}/blob/${anchor.revision}/${name === 'beads-precision' ? 'repair.ts' : 'exemplar-retrieval.ts'}`, source_sha256: anchor.source_sha256, native_anchor: anchor.native_anchor, original_digest: def.original_digest, initial_atoms: 16, final_atoms: best.length, original_bytes: Buffer.byteLength(materialize(name, payloads)), reduced_bytes: Buffer.byteLength(materialize(name, best.map(key => payloads[Number(key.slice(1))]))), reserved_trials: snapshot.state.requests.length, actual_trials: actual, outcomes: { target_fail: snapshot.state.observations.filter(row => row.result === 'target_fail').length, pass: snapshot.state.observations.filter(row => row.result === 'pass').length, unresolved: 0 }, cache_hits: cacheHits, resumes, independent_checks: independent.length, qualification: certificate.qualification, witness_digest: certificate.witness_digest, packet_bytes: packetBytes, packet_estimated_tokens: Math.ceil(packetBytes / 4), raw_estimated_tokens: Math.ceil(Buffer.byteLength(materialize(name, payloads)) / 4), manual_log_bytes: manualBytes, resume_questions: questions.length, latency_ms: Math.round(performance.now() - started), complete_observations: snapshot.state.observations.length, journal: log };
}
