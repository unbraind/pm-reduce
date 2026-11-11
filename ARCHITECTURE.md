# pm-reduce architecture

## Native records and trust

One `Reduction` item in `reductions` owns one `reduce_state` object, schema version 1 and algorithm `ddmin-1`. Extension activation registers the type, field, renderers and six commands. Directory SDK creation explicitly provisions missing native schema definitions without replacing peer definitions. Reads have no schema, settings or migration side effects.

The definition freezes ordered unique atoms, composition, original digest, deterministic oracle identities, trial ceiling and optional predecessor snapshot. Atom payloads are never stored or loaded. Source references are independent captured snapshots, not a cross-item atomic read or proof of current freshness. Related links join the investigation; source items, statuses, claims and core assurance verdicts remain unchanged.

Requests contain ordered subset IDs, payload-bound subset digest, oracle digest, purpose, deterministic cursor and pending/completed state. Observations retain request identity, exact external result contract, actual signature, reason, immutable evidence reference, timestamp, recorder and reported/verified evidence classification. Native audit comments accompany the same state mutation. Submitted attribution is not authentication. A host-owned trusted verifier may attest immutable evidence; it is separate from oracle execution.

Replay receipts retain every accepted operation key, normalized semantic request digest, immutable result identity and result digest. Transport budgets are excluded from semantic identity; identity normalization uses the native host prefix policy on both writes and comparisons. Original revision guards remain part of mutation identity. This permits a larger output budget on retry without silently accepting a different write.

## Deterministic reduction

The pure kernel replays the complete journal rather than trusting a mutable work queue. It first proposes the original full input. Only a matching completed target-fail witness permits search. A pass stops as `baseline_not_failing`; an unresolved result stops as `baseline_unresolved`.

The search is ddmin-style ordered subset/complement partitioning. Starting with two partitions, probe each contiguous chunk, then each complement in stable order. Accept a smaller candidate only on a cached target failure. After reduction decrease granularity toward two; otherwise double it up to the current candidate size. No monotonic-failure assumption is used. Exact subset outcomes are cached under the frozen oracle and original ordered atomization. Unresolved attempts skip a search probe without becoming passing evidence.

Finally enumerate every single-atom deletion explicitly, including the empty subset for a singleton. Cached passes are reusable; missing obligations become proposals. A failing empty subset is retained as `empty_target_failure`. No AST rewriting, grammar repair, dependency addition, input reordering or hidden payload editing occurs. Structurally invalid subsets remain unresolved.

