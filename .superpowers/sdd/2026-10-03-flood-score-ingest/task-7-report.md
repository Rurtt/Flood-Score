# Task 7 implementation and local acceptance report

Implemented `ingest/reality.ts`, its three brief tests, the public anon-key overview CLI, and `npm run reality-check`. Corrected only the header comment in `ingest/run.ts` to describe today and two previous Bangkok calendar days; runtime window code is unchanged. Fixed spike rank bands remain unchanged.

## TDD evidence

- RED: `node node_modules/vitest/vitest.mjs run ingest/reality.test.ts` failed with exit 1, cannot find `./reality.ts`, before implementation (2026-10-03 19:12 Bangkok).
- GREEN: the same targeted command passed all three tests after implementation (19:13 Bangkok).
- Tests cover the accepted ranking, two individually broken rules, a missing high district, and an out-of-band middle district.

## Scope and environment

Used Node v24.11.1 and the installed npm CLI explicitly because the native npm shim is broken. Before database mutation, parsed `.env.ingest` URL and confirmed `http://127.0.0.1:54321` loopback. Credentials were never printed; private report fields were neither logged nor stored. Kept the pre-existing real rows and areas; no database reset. Production has no owner account yet, remains unverified, and no production operation was attempted. The controller owns final review, push, draft PR, and CI.

## Independent source acceptance

A separate HTTPS request to the actual public Traffy historical endpoint with flood filter, inclusive Bangkok dates 2021-01-01 through 2026-10-03, offset 0 and limit 1 returned success and **42,540 total** at **2026-10-03T12:13:43.702Z**. The request logged only status, total, and observation timestamp; it did not retain or print features. The pipeline uses pages of 1,000 and de-duplicates ticket identities. Live totals can change during pagination.

## Historical backfill and persisted acceptance

`npm run backfill` completed in **920 seconds** with process exit **0**, status **partial**, **42,539 rows upserted**, **1 rejected**, and the exact bookkeeping message `got 42540 of 42545 features Traffy reported`. The live API total increased from the independent starting 42,540 to the pipeline's final 42,545 while offset pagination was in progress. This is a partial fetch, not a complete snapshot; the five-feature shortfall is explicitly retained rather than relabeled as success. One invalid feature was rejected by the existing privacy-preserving validation; no rejected payload was logged.

Immediately after historical ingestion:

| Aggregate | Measured value |
| --- | --- |
| Persisted Traffy rows / unique `(source, source_id)` | 42,539 / 42,539 |
| Rows assigned a district / subdistrict | 42,505 / 42,505 |
| Districts represented | 50 |
| Unassigned rows | 34 (0.080%) |
| Earliest Bangkok report date | 2021-09-16 11:29:54 |
| Latest Bangkok report date | 2026-10-03 19:12:29 |
| Coverage of independently observed starting total 42,540 | 99.998% |
| Coverage of final pipeline source total 42,545 | 99.986% |

Both source comparisons meet the within-5% acceptance criterion; the September 2021 historical start and district coverage also pass. No second historical backfill was run.

## Real-data measurements

Committed boundary reload used the existing `npm run load-areas` entry point. Timings include RPC round trips where labeled; SQL measurements use psql `\timing on` on the populated database. These are observed local runtimes, not production guarantees.

| Measurement | Actual value |
| --- | --- |
| `load_areas`, 230 areas (50 districts + 180 subdistricts), RPC | 17,400 ms |
| `refresh_score_reference`, RPC after boundary reload | 2,479 ms |
| Standalone SQL `refresh_score_reference()` | 2,407.020 ms |
| SQL `flood_score_v1(13.7167, 100.695)` | 4.029 ms |
| SQL overview with `octet_length(...::text)` and `length(...::text)` | 669.211 ms |
| Overview UTF-8 octets / PostgreSQL characters | 128,031 bytes / 127,283 characters |
| Reference grid / nonzero overview cells | 6,326 / 4,492 |

Database UTF-8 `octet_length` measures bytes; JavaScript UTF-16 character length was not used. The score returned 76/high, district and subdistrict ประเวศ, 8 reports, version 1, 6 years covered and 4 years with reports. Refresh is far below the 60-second stop rule and 120-second cap; score is below 2 seconds.

