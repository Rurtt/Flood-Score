# Flood Score

Bangkok flood-frequency score for any address. Spec: `docs/superpowers/specs/2026-10-02-flood-score-design.md`.

## Local setup

Requires Node ≥ 22.18 and Docker Desktop (running).

```bash
npm install
npx supabase start          # local Postgres + PostGIS
cp .env.example .env.local  # fill SUPABASE_RPC_KEY from `npx supabase status` (anon key)
npm run dev
```

## Checks

```bash
npm test                 # Vitest
npx supabase test db     # pgTAP (database + security)
```

## CI (GitHub Actions)

`.github/workflows/ci.yml` runs every check on each pull request and on `main`.
See results in the GitHub repo under **Actions**, or on the PR page. A red X means a check failed;
click it to see the log. Nothing is deployed by CI; Vercel deploys `main` on its own.

## Data sources

- Flood reports: Traffy Fondue public API (`problem_type=น้ำท่วม`), loaded by `ingest/`.
- District/subdistrict boundaries: © OpenStreetMap contributors, ODbL. Extract committed at
  `ingest/data/bangkok-areas.json`; regenerate with `npm run fetch-areas`, load with `npm run load-areas`.

## Ingest

Scripts run directly with Node ≥ 22.18. Locally they read gitignored `.env.ingest` (see `.env.example`).

```bash
npm run load-areas   # load polygons and refresh the score grid
npm run backfill     # one-time historical Traffy flood load from 2021
npm run ingest       # today and two previous Bangkok calendar days (inclusive)
```

**Actions → Ingest** runs hourly and supports manual `run`, `backfill` and `load-areas` dispatches.
**Actions → DB push (prod)** applies migrations manually. Production jobs run only on the default
branch and share a queue. Failed runs fail the job; partial runs exit 0 and require log inspection.
Schedules may be delayed and public repository schedules pause after 60 days without activity.
Follow the owner-operated [production setup guide](docs/production-setup.md) for secrets, validation
and the documented development dependency audit risk. Production and full website readiness remain unverified.
