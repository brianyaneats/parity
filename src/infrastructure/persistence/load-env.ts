import { existsSync } from 'node:fs';

/**
 * Side-effect import that loads `.env` for the standalone tsx scripts
 * (`db:migrate`, `db:seed`).
 *
 * Next.js loads `.env` for the app; nothing loads it for a bare `tsx`
 * process — which made the README's clean-clone sequence fail at
 * `pnpm db:migrate` with "DATABASE_URL is not set" even though the user had
 * just copied `.env.example` to `.env` exactly as instructed. Node ≥ 22.13
 * (this repo's `engines` floor) ships `process.loadEnvFile`, so this costs
 * no dependency. Already-exported shell variables win over the file, same
 * as Next's own precedence; a missing file is fine — CI sets real env vars
 * and has no `.env` at all.
 */
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
