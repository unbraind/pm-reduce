import { createHash } from 'node:crypto';
import { z } from 'zod';
import { scanMutationSecrets } from '@unbrained/pm-cli/sdk';
import { containsPrivateHomePath } from './privacy.ts';
import { insist, ReductionRefusal } from './errors.ts';
/** Bounded canonical identity; surrounding whitespace is normalized for every request. */
export const KeySchema = z.string().trim().min(1).max(96).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/);
/** SHA-256 content identity, never an executable reference. */
export const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
/** Independently captured source snapshot; current freshness is unknown. */
export const SourceRefSchema = z.strictObject({ item_id: KeySchema, item_hash: DigestSchema, field_pointer: z.string().min(1).max(256), content_digest: DigestSchema, citation_id: KeySchema.optional() });
/** Atom metadata; raw input remains in caller-authorized artifacts. */
export const AtomSchema = z.strictObject({ atom_id: KeySchema, payload_digest: DigestSchema, source_ref: SourceRefSchema, label: z.string().max(128).optional() });
/** Fixed, declared deterministic oracle; no command or executable field exists. */
export const OracleSchema = z.strictObject({ oracle_key: KeySchema, recipe_digest: DigestSchema, subject_digest: DigestSchema, environment_digest: DigestSchema, target_failure_signature: z.string().min(1).max(128), result_schema_digest: DigestSchema, deterministic_declared: z.literal(true) });
/** Maximum durable operation receipts, including creation and trial request/result pairs. */
export const REPLAY_RECEIPT_CAPACITY = 512;
/** Largest declared trial budget with one creation receipt and two receipts per trial. */
export const MAX_TRIALS = Math.floor((REPLAY_RECEIPT_CAPACITY - 1) / 2);
/** Frozen ordered atomization and oracle identity. */
export const DefinitionSchema = z.strictObject({ atoms: z.array(AtomSchema).min(1).max(64), composition: z.literal('ordered_subset'), original_digest: DigestSchema, oracle: OracleSchema, max_trials: z.number().int().min(1).max(MAX_TRIALS), predecessor: SourceRefSchema.optional() }).refine(value => new Set(value.atoms.map(atom => atom.atom_id)).size === value.atoms.length);
/** Replayable read-only proposal derived solely from the journal. */
export const CandidateSchema = z.strictObject({ subset_ids: z.array(KeySchema).max(64), subset_digest: DigestSchema, oracle_digest: DigestSchema, purpose: z.enum(['baseline', 'subset', 'complement', 'deletion']), partition_cursor: z.string().max(128) });
/** One durable reservation; completed means an outcome exists, not external exactly-once execution. */
export const TrialRequestSchema = CandidateSchema.extend({ request_id: KeySchema, state: z.enum(['pending', 'completed']) });
/** Exact submitted result contract; other failures are unresolved. */
export const OutcomeSchema = z.strictObject({ result: z.enum(['target_fail', 'pass', 'unresolved']), completed: z.boolean(), actual_signature: z.string().min(1).max(128).nullable(), reason: z.string().max(256), evidence_ref: SourceRefSchema, observed_at: z.iso.datetime(), recorder: KeySchema, subset_digest: DigestSchema, oracle_digest: DigestSchema, recipe_digest: DigestSchema, subject_digest: DigestSchema, environment_digest: DigestSchema, result_schema_digest: DigestSchema });
/** Observations are immutable and may disagree; no majority vote is performed. */
export const ObservationSchema = OutcomeSchema.extend({ observation_id: KeySchema, request_id: KeySchema, evidence: z.enum(['reported_oracle', 'host_verified']), verification_digest: DigestSchema.nullable() });
/** Compact historical result retains committed identity apart from the current revision. */
export const CommittedResultSchema = z.strictObject({ kind: z.enum(['create', 'request', 'record']), identity: KeySchema, sequence: z.number().int().min(1).max(REPLAY_RECEIPT_CAPACITY), digest: DigestSchema });
/** Durable operation identity; never evicted or repurposed. */
export const ReplaySchema = z.strictObject({ operation_id: KeySchema, request_digest: DigestSchema, result: CommittedResultSchema, result_digest: DigestSchema });
/** All authoritative state lives in this single native field. */
export const ReductionStateSchema = z.strictObject({ version: z.literal(1), package: z.literal('pm-reduce'), algorithm_version: z.literal('ddmin-1'), definition: DefinitionSchema, best_failing_subset: z.array(KeySchema).nullable(), partition_cursor: z.string().max(128), requests: z.array(TrialRequestSchema).max(MAX_TRIALS), observations: z.array(ObservationSchema).max(REPLAY_RECEIPT_CAPACITY), trial_budget: z.strictObject({ limit: z.number().int(), reserved: z.number().int(), completed: z.number().int(), pending: z.number().int() }), qualification: z.string().max(128), replay_receipts: z.array(ReplaySchema).min(1).max(REPLAY_RECEIPT_CAPACITY) });
const common = { id: KeySchema, budget: z.number().int().positive().max(8192).default(1600) };
const mutation = { ...common, op: KeySchema, revision: DigestSchema };
/** Explicit create-if-absent identity and immutable definition. */
export const CreateReductionInputSchema = z.strictObject({ ...common, op: KeySchema, title: z.string().trim().min(1).max(256), definition: DefinitionSchema, related: z.array(KeySchema).max(16).default([]) });
/** Read the next deterministic proposal without reserving it. */
export const NextTrialInputSchema = z.strictObject(common);
/** Admit only the exact revision-bound proposal. */
export const RequestTrialInputSchema = z.strictObject({ ...mutation, proposal: DigestSchema });
/** Append a distinct observed execution under an existing reservation. */
export const RecordOutcomeInputSchema = z.strictObject({ ...mutation, request: KeySchema, outcome: OutcomeSchema });
/** Read the complete qualified minimality witness set. */
export const CertificateInputSchema = z.strictObject(common);
/** Revision-bound journal page with exact counts. */
export const PacketInputSchema = z.strictObject({ ...common, cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(100).default(20) });
/** Stored native aggregate. Public typed contract. */
export type ReductionState = z.infer<typeof ReductionStateSchema>;
/** Frozen input definition. Public typed contract. */
export type ReductionDefinition = z.infer<typeof DefinitionSchema>;
/** Read-only candidate. Public typed contract. */
export type Candidate = z.infer<typeof CandidateSchema>;
/** Durable reserved trial. Public typed contract. */
export type TrialRequest = z.infer<typeof TrialRequestSchema>;
/** Exact external verdict submission. Public typed contract. */
export type Outcome = z.infer<typeof OutcomeSchema>;
/** Create request shared by CLI and SDK. */
export type CreateReductionInput = z.input<typeof CreateReductionInputSchema>;
/** Proposal read request. Public typed contract. */
export type NextTrialInput = z.input<typeof NextTrialInputSchema>;
/** Trial reservation request. Public typed contract. */
export type RequestTrialInput = z.input<typeof RequestTrialInputSchema>;
/** External result request. Public typed contract. */
export type RecordOutcomeInput = z.input<typeof RecordOutcomeInputSchema>;
/** Certificate read request. Public typed contract. */
export type CertificateInput = z.input<typeof CertificateInputSchema>;
/** Packet read request. Public typed contract. */
export type PacketInput = z.input<typeof PacketInputSchema>;
/** Stable sorted object keys preserve arrays, whitespace and input order exactly. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
/** Compute the canonical SHA-256 content identity. */
export function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
/** Shared pre-write privacy validation; legacy state is validated structurally, not reclassified. */
export function guardSubmitted(input: unknown): void {
  const seen = new Set<object>(); const checked = new Set<string>(); let visits = 0;
  /** Bound repeated graph visits and identical-text rescans as well as active-path depth and cycles. */
  function visit(value: unknown, depth: number): void {
    insist(++visits <= 32768, 'invalid_input', 'Input traversal exceeds the work limit');
    insist(depth <= 16, 'invalid_input', 'Input nesting exceeds sixteen levels');
    if (typeof value === 'string') {
      if (checked.has(value)) return;
      insist(value.length <= 8000 && value.isWellFormed(), 'invalid_input', 'Text is oversized or malformed Unicode');
      insist(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value), 'invalid_input', 'Control sequences are forbidden');
      insist(!containsPrivateHomePath(value), 'invalid_input', 'Private home paths are forbidden');
      insist(scanMutationSecrets(value).length === 0, 'invalid_input', 'SDK privacy guard detected credential-shaped content');
      checked.add(value);
    } else if (value !== null && typeof value === 'object') {
      insist(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'invalid_input', 'Only plain JSON data is supported');
      // JSON arrays never have holes. A hole lets schema validation walk empty slots and read values inherited from
      // Array.prototype that this guard never scans, so only arrays whose keys are exactly 0..length-1 are accepted. The
      // length is checked against the work budget first, so a huge array never allocates its key list.
      if (Array.isArray(value)) {
        insist(visits + value.length <= 32768, 'invalid_input', 'Input traversal exceeds the work limit');
        const keys = Object.keys(value);
        insist(keys.length === value.length && keys.every((key, index) => key === String(index)), 'invalid_input', 'Sparse arrays are not plain JSON data');
      }
      insist(!seen.has(value), 'invalid_input', 'Cyclic input is forbidden'); seen.add(value);
      for (const name of Reflect.ownKeys(value)) { const descriptor = Object.getOwnPropertyDescriptor(value, name)!; insist(typeof name === 'string' && 'value' in descriptor && (descriptor.enumerable || (Array.isArray(value) && name === 'length')), 'invalid_input', 'Only enumerable JSON data properties are supported'); }
      for (const [name, child] of Object.entries(value)) { insist(!['__proto__', 'prototype', 'constructor'].includes(name), 'invalid_input', 'Prototype keys are forbidden'); visit(child, depth + 1); }
      seen.delete(value);
    }
  }
  visit(input, 0);
}
/** Strict schema parse with bounded diagnostics that never echo submitted text. */
export function parse<T>(schema: z.ZodType<T>, value: unknown, stored = false): T {
  if (!stored) guardSubmitted(value);
  const result = schema.safeParse(value);
  if (!result.success) throw new ReductionRefusal(stored ? 'invalid_record' : 'invalid_input', 'Strict reduction contract failed', 'Use the documented versioned JSON schema');
  return result.data;
}
