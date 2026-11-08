# pm-reduce

Debugging is context management. A minimized reproduction is useful only when the next agent can recover its input identity, oracle contract, trial history and outstanding checks. pm-reduce retains that context in native pm items, with durable trial reservations and qualified single-deletion certificates.

The caller materializes and runs each trial. No package command starts a process, reads an input artifact, edits a source file or executes an oracle. The tracker stores atom references and digests; payloads remain in explicitly authorized caller artifacts.

## Install

Requires Node >=22.19 and pm-cli >=2026.11.5. Initialize a native tracker first so the package can activate its commands. In a fresh project run:

```sh
pm init my-project --defaults
```

This local candidate has not been published. After maintainer approval, installation uses:

```sh
pm package install pm-reduce
npm install pm-reduce @unbrained/pm-cli
bun add pm-reduce @unbrained/pm-cli
npx --no-install pm package install ./node_modules/pm-reduce
bunx --bun --no-install pm package install ./node_modules/pm-reduce
```

For the local candidate, install its captured `.tgz` instead of the registry name. All commands default to TOON; `--json` preserves the same versioned semantics.

## Agent guidance

Add this snippet to a project's `AGENTS.md`:

```markdown
Use pm-reduce to retain reduction context across resets. Freeze ordered atoms,
source digests and the exact oracle contract. Read `pm reduce next`, reserve that
proposal with its revision and a durable operation key, then run the authorized
oracle yourself. Record every execution outcome. Reconcile pending requests before
executing anything again. Reuse the same original request after a lost receipt.
Only call a result 1-minimal when `pm reduce certificate` supplies that qualified
receipt; unresolved or conflicting checks are not passing deletions.
```

## Commands

| Command | Effect | Example |
| --- | --- | --- |
| `create` | Freeze atoms, oracle and trial limit in a new owner | `pm reduce create --id repro --op birth --input -` |
| `next` | Read the exact next subset and proposal digest | `pm reduce next repro --json` |
| `request` | Reserve one exact proposal, consuming one trial | `pm reduce request repro --proposal <digest> --revision <hash> --op reserve-1` |
| `record` | Append an external oracle observation | `pm reduce record repro --request trial-1 --revision <hash> --op verdict-1 --input -` |
| `certificate` | Check the complete recorded deletion witness set | `pm reduce certificate repro --json` |
| `packet` | Read a bounded resume packet and journal page | `pm reduce packet repro --limit 1 --budget 1600 --json` |

`--op` is required on every write. Existing-owner writes require `--revision` from the current native owner. `request` recomputes its proposal; it accepts no caller-supplied subset. `record` takes the outcome object itself on stdin. `create` takes `{title,definition,related?}`. Inline JSON is also accepted as `--input '<json>'`. Input is at most 256 KiB and must be well-formed UTF-8 JSON.

Definition fields:

```typescript
{
  atoms: [{ atom_id, payload_digest, source_ref, label? }],
  composition: 'ordered_subset', original_digest,
  oracle: {
    oracle_key, recipe_digest, subject_digest, environment_digest,
    target_failure_signature, result_schema_digest,
    deterministic_declared: true
  },
  max_trials: 256, predecessor?: source_ref
}
```

A source reference is `{item_id,item_hash,field_pointer,content_digest,citation_id?}`. Every digest is 64 lowercase SHA-256 hex characters. Atom IDs are unique; ordering is immutable. `related` names native investigation links. Metadata changes require a new owner; cached trials do not migrate to it.

Outcome fields:

```typescript
{
  result: 'target_fail' | 'pass' | 'unresolved', completed: boolean,
  actual_signature: string | null, reason: string,
  evidence_ref: source_ref, observed_at: '2026-11-06T00:00:00Z', recorder: 'agent',
  subset_digest, oracle_digest, recipe_digest, subject_digest,
  environment_digest, result_schema_digest
}
```

`target_fail` requires the exact declared signature and a completed verdict. `pass` requires a completed verdict and null signature. Other failures, timeouts, missing artifacts and interrupted executions are `unresolved`. Every submitted identity must match the reservation. Conflicting conclusive observations suspend search as `flaky_oracle`; no majority vote occurs.