## Fixed-band reality acceptance

`npm run reality-check` used the LOCAL anon/read key in gitignored `.env.local`, printed the true top ten, and returned `spike check passed`, exit 0. No rank thresholds or bands were changed.

| Spike district | Actual rank | Fixed requirement |
| --- | --- | --- |
| ประเวศ | 1 | top 15 |
| ลาดกระบัง | 3 | top 15 |
| บางเขน | 6 | top 15 |
| หนองจอก | 9 | top 15 |
| มีนบุรี | 10 | top 15 |
| บางนา | 18 | 11–39 |
| ธนบุรี | 37 | 36 or lower |

Actual top ten in order: ประเวศ, บางกะปิ, ลาดกระบัง, สะพานสูง, สวนหลวง, บางเขน, บึงกุ่ม, จตุจักร, หนองจอก, มีนบุรี. Neither the refresh stop condition nor the fixed-band failure condition was triggered.

## Hourly catch-up and final preservation check

After the populated full checks, the controller requested one LOCAL hourly catch-up for source arrivals during backfill. `npm run ingest` returned **ok**, exit **0**, **1,596 upserted**, **0 rejected**, inclusive dates 2026-10-01 through 2026-10-03. Persisted elapsed time was **16.463037 seconds**. This added **six net unique historical-table identities**: final Traffy count and unique count are both **42,545**, assigned district/subdistrict **42,511**, represented districts **50**, earliest Bangkok timestamp unchanged **2021-09-16 11:29:54**, latest **2026-10-03 19:30:14**. The table contains only source `traffy`; integration fixtures were cleaned up. Grid counts remain **6,326 / 4,492 nonzero**. The prior partial run remains persisted with its exact reason; the latest run is ok. The anon reality CLI was repeated after catch-up and passed with the same top ten.

Final count equals the historical pipeline's observed final total of 42,545, and is 100.012% of the independently observed starting total 42,540 (new arrivals explain the small excess). This proves aggregate within-5% acceptance; equality to an earlier live total is not a claim of a frozen API snapshot or proof of every individual source identity.

At controller request, amended `docs/production-setup.md` Step 6 to require inspection of a partial cause, live source-total/count acceptance and successful hourly catch-up for this observed live-arrival case. Failed runs, coverage below 95%, or unexplained partial causes block acceptance. This does not declare partial runs universally acceptable or change any threshold.

## Full verification and limitations

- `npm run lint`: PASS after all TypeScript changes.
- `npm run typecheck`: PASS, Next type generation and `tsc --noEmit`.
- Full Vitest with `.env.ingest` explicitly loaded: **7 files / 59 tests PASS**, including **all three live loopback-guarded store integration tests** (no skipped integration tests), 5.84 seconds. Fixture cleanup confirmed by final source aggregates.
- Populated LOCAL `supabase test db`: **5 files / 95 pgTAP tests PASS**. Transactional truncate fixtures roll back and preserve real reports/areas; no reset and no empty-database `.mjs` area regression was run.
- LOCAL security advisor `db advisors --local --type security --fail-on warn`: PASS, no issues, empty results.
- LOCAL generated types: **byte-exact match to `HEAD:lib/database.types.ts`, 9,890 bytes**, using captured CLI stdout and Git blob. The Windows checkout is CRLF (10,136 bytes); its only difference from CLI LF output is 246 carriage returns. Initial normalized-content comparison also passed. No schema/type edits were needed.
- One initial CLI invocation used a nonexistent old `node_modules/supabase/bin/supabase` path; it failed before running checks. Corrected to the installed `node_modules/supabase/dist/supabase.js` and all advisor/type checks above completed successfully.
- Full checks ran on the populated historical database before the catch-up; catch-up changed data only, so the controller directed no redundant full-suite repeat. Post-catch-up aggregate and public reality checks confirmed preservation.
- Final branch review, push, draft PR and GitHub CI belong to the controller and are pending. Local results do not claim GitHub CI or production verification. No production account/project exists and no production operations were attempted.