The algorithm follows established delta debugging ideas; see [The Debugging Book](https://www.debuggingbook.org/html/DeltaDebugger.html). The package contribution is a durable agent workflow, not a new minimization algorithm. Alternative algorithms, stochastic statistics and automatic oracle runners remain separately tracked future scope.

## Trial journal and concurrent writers

`next` is a read-only proposal. `request` recomputes its candidate and revision-bound digest, then consumes one native reservation before the caller executes. There is at most one pending request. `record` accepts a submitted outcome only for an existing reservation, matching subset and every frozen oracle identity. A conclusive verdict requires explicit completion; failure signatures must match exactly. A different failure is unresolved, never pass.

Each existing-owner mutation reads the selected owner, checks an identical replay before rejecting stale revision, derives the entire next state, validates capacities and output budget, then calls native `withExpectedItemRevisions([{id,itemHash}], update)`. The callback updates only `reduce_state` plus a fixed audit comment. The owner must be checked with no unchecked guards. The package uses no mutex, get-then-unconditional write or silent retry/rebase. Two native writers cannot both consume the same reservation slot.

Creation requires the host normalizer or an explicit native `idPrefix`, then uses the canonical explicit ID and native create-if-absent. A host with neither policy refuses before provisioning or writes. Duplicate recovery validates native type, package/schema, frozen definition fingerprint and original creation request before adoption. Compatible field registrations are preserved. Unsupported native guarantees refuse before effects. A dishonest or failing provider is not certified by having method names; embeddings must supply trustworthy capability evidence.

Native history and operation receipts are append-only. Read validation checks record relationships, cardinality, unique identities, reservation counts, frozen definition and immutable result fingerprints, and independently recomputed projections. Arbitrary historic text is not retroactively rejected by a new privacy classifier. There is no migration in v1; future migrations require explicit guarded writes.

## Interruption and resume

Durable boundaries are create, guarded reservation, guarded observation and receipt delivery. Test-only host boundary callbacks make every before/after interleaving observable; they are never authoritative state. Process tests interrupt before guard/update, after commit, and before receipt. Same-key retry finds the original committed identity or performs the still-uncommitted original write. A lost response never proves non-commit. Arbitrary host failure maps to `outcome_unknown` with a reconciliation remedy.

The external effect belongs to the caller. A pending request after execution but before record stays pending, even after a fresh process reads it. The caller must retain/reconcile its external result. Deliberate re-execution is another observation under the same request. Recording is deduplicated; externally exactly-once execution is impossible to promise.

If any exact cache identity has both pass and target-fail evidence, reuse is suspended globally as `flaky_oracle`. The best recorded failure remains visible with that qualification. No majority vote or automatic recovery invents determinism; review the oracle and create a new scoped owner.

## Minimality qualification

The certificate checker reconstructs all witnesses independently from observations. A valid certificate hashes the owner identity, algorithm version, full frozen definition, all reservations and complete observation contents, including evidence references and attribution; it binds the complete witness set by digest and includes the best subset, failing observations, every single deletion's exact subset digest, pass witness IDs, observed status and all missing deletion IDs. Supplying a claimed certificate requires exact canonical equality with this independently reconstructed receipt.

`one_minimal_under_recorded_oracle` requires a matching failing witness and explicit passes for all single deletions, with no pending or conflicting verdicts. Unknown, invalid, timed-out, missing or unreachable results cannot fill a deletion obligation. Empty failures have a separate non-causal label. Qualification is relative to the declared atomization, original order and recorded oracle. It does not establish a globally smallest input, root cause, authenticated testimony, exhaustive subset search or future reproduction.

## Output, completeness and limits

Selected-owner reads request full SDK output and require the native revision. There is no workspace discovery; no partial list is interpreted as complete. Enumeration would require the SDK certified complete-list API and an explicit exclusion receipt.

Every command returns the common versioned producer envelope with selected-owner completeness, full-output status, exact page counts, continuation, warnings and evidence/byte-estimate receipt. Default budget is 1600 estimated tokens, `ceil(final UTF-8 bytes/4)`, not provider usage. The host fitter measures both exact registered serializers, including native fitting metadata. Every page has a 32 KiB ceiling. Mandatory identities, negative/unknown states and proof qualifications are never compacted. A verified minimum-budget refusal gives the same query's usable budget; a null minimum requires narrowing the query.

Writes precompute their complete receipt envelope before mutation. CLI dispatch uses the same API preflight. Package budget/cursor/limit flags avoid host producer-transport limitations without shadowing native flags. Duplicate transports and generic projections refuse. Final rendering detects native compaction and escapes unsafe legacy controls. TOON quotes string values before escaping, preserving decoder round trips. If refusal fitting itself fails, dispatch returns a fixed bounded refusal independently of that fitter. Packed consumers validate actual TOON/JSON bytes rather than assuming that the native transport preserves producer receipts.

Packets retain summary obligations and a certificate digest while paging observation rows. A cursor binds owner ID/revision, query page size and journal order; stale or changed queries refuse. Returned plus omitted equals the frozen total, including observations on earlier pages. Certificate detail remains complete or refuses its budget; paging never weakens its qualification.

Limits: 1..64 atoms, 255 requests, 512 observations, 512 operation receipts and 256 KiB canonical owner state. These independent limits can stop progress before the declared trial budget is exhausted. Reservations, certification and deliberate repeats all count. Every write retaining a pending trial reserves one completing receipt and 32 KiB for its maximum valid observation and projection growth. This headroom is retained even when extra observations target older completed requests. Legacy journals remain readable; near-capacity owners refuse new work before the oracle runs. The first exceeded limit refuses before effects; no pruning evades limits or loses deduplication identity. Oracle source/recipe/atom changes require a new owner and fresh baseline.

## Backend and privacy boundaries

Directory trackers and an injected native-client contract are tested in plain non-git directories. The domain path imports no Git, process, filesystem, network, model or database execution capability. Host storage and authorization remain host-owned. Other backend implementations require separate conformance evidence before advertising support.

The SDK privacy scanner checks new submitted text. Additional JSON, Unicode, control/bidi, prototype-key, depth and size guards run before effects. Traversal has a 32768-visit ceiling, including repeated visits through shared object graphs; cycles and nesting beyond sixteen levels still refuse. Raw payloads never enter authoritative state; references and digest labels remain data. History is retained through correction; erasure/redaction/retention uses host policy. Public corpus acquisition is frozen to reviewed public files, commits and MIT source excerpts, with a syntax-level read-boundary guard and content hashes. Synthetic controls are separate from the three historical failure reproductions.