A pending request survives a crash. Inspect `next` or `packet`, retrieve the caller's retained external result and record it under that request. Rerunning the external oracle deliberately produces another observation under the same request with a distinct operation key. The package deduplicates recording; it cannot promise external exactly-once execution.

## SDK

The domain SDK operations below return promises and throw `ReductionRefusal` with `code`, `message`, `remedy`, `retryable` and bounded details. Unexpected output-fitter failures use `output_unavailable` for reads and `outcome_unknown` for mutation receipts; typed host refusals and output-budget retry hints are preserved. Pure schema and kernel helpers remain synchronous. Strict Zod schemas are exported for every nested input and persisted record. CLI and SDK use the same pure kernel and write path.

```typescript
import {
  createDirectoryHost, createReduction, nextReductionTrial,
  requestReductionTrial, recordReductionOutcome, reductionCertificate,
  reductionPacket, readReduction
} from 'pm-reduce';

// The host binds an already initialized tracker: run `pm init` (or the native
// client's init) once before creating owners, or creation refuses with
// `tracker_not_initialized`.
const host = createDirectoryHost('.agents/pm', 'debug-agent');
// Hosting applications must authorize access before constructing or injecting a host.
await createReduction(host, { id: 'repro', op: 'birth', title: 'Import failure', definition });
const next = await nextReductionTrial(host, { id: 'repro' });
if (next.candidate && next.proposal_digest) {
  const reserved = await requestReductionTrial(host, {
    id: next.owner_id, op: 'reserve-1', revision: next.revision,
    proposal: next.proposal_digest
  });
  // Materialize exactly next.candidate.subset_ids, verify payloads, run the oracle.
  // externalOutcome is supplied by that authorized caller, not pm-reduce.
  await recordReductionOutcome(host, {
    id: next.owner_id, op: 'verdict-1', revision: reserved.revision,
    request: reserved.result.identity, outcome: externalOutcome
  });
}
const proof = await reductionCertificate(host, { id: 'repro' });
const packet = await reductionPacket(host, { id: 'repro', limit: 1 });
const complete = await readReduction(host, 'repro');
```

`readReduction` is an authorized unbounded selected-owner SDK read for integrators. The six domain commands apply the budget contract. `advanceReduction(state)`, `canonicalSubsetDigest(definition,ids)` and `validateReductionCertificate(state,claimed?)` are pure APIs. The certificate checker reconstructs the witness set and refuses a mismatched supplied certificate. `readState` validates storage and its journal projections. `canonical` and `digest` hash canonical JSON while preserving array order and exact string whitespace; artifact byte hashes are the caller's responsibility.

An injected `Host` supplies an already authorized native client, certified `native_item_cas` and `create_if_absent` capabilities, and optionally the native whole-envelope fitter, read-only settings, ID normalizer (or explicit native `idPrefix`), create-time schema provisioning and trusted immutable-result verification. Method presence alone is not capability evidence. Creation requires one of these native identity policies; missing guarantees refuse before writes. The directory adapter and an independently injected client contract are tested; database and MCP implementations are not claimed certified.

Observations are `reported_oracle` unless `verifyOutcome` returns a trusted immutable-result SHA-256 attestation. Attribution labels and `PM_AUTHOR` are not authentication. Referenced source freshness remains unknown without a separately authorized evidence adapter. pm-hypothesis can link explanations to the owner; pm-rl and debugging loops can drive the SDK. No task status or assurance verdict is changed by domain commands.

## Output and recovery

Envelopes carry schema version, owner revision, selected scope, data or refusal, source completeness, output completeness, exact returned/omitted counts, a continuation, warnings and a receipt. Writes also include operation ID, request/result digests and replay status. Replayed results retain the historical committed semantic identity and separately report the current observed native revision.

Default budget: 1600 estimated tokens, using **ceil(final UTF-8 bytes / 4)**. This is not provider-token usage. Both registered serializers, framing and native fit metadata are measured. Hard ceiling: 32 KiB. Mandatory identities, unknowns, proof qualifications and counts are never shortened. A too-small budget returns `output_budget` with a verified `minimum_usable_budget`, or null if a narrower query is needed. A write-result budget is checked before mutation. Package `--budget`, `--cursor` and `--limit` avoid native producer-transport limitations. Conflicting package/native flags are refused. Native outer projection that drops context produces an explicit refusal.

