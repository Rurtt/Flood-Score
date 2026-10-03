# Plan 2 results — 2026-10-03

Plan 2 ingestion and database work is implemented on `codex/ingest`, following the approved design and plan with sequential implementers and independent task reviews. Production setup is owner-operated: no production Supabase project exists yet. See [production setup](production-setup.md). Plan 3 API/UI remains unimplemented; the current Next pages are placeholders.

## Local acceptance

The local Supabase database contains 42,545 unique Traffy reports, with 42,511 assigned district/subdistrict pairs covering all 50 districts. The remaining 34 reports are outside the boundary assignment. Committed OSM polygons contain 50 districts and 180 subdistricts. Reports span 2021-09-16 11:29:54 to 2026-10-03 19:30:14 in Bangkok time. Reference grid: 6,326 cells, 4,492 with positive scores.

The 920-second historical backfill retained status `partial`: 42,539 upserted, one rejected, with `got 42540 of 42545 features Traffy reported`. The public source grew during offset pagination. Coverage was 99.986% of the observed final source total, above the approved 95% minimum. A subsequent hourly catch-up succeeded: 1,596 upserted, zero rejected, 16.463 seconds. Final unique count was 42,545. This proves aggregate acceptance, not a frozen source snapshot or identity-by-identity completeness. The partial run and its reason remain visible.

| Local measurement | Result |
| --- | --- |
| Reload all 230 boundaries via RPC | 17,400 ms |
| Refresh via RPC / SQL | 2,479 / 2,407.020 ms |
| Point score SQL at (13.7167, 100.695) | 4.029 ms |
| Overview SQL | 669.211 ms |
| Overview UTF-8 size | 128,031 bytes |

These are local measurements, not production guarantees. The point returned score 76/high, eight reports, six years covered and four years with reports.

Reality bands passed unchanged via the public anon RPC: ประเวศ 1, ลาดกระบัง 3, บางเขน 6, หนองจอก 9, มีนบุรี 10, บางนา 18, ธนบุรี 37. Catch-up preserved the same result.

## Verification

- Final integrated tree: 59 Vitest tests in seven files pass, including all three live local REST store tests; no integration skips. Production Next build passes.
- Populated local database: 95 pgTAP tests in five files pass; security advisor has no warnings; generated TypeScript matches the committed 9,890-byte LF blob exactly.
- Lint and typecheck pass. Runtime dependency audit reports zero vulnerabilities.
- Actual two-session advisory-lock probe demonstrated refresh serialization; actual PostgREST boundary loader exercised `pg_safeupdate` protections. The durable fresh-database RPC regression runs in CI before store fixtures.
- Actual CI export block tested with fake credentials: all-present exits 0; each missing field exits 1 before masking/export; CLI failure propagates exit 7.
- Real boundaries, historical reports and ignored local credentials were preserved. Production operations were not attempted. GitHub CI and final branch review are recorded separately when available.

Five high development-tool dependency findings remain in the inherited `eslint-config-next` → glob → `braces` chain. At verification time the [upstream advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) has no patched version. This is a development glob-parser denial-of-service risk; runtime audit is clean. Production workflows scope secrets to execution steps, use runtime installs for ingest, and gate high runtime vulnerabilities. Do not claim the full dependency audit is clean.

## Decisions made during execution

The execution ledger records the exhaustive decisions and their costs below. No final findings have been silently discarded. Review reports remain recoverable in Git history after scratch cleanup.

