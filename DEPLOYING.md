# Deploying Parity

The stack this repo is built for: **Vercel** (app + three daily/weekly crons), any
**Postgres** (Neon's free tier works), **Resend** (magic-link email), and one
**Cloudflare Worker** (the 15-minute claim-deadline sweep — Vercel Hobby crons top out
at once a day, see the README). Total setup is about fifteen minutes, and every step
below fails loudly rather than half-working.

## 1. Postgres

Two paths. **Marketplace (no credential handling):** `pnpm dlx vercel integration add neon`
— accept the terms link it prints, and Vercel provisions a Neon database and injects
`DATABASE_URL` into the project's env directly; the connection string never passes through
your clipboard. **Bring your own:** create a database (e.g. [neon.tech](https://neon.tech)
→ new project), copy its connection string, and add it as the `DATABASE_URL` env var
yourself in step 3. Either way, migrations run automatically at deploy time:
`vercel.json`'s `buildCommand` is `pnpm db:migrate && pnpm build`, and the migrator is
idempotent (it tracks applied migrations in `drizzle.__drizzle_migrations`). A build
with no reachable `DATABASE_URL` fails, on purpose.

Seeding is optional and one-shot, from your machine:

```bash
DATABASE_URL="<prod connection string>" pnpm db:seed
```

This inserts the ~45 global properties every account sees (`user_id NULL`) and a demo
account. On a real deployment you may prefer properties only — the demo account is
harmless (nobody can sign in as it without email access to `demo@parity.local`) but
it is also not needed, since sign-up is self-serve.

## 2. Resend

Same two paths: `pnpm dlx vercel integration add resend` (accept the terms link;
`RESEND_API_KEY` is injected without ever being displayed), or
[resend.com](https://resend.com) → API key added by hand. Verify a sending domain if you have one;
otherwise their shared `onboarding@resend.dev` sender works for testing but delivers
to your own inbox only. `EMAIL_FROM` must match a sender Resend accepts, e.g.
`Parity <parity@yourdomain.com>`.

Without `RESEND_API_KEY` the app still runs — magic links are printed to the server
log instead of emailed (token digested, never raw), which is useless for strangers
but fine for a smoke test.

## 3. Vercel

```bash
pnpm dlx vercel login
pnpm dlx vercel link        # create/link the project from the repo root
```

Environment variables (Production), via dashboard or `pnpm dlx vercel env add <NAME> production`:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Postgres connection string from step 1 |
| `AUTH_SECRET` | `openssl rand -base64 32` — sessions are refused without it |
| `AUTH_URL` | the production URL, e.g. `https://parity.yourdomain.com` — magic links refuse to send without it |
| `RESEND_API_KEY` | from step 2 |
| `EMAIL_FROM` | a sender Resend accepts |
| `CRON_SECRET` | `openssl rand -base64 32` — every cron route 401s without it |
| `EMAIL_DAILY_BUDGET` | optional; default 80, keeps under Resend's free 100/day |

Do **not** set `PARITY_DEMO_USER` in production — the session layer refuses it there
anyway (`NODE_ENV` gate), but there is no reason to have it present.

Then either `pnpm dlx vercel deploy --prod`, or add `VERCEL_TOKEN`, `VERCEL_ORG_ID`
and `VERCEL_PROJECT_ID` as GitHub repository secrets and let CI's deploy job take over
on every push to `main` (it currently skips itself with a notice until those exist).
The three daily/weekly crons in `vercel.json` register automatically; Vercel calls
them with `Authorization: Bearer <CRON_SECRET>`.

## 4. The 15-minute sweep

Two interchangeable schedulers call the same route with the same bearer token; pick one.

**GitHub Actions (default — no extra account).** `.github/workflows/claim-sweep.yml` runs
every 15 minutes once two pieces of repo config exist:

```bash
gh secret set CRON_SECRET --repo <you>/parity          # same value as Vercel's
gh variable set PARITY_BASE_URL --repo <you>/parity --body "https://<your-url>"
```

Unconfigured, the workflow exits quietly with a notice instead of failing the badge.
Caveat worth knowing: GitHub schedules are best-effort — usually on time, occasionally
minutes late, and paused if the repo sees no activity for 60 days. The sweep is
idempotent and re-examines every open claim each run, so a late tick delays a nudge;
it never loses one.

**Cloudflare Worker (alternative — exact timing).**

```bash
cd infra/cron-worker
# edit wrangler.toml: set PARITY_BASE_URL to your production URL
pnpm dlx wrangler login
pnpm dlx wrangler secret put CRON_SECRET   # same value as Vercel's
pnpm dlx wrangler deploy
```

Free tier is fine. Details and a curl to verify: `infra/cron-worker/README.md`.

## 5. Verify

- `https://<your-url>/api/health` → `{"ok":true,...}` (the only unauthenticated route).
- Visit the root → redirected to `/login`; request a link with your real email → you
  get a sign-in email and an account exists the moment you click it. Sign-up **is**
  the magic-link request (`DECISIONS.md` D-153).
- `curl -H "Authorization: Bearer <CRON_SECRET>" https://<your-url>/api/cron/claim-deadline-sweep`
  → 200. Without the header → 401.
- A wrong-UUID deep link like `/claims/00000000-0000-4000-8000-000000000000` → the
  designed not-found page, not another user's data.

## What the app never needs

No object-storage bucket (claim evidence lives in Postgres behind the same
presigned-URL contract — D-159; swap in S3/R2 later by replacing one adapter), no
telemetry vendor (metrics are in-process at `/api/metrics`), no OAuth app, and no
credentials of yours beyond the accounts above — Parity itself never stores end-user
passwords or card numbers, by design (§12).
