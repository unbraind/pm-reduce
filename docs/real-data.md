# Public historical reproduction evidence

The caller harness in `test/corpus.ts` executes frozen MIT-licensed public function excerpts. The production package only reserves trials and records their reported outcomes. Source acquisition was restricted to the exact public repositories, commits and files in `test/fixtures/provenance.json`; the frozen fixture and each function excerpt have SHA-256 checks. No private repository or tracker is read.

| Reproduction | Atoms | Bytes | Reserved / actual trials | Target fail / pass / unresolved | Resumes | Packet tokens | Raw tokens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| beads-precision | 16 → 1 | 15198 → 87 | 8 / 10 | 6 / 4 / 0 | 5 | 826 | 3800 |
| jev-unicode | 16 → 1 | 15021 → 6 | 8 / 10 | 6 / 4 / 0 | 5 | 819 | 3756 |
| jev-utf8-budget | 16 → 1 | 5695 → 355 | 6 / 8 | 6 / 2 / 0 | 5 | 826 | 1424 |

All three end with `one_minimal_under_recorded_oracle`. Each independent final check reproduces the failure, and an independent empty-deletion check passes; both extra executions are recorded under their original reservations. Actual executions exceed reservations because these independent checks are deliberate repeated observations. Cached probes do not execute the oracle.

- [beads-precision](https://github.com/unbraind/pm-beads/blob/70cd5d87251d1971d8cbd8bbd01872bdb6b8a28d/repair.ts): 8 cached probes at the final replay; 2 independent checks; 3303 delivered packet bytes versus 26331 bytes for the complete native owner log. Ten independently derived resume answers agree. Total measured deliveries: 290940 bytes across 80 results, including 198480 raw SDK snapshot bytes and 13398 auxiliary SDK bytes. Trial-loop latency after creation: 4407 ms.
- [jev-unicode](https://github.com/unbraind/pm-jev/blob/78b01cb0690026a79832f460d4a4f40b6bb5bd98/exemplar-retrieval.ts): 8 cached probes at the final replay; 2 independent checks; 3275 delivered packet bytes versus 26335 bytes for the complete native owner log. Ten independently derived resume answers agree. Total measured deliveries: 290600 bytes across 80 results, including 198816 raw SDK snapshot bytes and 13214 auxiliary SDK bytes. Trial-loop latency after creation: 3319 ms.
- [jev-utf8-budget](https://github.com/unbraind/pm-jev/blob/78b01cb0690026a79832f460d4a4f40b6bb5bd98/exemplar-retrieval.ts): 6 cached probes at the final replay; 2 independent checks; 3301 delivered packet bytes versus 22422 bytes for the complete native owner log. Ten independently derived resume answers agree. Total measured deliveries: 222772 bytes across 66 results, including 144370 raw SDK snapshot bytes and 10732 auxiliary SDK bytes. Trial-loop latency after creation: 2413 ms.

All token counts use ceil(UTF-8 bytes / 4), not provider usage. Packet cost includes the larger of the complete JSON/TOON serializations and native fit metadata. Each packet is below 1600 estimated tokens and uses over 50% fewer delivered bytes than the complete manual owner journal. Raw input is counted separately; it is not substituted for the manual trial log denominator.

The Beads trigger is the public beyond-2^53 numeric lexeme from the repair precision regression, combined with 15 irrelevant public fixture rows. The historical `editedText` and its actual helper functions round-trip that number. Atom materialization preserves row order and bytes. Jev's Unicode token-loss and UTF-8 exemplar-budget overflow are two distinct historical defects fixed in the same public commit; their original functions are executed unchanged with the public Unicode regression triggers expanded to sixteen independent atoms. No synthetic defect is inserted. The suggested CSV lineage item describes a feature and is not counted as a historical failing oracle.

These are three reproductions across two public packages. They do not claim three independent repositories, a workload survey or authenticated external testimony. Five pending-result handoffs are exercised per reproduction. Separate OS-process tests crash before and after native guard/update and receipt boundaries, including external completion before record. Synthetic baseline-pass, unresolved/unreachable-artifact, wrong-signature, nonmonotone, conflicting and empty-failure controls are reported only in tests and never counted as public reproductions.

Reproduce offline from the frozen excerpts with `npm run test:real-data`. Full source provenance, input digests, witness digests, observed outcomes, trial identities, exact denominators and timing are in `docs/real-data-receipt.json`. The package never launches this harness itself.

Packed acceptance captures one archive, checks its digest and allowlisted contents, and installs those bytes into fresh npm and Bun projects. Each project runs npx or native Bun bunx with Git absent plus SDK imports. Archive substitution and ignored-distribution mutation are tested against the fleet release handoff. The actual candidate archive is local ignored data; only text evidence belongs in Git.

The receipt also retains each complete reduction snapshot, its independently checked certificate, and caller-owned immutable oracle-result descriptions with exact native source references. Recipe, result-schema and runtime-environment identities are frozen separately. Total delivery counts measure the larger full JSON/TOON command envelope and raw SDK deliveries used by this local caller; they are not network traffic or provider-token usage.

Cache-hit counts describe the final deterministic `next` replay, not a lifetime counter or a claim about external executions saved. Latency measures the trial loop after owner creation. Baseline reproduction itself is reserved and recorded before the kernel admits any smaller candidate.
