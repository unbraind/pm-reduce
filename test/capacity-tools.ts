import { canonical, digest, readState } from 'pm-reduce';
import type { ReductionState, Outcome } from 'pm-reduce';

/** Append one consistent repeat observation and its distinct replay receipt to a test journal. */
export function appendObservation(state: ReductionState, index: number): ReductionState {
  const copy = structuredClone(state); const row = { ...copy.observations[0], observation_id: `seed-observation-${index}`, reason: 'x'.repeat(256) };
  copy.observations.push(row);
  const result = { kind: 'record' as const, identity: row.observation_id, sequence: copy.replay_receipts.length + 1, digest: digest(row) };
  copy.replay_receipts.push({ operation_id: `seed-${index}`, request_digest: digest(index), result, result_digest: digest(result) });
  return copy;
}

/** Populate a valid legacy journal near a byte frontier without executing an oracle. */
export function fillJournal(original: ReductionState, ceiling: number): ReductionState {
  let state = structuredClone(original);
  for (let index = 0; index < 512; index++) {
    const copy = appendObservation(state, original.replay_receipts.length + index);
    if (Buffer.byteLength(canonical(copy)) > ceiling) break;
    state = copy;
  }
  return readState(state);
}

/** Saturate every variable-width completion field, including the permitted ISO fractional precision. */
export function largestOutcome(base: Outcome): Outcome {
  const observed_at = '2026-11-06T00:00:00.' + '0'.repeat(7979) + 'Z';
  return { ...base, reason: '\u0800'.repeat(256), recorder: 'r'.repeat(96), observed_at,
    evidence_ref: { ...base.evidence_ref, item_id: 'i'.repeat(96), citation_id: 'c'.repeat(96), field_pointer: '\u0800'.repeat(256) } };
}
