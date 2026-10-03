# Handoff (2026-10-03): Claude Code → Codex

Read this first, then `AGENTS.md`, the spec and the plan.

## Status

- Spec: `docs/superpowers/specs/2026-10-02-flood-score-design.md`
- Plan 1 (foundation): done, merged as #1 (`43f7463`).
- **Plan 2 (ingest): written, not started** — `docs/superpowers/plans/2026-10-03-flood-score-ingest.md`. Waiting for the owner's review.
- Plan 3 (API + UI): not written yet.

## How to execute Plan 2

- The plan header names a Claude skill (`superpowers:subagent-driven-development`). Ignore it; implement the tasks yourself, in order, one at a time.
- Branch: `git switch main && git pull && git switch -c feat/ingest`.
- Per task: write the test, watch it fail, implement, watch it pass, run the task's checks, commit. Do not skip a failing check.
- The "Facts verified" and "Global Constraints" sections are binding. Do not re-decide the "Deviations" (the owner approves them with the plan).
- Stop and ask the owner when: Task 7 refresh takes > 60 s, the reality check fails, or anything in Task 8 (prod accounts and secrets; the owner does it).
- Review the whole branch for security before opening the PR (RLS, grants, no service key outside `.env.ingest` / GitHub secrets).

## Environment gotchas (Windows)

- Docker Desktop must be running; local Supabase via `npx supabase start`.
- Git Bash rewrites paths: prefix `docker exec …` with `MSYS_NO_PATHCONV=1`.
- Passing Thai in a shell URL breaks encoding (Traffy answers `invalid byte sequence`); percent-encode it or use Node `URLSearchParams`.
- Node 24 locally, CI uses Node 22 (needs ≥ 22.18 to run `.ts` directly).

## Owner preferences

- Reply to the owner in Thai; keep technical terms in English.
- Priorities, in order: real-world use; lowest friction for users (no accounts, fewest taps); secure database (RLS, RPC-only reads, no keys in the browser); strong foundation (migrations, tests, CI). Never cut security or tests to save time.
- Prefer the simplest solution that works; no unrequested abstractions or dependencies.

## Carry into Plan 3 (deferred from the Plan 1 review)

- "Not ready" state when `data_updated_at` is null (an empty reference returns score 0, label `low`).
- `district_rank` comes from `areas`, never null for known districts; `flood_score_v1` returns `district`/`subdistrict` (null outside polygons).
- `lib/bangkok.ts` edge tests (max edge, lng out of range, different cell); a `years_covered` test.
- Replace the placeholder `app/layout.tsx` / `app/page.tsx`.
- CI grep guard: grep exit code 2 must fail the step.
- Measure the overview payload (374 KB on the bbox grid; Plan 2 Task 7 records the real number).
- Visual assets (line illustrations for empty / 404 / no-report states, gauge logo, favicon, optional OG images): token colors only, 2 px strokes to match Lucide, readable in light and dark.
