import { defineExtension } from '@unbrained/pm-cli/sdk/authoring';
import { register } from './src/commands.ts';
/** Native reduction extension; activation contributes schema and commands only. */
const extension = defineExtension({ name: 'pm-reduce', version: '2026.11.6', description: 'Durable failure-input reduction', activate: register });
/** Activate through the authorized native extension host. */
export default extension;
/** CLI and in-process integrations share these typed operations. */
export { createReduction, nextReductionTrial, requestReductionTrial, recordReductionOutcome, reductionCertificate, reductionPacket, readReduction } from './src/api.ts';
/** Stable mutation and proposal result types. */
export type { MutationReceipt, TrialProposal, ReductionPacket } from './src/api.ts';
/** Directory and injected authorized backend contracts. */
export { createDirectoryHost } from './src/host.ts';
/** Native CAS provider and complete owner snapshot. */
export type { Host, Snapshot } from './src/host.ts';
/** Strict versioned nested request and storage schemas. */
export { KeySchema, DigestSchema, SourceRefSchema, AtomSchema, OracleSchema, DefinitionSchema, CandidateSchema, TrialRequestSchema, OutcomeSchema, ObservationSchema, CommittedResultSchema, ReplaySchema, ReductionStateSchema, CreateReductionInputSchema, NextTrialInputSchema, RequestTrialInputSchema, RecordOutcomeInputSchema, CertificateInputSchema, PacketInputSchema, canonical, digest } from './src/schema.ts';
/** Public domain types for external debugging harnesses. */
export type { ReductionState, ReductionDefinition, Candidate, TrialRequest, Outcome, CreateReductionInput, NextTrialInput, RequestTrialInput, RecordOutcomeInput, CertificateInput, PacketInput } from './src/schema.ts';
/** Pure deterministic algorithm and independent certificate checker. */
export { advanceReduction, canonicalSubsetDigest, validateReductionCertificate, ReductionCertificateSchema, readState } from './src/kernel.ts';
/** Qualified proof and deterministic replay cursor types. */
export type { ReductionCertificate, Advancement } from './src/kernel.ts';
/** Full output envelope, exact serializers and host fitting. */
export { ReductionResultSchema, ReductionDataSchema, MutationReceiptSchema, TrialProposalSchema, CertificateResultSchema, PacketRowSchema, ReductionPacketSchema, envelope, fitEnvelope } from './src/output.ts';
/** Versioned common output. */
export type { ReductionResult } from './src/output.ts';
/** Safe typed refusals and exit categories. */
export { ReductionRefusal, exitCode } from './src/errors.ts';
