# Task 5 implementation report

Implemented the prescribed Store/runIngest APIs, reject threshold, successful batch counts, conditional refresh, terminal run bookkeeping, typed Supabase upserts, Bangkok windows and 2000-character error cap. Only Task 5 files and this report are included in the commit.

## RED evidence (actual)

Command: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run ingest/pipeline.test.ts ingest/store.test.ts`

```text
RUN v5.0.3 D:/Easy website
FAIL ingest/pipeline.test.ts
Error: Cannot find module './pipeline.ts' imported from D:/Easy website/ingest/pipeline.test.ts
FAIL ingest/store.test.ts
Error: Cannot find module './store.ts' imported from D:/Easy website/ingest/store.test.ts
Test Files 2 failed (2)
Tests no tests
```

Both tests were written before their implementation files.

## GREEN evidence (actual)

Same focused command, after implementation:

```text
RUN v5.0.3 D:/Easy website
Test Files 2 passed (2)
Tests 13 passed (13)
Duration 2.44s
```

Full command: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run`

```text
RUN v5.0.3 D:/Easy website
Test Files 6 passed (6)
Tests 56 passed (56)
Duration 2.33s
```

`node node_modules/eslint/bin/eslint.js`: exit 0, no output.
`node C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run typecheck`: exit 0:

```text
> flood-score@0.1.0 typecheck
> next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully
```

## Coverage and decisions

Ten pipeline tests cover 500/500/200 batches, successful bookkeeping, over/exactly 20% rejection, partial/empty responses, failed fetch closure, second batch failure with retained rejection counts, refresh failure with written counts, and start/finish failure propagation. The brief's single 1200-feature page would violate Task 4's 1000-feature envelope; the mock now slices by the actual URL offset into valid pages. Fetch errors follow Task 4's sanitized `Traffy fetch failed after 4 attempts` contract rather than the brief's obsolete ETIMEDOUT expectation.

Three store integration tests actually executed against the existing loopback local Supabase. Each run uses UUID report IDs; cleanup restricts source=test AND the two exact IDs and exact created run IDs, with cleanup errors checked. There was no reset, boundary reload or broad source=test cleanup. The integration suite refuses non-loopback URLs before opening a client and fails if CI lacks its required credentials; absent local credentials may still skip intentionally.

## CI rationale and validation

Installed CLI `start --help`: "Start containers for Supabase local development." Installed CLI `db start --help`: "Starts local Postgres database." Therefore CI uses full `supabase start` to provide PostgREST/API access, keeping startup stdout in /tmp to avoid printing local credentials. Status output is captured with shell fail-fast; API_URL, SERVICE_ROLE_KEY and ANON_KEY must all exist. Local keys are masked before writing service credentials to GITHUB_ENV. The actual installed `status -o env` fields were verified without printing values:

```text
API_URL: present, quoted env format
SERVICE_ROLE_KEY: present, quoted env format
ANON_KEY: present, quoted env format
CI YAML parses
```

After export, CI runs `node supabase/tests/areas-load-rpc.mjs` on its fresh empty database before Vitest, then preserves pgTAP, advisor and generated-types checks. The regression was not executed against the populated local database because its empty areas/reports precondition is intentionally incompatible. Its RED/GREEN evidence belongs to Task 2. CI YAML parsed successfully with installed js-yaml.

## Concerns and limits

The full fresh GitHub Actions job was not run from this workstation; startup semantics, status format, YAML syntax and actual local API integration were verified separately. Start/finish bookkeeping errors deliberately propagate; failed data/refresh work returns failed with only acknowledged batch counts. An ambiguous network failure after a database commit cannot establish exact server-side writes; idempotent source/source_id upserts allow safe replay. Refresh updates the global score reference using current reports; test rows/runs are removed exactly, and the existing real boundaries/grid are preserved. Task 6 audit/dependency policy is out of scope.
