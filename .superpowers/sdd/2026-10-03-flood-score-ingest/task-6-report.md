# Task 6 implementation report

Implemented hourly and historical entry points, npm scripts, hourly/manual ingestion workflow, manual production migration workflow, CI runtime audit and action pins, README usage, and `docs/production-setup.md`. Production operations remain owner-operated and unverified; no production project, external account, backfill, push or PR was created.

## Local live verification

Node v24.11.1 runs native `.ts` entry points (minimum supported Node 22.18). Used explicit npm CLI because the local npm shim is broken. Gitignored `.env.ingest` credentials were loaded without printing them.

| Measurement | First run | Second run |
| --- | --- | --- |
| Bangkok window (inclusive) | 2026-10-01 to 2026-10-03 | 2026-10-01 to 2026-10-03 |
| JSON status / process exit | ok / 0 | ok / 0 |
| JSON rowsUpserted / rowsRejected | 1589 / 0 | 1589 / 0 |
| Latest persisted status / upserted / rejected | ok / 1589 / 0 | ok / 1589 / 0 |
| Total persisted reports | 1589 | 1589 |
| Reports assigned a district | 1587 | 1587 |
| Distinct (source, source_id) | 1589 | 1589 |

The database started with zero real Traffy reports. Repeat ingestion retained exactly the same total and unique identities, demonstrating idempotence. Two reports remained outside assigned district polygons. No report payloads or private values were printed. Backfill is reserved for Task 7.

## Checks and workflow validation

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 6 files / 56 tests passed.
- `npm audit --omit=dev --audit-level=high`: passed, zero runtime vulnerabilities.
- `node ingest/run.ts` without env loading: failed with exit 1 and required-variable message, confirming native entry startup failure.
- Parsed all three YAML workflows with installed `js-yaml`; verified immutable action SHAs, runtime audit gates, production default-branch conditions, shared `production-database` group with `queue: max` and `cancel-in-progress: false`, execution-step-only production secrets, hourly cron and manual-only migration trigger.
- Executed the actual ingestion workflow Bash block in the local database container with a stub node command. `run`, `backfill`, `load-areas` each selected the expected script; `invalid` and `../db` exited 1 without executing node. Temporary validation script removed after use. Initial validation assertion incorrectly expected mapping form for scalar `on: workflow_dispatch`; corrected the validation to accept the valid scalar and reran successfully.
- `git diff --check`: passed. GitHub itself has not executed these workflows; no actionlint binary was available, so YAML and actual shell behavior were checked locally.

## Self-review and operational concerns

Window code follows the brief unchanged; documentation clarifies it includes today and two prior Bangkok calendar days rather than an exact rolling 48-hour interval. Partial ingestion exits 0 by design and requires checking logs and persisted run status. Missing env or bookkeeping failures naturally fail the process even before a run result is available.

Production writers serialize across ingestion and migrations, retaining queued work per the controller's current official GitHub documentation ruling. Branch conditions and the shell task allowlist protect the privileged execution boundary. Install/audit steps have no production credentials. Checkout and setup-node v4 commits use the controller-verified SHAs in CI and both new workflows.

The inherited dev tooling has five high-severity findings tied to unpatched braces <=3.0.3 via eslint-config-next; the guide records this risk and trusted-input controls. No misleading audit suppression or Next downgrade was applied. Runtime gate is clean. GitHub scheduling can be delayed and public schedules disable after 60 days of inactivity; notification email depends on the owner's settings.

The setup guide converts the earlier scratch draft into owner instructions aligned with actual workflows: migration, boundary load, historical load, public reality check, scheduled run. Historical acceptance and reality-check implementation belong to Task 7; full site UI remains Plan 3. These are explicit readiness limits, not claims of production acceptance.
