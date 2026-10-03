# Production setup

No production project exists yet. The owner performs the steps below after review and CI pass. This guide sets up ingestion and database operations; the website UI remains separate Plan 3 work. Production readiness is unverified until these checks run against the owner's project.

1. Create a separate Supabase production project in Singapore. Save the project reference, database password, API URL and backend service-role/secret key securely, and create a Supabase personal access token. Never paste credentials into chat or commit them.
2. Add repository Actions secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. The backend key belongs only in Actions secrets or a developer's gitignored `.env.ingest`. The website and public checks use the separate read-only key through `SUPABASE_RPC_KEY`; never use the backend key in Vercel or a `NEXT_PUBLIC_*` variable.
3. Review and merge the implementation to the repository default branch once CI passes. Both production jobs permit only that branch. All database writes share the `production-database` concurrency queue, retain up to 100 pending jobs, and do not cancel a running job. Inspect queued jobs before requesting additional work.
4. In **Actions → DB push (prod) → Run workflow**, select the default branch. Confirm migrations and the security advisor complete successfully. This workflow is manual only. Do not ingest before migrations pass.
5. In **Actions → Ingest → Run workflow**, choose `load-areas`. Confirm 230 boundaries (50 districts and 180 subdistricts) and a successful score-grid refresh. The committed boundary data is used directly.
6. Dispatch Ingest with `backfill`. Confirm `status: ok`, small rejection counts and no failed run. Compare persisted unique report count with the actual source total measured by the Task 7 acceptance check (within 5%); do not use a historical fixed report count. Save the run evidence. Backfill can take several minutes; the workflow timeout is 30 minutes.
7. Run the public reality-check script supplied by Task 7 using the production URL and read-only key. Keep the established district rank bands unchanged if it fails, and investigate the data and formula. This check must pass before declaring database acceptance.
8. Verify the next scheduled hourly run and its persisted `ingest_runs` record. Compare repeat counts to confirm upserts remain idempotent. GitHub schedules can be delayed, especially at the start of the hour; schedules run from the default branch and public repository schedules are disabled after 60 days without repository activity. Re-enable under Actions when necessary.

## Operations and checks

Hourly ingestion re-fetches today and the two previous Bangkok calendar days, with inclusive start and end dates; this covers more than an exact rolling 48-hour interval. Successful and partial runs exit 0; **inspect the JSON output and `ingest_runs` even for green jobs**. Failed runs or startup/bookkeeping errors fail the job. Configure GitHub Actions notifications for the owner; email delivery depends on account notification settings.

Actions pin checkout and setup-node to reviewed commit SHAs and use the lockfile for dependency installation. Production credentials are scoped to database execution steps, after dependency installation and the runtime audit. CI and production workflows gate on `npm audit --omit=dev --audit-level=high`.

The inherited development dependency chain through `eslint-config-next` currently contains five high-severity audit findings tied to the unpatched `braces <=3.0.3` denial-of-service advisory. Runtime audit reports zero vulnerabilities. Keep tooling inputs trusted, review dependency changes, and recheck the development audit for a compatible upstream fix. Do not downgrade Next to npm's suggested older major or claim the full dependency tree is clean. [Advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

Never run the isolated empty-database RPC regression against production. Do not disable RLS, grants, safeupdate or advisor warnings to force deployment. A failed migration or incomplete ingestion requires investigation before further queued operations.

Primary references: [Supabase API key security](https://supabase.com/docs/guides/getting-started/api-keys), [GitHub Actions secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions), [scheduled workflow caveats](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [concurrency queues](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency).