- Ruling: Continue in the existing checkout on a feature branch, as the inherited handoff prescribes, preserving all untracked handoff and visual assets. Existing node_modules and local Supabase are reused. Cost if wrong: weaker filesystem isolation; agents implement sequentially.
- Ruling: User's request to execute Plan 2 approves the existing written spec, existing plan and subagent execution. No repeat design gate. Cost if wrong: plan changes may need rework.
- Ruling: Production setup remains owner-operated; do not create accounts, configure production secrets or apply production migrations. Prepare a concrete deployment guide.
- | 5 | Pipeline mock sends 1200 features on single page | Ruling: fix fake paging to respect 1000-row limit; production may reject oversize pages. Cost if wrong: test changes only |
- Ruling: Correct Task 1 timeout test from ANY(subquery) to ANY(pg_proc.proconfig) with FROM pg_proc; original supplied SQL raises malformed array literal and cannot test the timeout. Cost if wrong: test syntax adjustment only.
- Ruling: Task 2 must reject null/non-array/empty boundary payloads before replacing areas; serialize loaders with refresh and exclude concurrent report writes during replacement using normal table locks in consistent order. Original template accepts null/empty arrays and races concurrent replacement. Cost if wrong: a deliberately empty boundary reset becomes unsupported, which production does not need.
- Ruling: Task 4 rejects non-null invalid finished_at rather than silently discarding invalid timestamps; unique rejected ticket IDs must not inflate completeness/reject-rate on shifted pages. Preserve anonymous invalid row counting. Cost if wrong: more malformed source rows are rejected, tracked by existing rejection threshold.
- Ruling: Task 6 pins actions/checkout@v4 and actions/setup-node@v4 to verified official full commit SHAs, restricts production workflows to the default branch, and serializes ingest/load/backfill and db-push through one production database concurrency group. Use supported queue:max to retain up to 100 pending runs; cancel-in-progress:false alone replaces previous pending runs. Cost if wrong: manual non-default-branch production runs are skipped, action updates require deliberate SHA maintenance. Official v4 refs verified by gh api: checkout 11d5960a326750d5838078e36cf38b85af677262, setup-node 49933ea5288caeca8642d1e84afbd3f7d6820020. Docs: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency
- Ruling: Add explicit WHERE to intended full boundary DELETE and report rederivation UPDATE; preserve atomic replacement and pg_safeupdate, do not disable database safety settings. Reapply amended function locally, test actual PostgREST RPC and SQL suite. Cost if wrong: none to intended row set; explicit full-table predicate documents replacement intent.
- Task 2 live fix evidence: original loader returns DELETE requires a WHERE clause; explicit predicates permit replacement and report rederivation through actual PostgREST. Durable local-only supabase/tests/areas-load-rpc.mjs added by implementer. Standard pgTAP postgres cannot LOAD safeupdate; supabase_admin can, but postgres cannot SET ROLE to it. Ruling: retain default database permissions; wire actual local RPC regression into CI in Task 5 after environment export. Cost if wrong: one small additional integration script; API hook behavior is exercised directly.
- Ruling: Do not blindly apply npm's suggested Next ESLint downgrade14.2.35. All5 high findings trace to dev-only braces<=3.0.3 stack-exhaustion advisory GHSA-vfj7-8cjw-p6xm; current braces latest3.0.3 and advisory has no patched version. Runtime audit --omit=dev returns0findings. Keep supported Next16 toolchain, document unpatched dev risk and isolate privileged workflow installs to runtime dependencies; add production audit gate in CI. Cost if wrong: dev lint tooling retains an upstream DoS risk from malicious nested glob patterns; upstream patch still needed. Final reviewer to independently assess exposure. Sources https://github.com/advisories/GHSA-vfj7-8cjw-p6xm and npm registry audit2026-10-03.
- Ruling: Pipeline tests expect Task4 sanitized fetch failure instead of original raw ETIMEDOUT string; preserve failure status/counted writes while avoiding uncontrolled upstream diagnostics. Cost if wrong: reduced failure diagnostic detail; retry count and safe error category documented.
- Ruling: Historical partial caused by live arrivals may satisfy approved>=95% source-count acceptance, while preserving partial record and requiring reason/count inspection and successful hourly catch-up. Never treat arbitrary partial/failed coverage as acceptable. Guide to reflect observed semantics. Cost if wrong: tiny paging race can miss older arrivals beyond the hourly window; count tolerance bounds acceptance, backfill record remains visible.
