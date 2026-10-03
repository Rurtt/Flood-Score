# Flood Score

Bangkok flood-frequency score for any address. Spec: `docs/superpowers/specs/2026-10-02-flood-score-design.md`.

## Local setup

Requires Node 22 and Docker Desktop (running).

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