`packet` pages observations (default 20, range 1..100). Its summary always carries the frozen oracle and original input identities, latest operation receipt, best subset, outstanding trial, trial budget, qualification, missing deletions and the complete certificate digest. Omitted counts include every observation outside the current page. Cursors bind owner revision, query and ordering; any mutation invalidates them. `certificate` carries the full witness set and can truthfully require a larger budget.

Settings section `reduce` accepts only the optional `output_budget` key: an integer in `1..8192` estimated tokens (default 1600). Activation and reads never write settings or migrate data. Operation keys are retained up to 512 receipts, without eviction. Bounds also include 1..64 atoms, 256 requests, 512 observations and 256 KiB canonical owner state. A bound stops progress with explicit outstanding obligations.

## Without git

Every domain command works in a plain SDK-initialized tracker with Git absent from PATH. Native items, links, comments, history, locking and revisions remain host-owned. No repository, shell, service or side database is required. Development identity checks and release automation require Git; they are separate from the domain protocol.

## Privacy

Text is inert data. New submissions refuse ANSI/control and bidi sequences, malformed Unicode, prototype keys, oversized inputs, absolute home paths (including resolved home aliases on Fedora Atomic/macOS and Windows profiles exposed through WSL mounts, Git Bash, Cygwin or Docker Desktop, plus Linux homes reached through WSL UNC) and credential-shaped text. Admission, corpus and tracked-file checks share a linear lexical path classifier; SDK secret scanning adds credential checks. Public URLs and relative paths remain data. The checks are heuristic, not proof that text is shareable; lexical normalization does not inspect filesystem links. Legacy structured records remain readable; rendering escapes unsafe controls. Default packets omit source bodies. Correction does not erase native history; retention, redaction and deletion use the host's supported policy. Only public fixture inputs are used in the proof corpus.

## Evidence and limitations

See [real-data evidence](docs/real-data.md) and its [machine-readable receipts](docs/real-data-receipt.json) for frozen public historical sources, original/reduced atoms and bytes, reservations, actual executions, cache hits, independent checks, interruptions and packet costs. Two distinct Jev defects and the Beads precision defect are reproduced against original function excerpts; no synthetic defect is inserted. The CSV lead described a feature, so it is not counted as a reproduced failure.

| Public reproduction | Atoms | Reserved / actual trials | Packet / raw estimated tokens |
| --- | --- | --- | --- |
| beads-precision | 16 → 1 | 8 / 10 | 826 / 3800 |
| jev-unicode | 16 → 1 | 8 / 10 | 819 / 3756 |
| jev-utf8-budget | 16 → 1 | 6 / 8 | 826 / 1424 |

A certificate says `one_minimal_under_recorded_oracle` only when a witnessed failing candidate has an explicit passing witness for every single-atom deletion. `empty_target_failure` makes no atom-cause claim. Missing, conflicting or unresolved evidence yields a qualified incomplete result. None of these establish a globally smallest input, a root cause or a future reproducibility guarantee.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Completed domain result; unknown/incomplete states remain explicit in data |
| 2 | Invalid input/record/version/capacity, domain guard or output budget |
| 3 | Selected authorized owner absent |
| 4 | Revision, operation, proposal or cursor conflict |
| 5 | Unsupported backend, permission, incomplete read, I/O or unknown write outcome |

Native expected host errors retain their native exit code; the table maps package-generated refusals.

After an ambiguous I/O failure, read the owner and reconcile the original operation key. Never infer non-commit from a missing response. Replaying the identical original request either finds its committed receipt or attempts the original guarded operation; a changed payload refuses `operation_conflict`.

## Development

```sh
npm ci
npm run release:check
bun run release:check
npm run test:real-data
```

The release gate includes full production-source coverage at 100% statements, branches, functions and lines, typecheck, ESLint, docstrings, zero duplicate token blocks, native health, identity/privacy, pack allowlist, production audit, changelog, attestation, packed npm/Bun consumers and disposable behavioral reverts. CI callers and identity policy follow the fleet scaffold. Scheduled release requires `vars.PM_RELEASE_APPROVED == 'true'`; no publication is authorized for this candidate.
