import { z } from 'zod';
import { canonical, digest, parse, ReductionStateSchema } from './schema.ts';
import type { Candidate, Outcome, ReductionDefinition, ReductionState } from './schema.ts';
import { insist } from './errors.ts';
/** Identity includes original order; callers cannot reorder, duplicate or invent atoms. */
export function canonicalSubsetDigest(definition: ReductionDefinition, subset: string[]): string {
  const selected = new Set(subset);
  insist(selected.size === subset.length && canonical(definition.atoms.filter(atom => selected.has(atom.atom_id)).map(atom => atom.atom_id)) === canonical(subset), 'subset_mismatch', 'Subset must preserve the declared unique atom order');
  return digest({ original_digest: definition.original_digest, atoms: definition.atoms.filter(atom => selected.has(atom.atom_id)) });
}
/** Check all frozen oracle and subset identities before any observation is admitted. */
export function validateOutcome(definition: ReductionDefinition, subsetDigest: string, outcome: Outcome): void {
  insist(outcome.subset_digest === subsetDigest, 'subset_mismatch', 'Observed subset differs from the reserved trial', 'Reconcile the reserved input identity; do not relabel a different materialized subset');
  const oracle = definition.oracle;
  insist(outcome.oracle_digest === digest(oracle) && outcome.recipe_digest === oracle.recipe_digest && outcome.subject_digest === oracle.subject_digest && outcome.environment_digest === oracle.environment_digest && outcome.result_schema_digest === oracle.result_schema_digest, 'oracle_mismatch', 'Observed oracle differs from the frozen contract', 'Reconcile the frozen contract; create a new owner for a changed source, recipe or environment');
  insist(outcome.result === 'unresolved' || outcome.completed, 'invalid_signature', 'A conclusive outcome needs an explicit completed verdict', 'Record incomplete execution as unresolved with its retained evidence');
  insist(outcome.result !== 'target_fail' || outcome.actual_signature === oracle.target_failure_signature, 'invalid_signature', 'Target failure signature does not match the declared signature', 'Keep other failures as unresolved with their actual signature and reason');
  insist(outcome.result !== 'pass' || outcome.actual_signature === null, 'invalid_signature', 'A pass cannot carry a failure signature; record other failures as unresolved', 'Record a non-target failure as unresolved; pass requires an explicit successful verdict');
}
/** Partition a candidate into nonempty ordered chunks without changing its atoms. */
function partitions(subset: string[], count: number): string[][] {
  return Array.from({ length: count }, (_, index) => subset.slice(Math.floor(index * subset.length / count), Math.floor((index + 1) * subset.length / count)));
}
/** Exact cached verdict; unresolved results never provide pass evidence. */
export function cachedOutcome(state: ReductionState, subset: string[]): 'target_fail' | 'pass' | 'unresolved' | 'missing' | 'conflict' {
  const key = canonicalSubsetDigest(state.definition, subset);
  const results = new Set(state.observations.filter(row => row.subset_digest === key).map(row => row.result));
  if (results.has('pass') && results.has('target_fail')) return 'conflict';
  if (results.has('target_fail')) return 'target_fail';
  if (results.has('pass')) return 'pass';
  return results.has('unresolved') ? 'unresolved' : 'missing';
}
/** Deterministic replay cursor and next obligation. */
export interface Advancement {
  /** Current search or stop classification; never a causal claim. */
  status: string;
  /** Smallest candidate witnessed along this deterministic ddmin path. */
  best: string[] | null;
  /** Exact next subset obligation, or null when blocked or complete. */
  candidate: Candidate | null;
  /** Stable journal-derived cursor. */
  partition_cursor: string;
  /** Number of exact cached probes consulted during replay. */
  cache_hits: number;
}
/** Build a candidate under the frozen oracle. */
function candidate(state: ReductionState, subset: string[], purpose: Candidate['purpose'], cursor: string): Candidate {
  return { subset_ids: subset, subset_digest: canonicalSubsetDigest(state.definition, subset), oracle_digest: digest(state.definition.oracle), purpose, partition_cursor: cursor };
}
/** Replay deterministic ddmin subset/complement search, then explicit single-deletion certification. No execution. */
export function advanceReduction(state: ReductionState): Advancement {
  let best: string[] | null = null; let hits = 0;
  const full = state.definition.atoms.map(atom => atom.atom_id);
  /** Return the complete stop or proposal state without mutating the journal. */
  const result = (status: string, next: Candidate | null = null): Advancement => ({ status, best, candidate: next, partition_cursor: next?.partition_cursor ?? status, cache_hits: hits });
  // A conflicting verdict anywhere suspends all reuse, even outside the current best.
  const verdicts = new Map<string, Set<string>>();
  for (const row of state.observations) { const results = verdicts.get(row.subset_digest) ?? new Set<string>(); results.add(row.result); verdicts.set(row.subset_digest, results); }
  if ([...verdicts.values()].some(results => results.has('pass') && results.has('target_fail'))) {
    best = state.requests.filter(row => verdicts.get(row.subset_digest)?.has('target_fail')).sort((left, right) => left.subset_ids.length - right.subset_ids.length)[0].subset_ids;
    return result('flaky_oracle');
  }
  const baseline = cachedOutcome(state, full);
  if (baseline === 'target_fail') best = full;
  /** Enforce reservation capacity on every newly proposed trial, including deletions. */
  const propose = (subset: string[], purpose: Candidate['purpose'], cursor: string) => state.requests.some(row => row.state === 'pending') ? result('pending_trial') : result(state.requests.length >= state.definition.max_trials ? 'trial_budget_exhausted' : 'ready', state.requests.length >= state.definition.max_trials ? null : candidate(state, subset, purpose, cursor));
  if (baseline === 'missing') return propose(full, 'baseline', 'baseline');
  hits++;
  if (baseline !== 'target_fail') return result(baseline === 'pass' ? 'baseline_not_failing' : 'baseline_unresolved');
  best = full; let size = 2;
  while (best.length >= 2) {
    const chunks = partitions(best, Math.min(size, best.length)); let smaller: string[] | null = null;
    for (const purpose of ['subset', 'complement'] as const) {
      for (let index = 0; index < chunks.length; index++) {
        const part: string[] = purpose === 'subset' ? chunks[index] : best.filter(atom => !chunks[index].includes(atom));
        const cached = cachedOutcome(state, part);
        if (cached === 'missing') return propose(part, purpose, `${best.length}:${size}:${purpose}:${index}`);
        hits++;
        if (cached === 'target_fail') { smaller = part; break; }
      }
      if (smaller) break;
    }
    if (smaller) { best = smaller; size = Math.max(2, size - 1); }
    else if (size >= best.length) break;
    else size = Math.min(best.length, size * 2);
  }
  for (let index = 0; index < best.length; index++) {
    const deletion = best.filter((_, at) => at !== index); const cached = cachedOutcome(state, deletion);
    if (cached === 'missing') return propose(deletion, 'deletion', `deletion:${index}`);
    hits++;
    if (cached === 'target_fail') { best = deletion; return result('empty_target_failure'); }
  }
  return result('search_complete');
}
/** Strict complete proof object; witness IDs remain bound even when journal pages are omitted. */
export const ReductionCertificateSchema = z.strictObject({ qualification: z.enum(['one_minimal_under_recorded_oracle', 'empty_target_failure', 'minimality_unproven', 'flaky_oracle', 'baseline_not_failing', 'baseline_unresolved']), best_subset: z.array(z.string()).nullable(), oracle_digest: z.string(), failing_witnesses: z.array(z.string()), deletion_witnesses: z.array(z.strictObject({ removed_atom: z.string(), subset_digest: z.string(), pass_witnesses: z.array(z.string()), status: z.string() })), missing_deletions: z.array(z.string()), evidence: z.literal('recorded_oracle'), limitations: z.array(z.string()), witness_digest: z.string() });
/** Qualified certificate, never globally smallest input or proven cause. */
export type ReductionCertificate = z.infer<typeof ReductionCertificateSchema>;
/** Construct and optionally independently compare a complete certificate against every observation. */
function certificateFromJournal(state: ReductionState, claimed?: ReductionCertificate): ReductionCertificate {
  const advanced = advanceReduction(state); const best = advanced.best;
  const failing = best === null ? [] : state.observations.filter(row => row.subset_digest === canonicalSubsetDigest(state.definition, best) && row.result === 'target_fail').map(row => row.observation_id);
  const deletions = best === null ? [] : best.map((removed_atom, index) => {
    const subset = best.filter((_, at) => at !== index); const subset_digest = canonicalSubsetDigest(state.definition, subset);
    return { removed_atom, subset_digest, pass_witnesses: state.observations.filter(row => row.subset_digest === subset_digest && row.result === 'pass').map(row => row.observation_id), status: cachedOutcome(state, subset) };
  });
  const missing = deletions.filter(row => row.status !== 'pass').map(row => row.removed_atom);
  const qualification = advanced.status === 'flaky_oracle' ? 'flaky_oracle' : best === null ? (advanced.status === 'baseline_not_failing' ? 'baseline_not_failing' : 'baseline_unresolved') : best.length === 0 ? 'empty_target_failure' : missing.length === 0 && failing.length > 0 && !state.requests.some(row => row.state === 'pending') ? 'one_minimal_under_recorded_oracle' : 'minimality_unproven';
  const content = { qualification, best_subset: best, oracle_digest: digest(state.definition.oracle), failing_witnesses: failing, deletion_witnesses: deletions, missing_deletions: missing, evidence: 'recorded_oracle', limitations: ['Relative to declared ordered atoms and recorded oracle only.', 'Not globally smallest, a proven cause, authenticated testimony or a future reproducibility guarantee.'] } as const;
  const certificate = parse(ReductionCertificateSchema, { ...content, witness_digest: digest({ certificate: content, owner_identity: state.replay_receipts[0].result.identity, algorithm_version: state.algorithm_version, definition: state.definition, requests: state.requests, observations: state.observations }) }, true);
  if (claimed !== undefined) { const parsed = ReductionCertificateSchema.safeParse(claimed); insist(parsed.success && canonical(certificate) === canonical(parsed.data), 'invalid_certificate', 'Certificate does not match the complete recorded witness set'); }
  return certificate;
}
/** Refresh only deterministic projections after a mutation; journal identity is unchanged. */
export function projectState(state: ReductionState): ReductionState {
  const advanced = advanceReduction(state); state.best_failing_subset = advanced.best; state.partition_cursor = advanced.partition_cursor; state.qualification = certificateFromJournal(state).qualification;
  state.trial_budget = { limit: state.definition.max_trials, reserved: state.requests.length, completed: state.requests.filter(row => row.state === 'completed').length, pending: state.requests.filter(row => row.state === 'pending').length };
  return state;
}
/** Validate serialized structure and independent journal invariants without changing old text. */
export function readState(value: unknown): ReductionState {
  const state = parse(ReductionStateSchema, value, true);
  insist(Buffer.byteLength(canonical(state)) <= 262144, 'capacity_exceeded', 'Owner state exceeds 256 KiB', 'Create a successor owner; journals are never pruned');
  const requests = new Map(state.requests.map(row => [row.request_id, row]));
  insist(requests.size === state.requests.length && new Set(state.observations.map(row => row.observation_id)).size === state.observations.length && new Set(state.replay_receipts.map(row => row.operation_id)).size === state.replay_receipts.length, 'invalid_record', 'Journal identities are duplicated');
  insist(state.requests.length <= state.definition.max_trials && state.requests.filter(row => row.state === 'pending').length <= 1, 'invalid_record', 'Trial reservations exceed the declared limits');
  for (const row of state.requests) {
    insist(row.subset_digest === canonicalSubsetDigest(state.definition, row.subset_ids) && row.oracle_digest === digest(state.definition.oracle), 'invalid_record', 'Stored trial contract is inconsistent');
    insist((row.state === 'completed') === state.observations.some(observation => observation.request_id === row.request_id), 'invalid_record', 'Stored reservation completion is inconsistent');
  }
  for (const row of state.observations) { const request = requests.get(row.request_id); insist(request, 'invalid_record', 'Observation has no reserved request'); validateOutcome(state.definition, request.subset_digest, row); insist((row.evidence === 'host_verified') === (row.verification_digest !== null), 'invalid_record', 'Verification attribution is inconsistent'); }
  insist(state.replay_receipts.length === 1 + state.requests.length + state.observations.length, 'invalid_record', 'Journal operation cardinality is inconsistent');
  const targets = new Map<string, unknown>([['create', state.definition], ...state.requests.map(row => [`request:${row.request_id}`, { ...row, state: 'pending' }] as [string, unknown]), ...state.observations.map(row => [`record:${row.observation_id}`, row] as [string, unknown])]);
  const identities = new Set<string>();
  for (const [index, row] of state.replay_receipts.entries()) {
    const key = row.result.kind === 'create' ? 'create' : `${row.result.kind}:${row.result.identity}`;
    insist(row.result.sequence === index + 1 && (index === 0) === (key === 'create') && !identities.has(key) && targets.has(key) && row.result.digest === digest(targets.get(key)) && row.result_digest === digest(row.result), 'invalid_record', 'Replay result or frozen definition digest is inconsistent'); identities.add(key);
  }
  const projected = projectState(structuredClone(state));
  insist(canonical(projected) === canonical(state), 'invalid_record', 'Stored reduction projections do not match the journal');
  return state;
}

/** Independently validate the full frozen journal before reconstructing or comparing a certificate. */
export function validateReductionCertificate(state: ReductionState, claimed?: ReductionCertificate): ReductionCertificate { return certificateFromJournal(readState(state), claimed); }
