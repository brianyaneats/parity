# claim-sweep cron worker

Replaces the `*/15 * * * *` entry that used to live in `vercel.json` — Vercel
Hobby only allows once-per-day crons, so this Cloudflare Worker (free plan)
fires the claim-deadline-sweep instead. The daily/weekly jobs remain on
Vercel Cron.

## Deploy

```bash
cd infra/cron-worker
# 1. Set the production origin in wrangler.toml [vars] (see comment there)
# 2. Store the secret (must equal the CRON_SECRET env var on Vercel):
npx wrangler secret put CRON_SECRET
# 3. Deploy:
npx wrangler deploy
```

## Verify

- Cloudflare dashboard → Worker → Cron Events shows successful firings.
- `curl -i https://<parity-domain>/api/cron/claim-deadline-sweep` (no auth
  header) must return 401.
- A dry run can be triggered manually:
  `curl -H "Authorization: Bearer $CRON_SECRET" "https://<parity-domain>/api/cron/claim-deadline-sweep?dry=1"`

Cost/safety: the Worker makes 96 requests/day against a 100,000/day free-tier
cap, and Cloudflare free hard-stops rather than billing.
