# Handoff (2026-10-03): Plan 2 implemented

Read this first, then `AGENTS.md`, the spec and the plan.

## Status

- Spec: `docs/superpowers/specs/2026-10-02-flood-score-design.md`
- Plan 1 (foundation): done, merged as #1 (`43f7463`).
- **Plan 2 (ingest): implemented and locally verified** — `docs/superpowers/plans/2026-10-03-flood-score-ingest.md`. Owner authorized subagent execution; task reviews passed. Branch: `codex/ingest`. Final review and GitHub CI status should be read from the draft PR and `docs/plan-2-results.md`.
- Plan 3 (API + UI): not written yet.
- Owner confirmed there is no production Supabase project. Setup guide only: `docs/production-setup.md`. Do not create accounts, configure production secrets or apply production migrations without a new owner instruction.
- Local acceptance: 42,545 unique reports, 50 districts, 230 boundary polygons; fixed reality bands passed. 59 Vitest tests, 95 pgTAP tests, lint/typecheck/advisor, exact generated types and Next production build passed. Read `docs/plan-2-results.md` for measurements, the partial historical run followed by successful catch-up, and the remaining dev-only dependency advisory.

## How to continue

- Continue on `codex/ingest` for PR feedback. Do not re-execute Plan 2 or reset the populated local database.
- User explicitly requested subagents. Implementation tasks ran sequentially with independent reviews and scoped fix reviews.
- The fresh-database `supabase/tests/areas-load-rpc.mjs` regression refuses populated databases intentionally; run it in fresh CI, not against this historical dataset.
- The "Facts verified" and "Global Constraints" sections are binding. Do not re-decide the "Deviations" (the owner approves them with the plan).
- Local refresh measured 2.407 s; reality passed. Production performance, scheduled execution and production reality remain owner verification tasks.
- Preserve untracked `.playwright-mcp/` and the two spec image assets. They belong to the existing workspace.

## Environment gotchas (Windows)

- Docker Desktop must be running; local Supabase via `npx supabase start`.
- Git Bash rewrites paths: prefix `docker exec …` with `MSYS_NO_PATHCONV=1`.
- Passing Thai in a shell URL breaks encoding (Traffy answers `invalid byte sequence`); percent-encode it or use Node `URLSearchParams`.
- Node 24 locally, CI uses Node 22 (needs ≥ 22.18 to run `.ts` directly).
- This machine's npm/npx shim is broken. Invoke `C:/Program Files/nodejs/node.exe` with `C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js`, or the package's installed entry point. Supabase CLI entry is `node_modules/supabase/dist/supabase.js`.
- Docker executable is under `C:/Users/Admin/AppData/Local/Programs/DockerDesktop/resources/bin`; add that directory to PATH for CLI calls. Local project is `Easy_website`, API `http://127.0.0.1:54321`.
- Gitignored `.env.ingest` holds the local service key, `.env.local` the local anon/read key. Never print values or move the service key to `.env.local` or any browser variable.

## Owner preferences

- Reply to the owner in Thai; keep technical terms in English.
- Priorities, in order: real-world use; lowest friction for users (no accounts, fewest taps); secure database (RLS, RPC-only reads, no keys in the browser); strong foundation (migrations, tests, CI). Never cut security or tests to save time.
- Prefer the simplest solution that works; no unrequested abstractions or dependencies.

## Carry into Plan 3 (deferred from the Plan 1 review)

- "Not ready" state when `data_updated_at` is null (an empty reference returns score 0, label `low`).
- `district_rank` comes from `areas`, never null for known districts; `flood_score_v1` returns `district`/`subdistrict` (null outside polygons).
- `lib/bangkok.ts` edge tests (max edge, lng out of range, different cell); a `years_covered` test.
- Replace the placeholder `app/layout.tsx` / `app/page.tsx`.
- CI grep exit-code handling is fixed; missing local export fields now fail before mask/export.
- Actual polygon-grid overview is 128,031 UTF-8 bytes, measured locally with historical data; confirm production behavior in Plan 3.
- Visual assets (line illustrations for empty / 404 / no-report states, gauge logo, favicon, optional OG images): token colors only, 2 px strokes to match Lucide, readable in light and dark.
