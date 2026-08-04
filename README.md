# Parity

**Which channel should I book through, by how much does it win, and what do I forfeit by
choosing wrong — and then, did I actually collect it?**

Parity takes hotel rates you have already looked up, applies the current rules of Amex Fine
Hotels + Resorts, Chase's The Edit, chain best-rate guarantees and Chase's price-match
guarantee, and ranks every booking channel by **effective net cost** — sticker minus perks,
statement credits, points value and any price-match refund.

Then it does the part that captures the money: tracks the 24-hour price-match claim window,
generates the claim evidence, tracks six use-it-or-lose-it statement credit buckets across two
cards, and reminds you to re-shop refundable bookings before the cancellation deadline.

Built from a detailed product spec (`parity-build-spec.md`, not included here). Judgment calls are
logged in [`DECISIONS.md`](./DECISIONS.md); the domain restated in plain language is in
[`DOMAIN-UNDERSTANDING.md`](./DOMAIN-UNDERSTANDING.md).

---

## What's built

Not a roadmap — every number below came from actually running the suite on 2026-08-03.

**1,328 tests across 75 files, all green under `pnpm test`:** engine fixtures and properties,
aggregate invariants, application-layer instrumentation, and every component state Testing
Library can drive. `pnpm test:coverage` puts `src/domain/engine`, `src/domain/rules` and
`src/domain/shared` at 100% of branches, so the figure in the Testing section below is
measured, not aspirational.

**51 Playwright tests across the 9 files in `e2e/`.** `accessibility.spec.ts` runs
`@axe-core/playwright` against all 13 routes (12 authenticated plus `/login`), in both themes —
26 checks for serious/critical violations. `visual-regression.spec.ts` pins pixel snapshots of
`/compare`, `/claims/[id]` and `/credits` at 390px, 768px and 1440px, also both themes — 18
more. The remaining seven files (claim lifecycle, clawback guard, compare-and-decide, deadline
expiry, FHR asymmetry, mobile compare, theme flash) cover one money-moving flow each. See "E2E
coverage status" further down for which of these need a real Postgres to run for real rather
than being skipped.

**43 routes:** 14 pages under `src/app` (`/compare`, `/claims`, `/credits`, `/ledger`,
`/trips`, `/watchlist`, `/properties`, `/settings`, their `[id]`/`rules` variants, and
`/login`) and 29 API routes under `src/app/api`, behind a `middleware.ts` that turns away
unauthenticated visitors before any server component runs.

**Auth is magic-link only — there is no password field anywhere in this app, and sign-up is
the sign-in.** `POST /api/auth/magic-link` auto-creates an account for an unknown address and
emails the same link a known one gets (D-153 — the account-enumeration surface is removed,
not disguised, and a 200ms response floor keeps the timing uniform either way). Tokens are
stored as SHA-256 digests, never raw (D-155). The callback sets a session cookie that is
HMAC-SHA256-signed with a server-enforced 30-day `exp` claim (`src/lib/auth/session.ts`),
checked with a constant-time compare; `POST /api/auth/logout` (sidebar, ⌘K palette, or
`/settings` on a phone) ends it. Page-tier reads take a **required** `userId` — the
optional-with-unfiltered-fallback version of those queries is the subject of D-152, the
security entry this README would rather you read than not know about.

**Cron runs on two different schedulers, for an unglamorous reason.** Three jobs
(`bucket-expiry-sweep`, `watchlist-reshop`, `rule-staleness`) sit on Vercel Cron, daily or
weekly. `claim-deadline-sweep` has to run every 15 minutes to not miss the 24-hour
price-match window, and Vercel's Hobby tier only allows once-a-day native crons — so that one
job runs on a Cloudflare Worker Cron Trigger instead (`infra/cron-worker/`), calling the same
route with the same bearer token Vercel Cron would have sent.

---

## Local setup from a clean clone

Eight commands.

```bash
corepack enable && corepack prepare pnpm@9.15.4 --activate
```

```bash
pnpm install
```

```bash
cp .env.example .env
```

```bash
docker run -d --name parity-db -e POSTGRES_PASSWORD=parity -e POSTGRES_USER=parity -e POSTGRES_DB=parity -p 5432:5432 postgres:16
```

```bash
pnpm db:migrate
```

```bash
pnpm db:seed
```

```bash
pnpm test
```

```bash
pnpm dev
```

Then open <http://localhost:3000>. Set `PARITY_DEMO_USER` in `.env` to sign in without
configuring email — it is refused in production.

If you have a Postgres already, skip the `docker run` and point `DATABASE_URL` at it.

Deploying it for real — Vercel, a hosted Postgres, Resend, and the one Cloudflare
Worker cron — is a separate fifteen-minute path: [`DEPLOYING.md`](./DEPLOYING.md).

---

## What runs what

| Command | Does |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build. Zero TypeScript errors under `strict` is a gate, not a goal |
| `pnpm test` | Vitest — engine fixtures, property tests, aggregates, components, application layer |
| `pnpm test:coverage` | Coverage. **The engine is held at 100% of branches** and CI fails below it |
| `pnpm test:engine` | Just the domain layer — fast, and the only tests that gate a money change |
| `pnpm test:e2e` | Playwright, the §10.3 flows |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm db:generate` | Regenerate the SQL migration after a schema edit |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` | ~45 properties, six credit buckets, a demo account |

---

## Architecture

Hexagonal, with a hard rule: **the domain layer imports nothing from infrastructure.**

```
src/
  domain/            pure. no I/O, no clock, no network, no React
    shared/          Cents, Money, Entity, AggregateRoot, DomainEvent, Clock, Result
    rules/           every threshold as versioned data with verifiedOn + sourceUrl
    engine/          the savings engine — pure functions + the SavingsEngine service
    credit/          CreditBucket aggregate: the clawback rule
    claim/           Claim aggregate: the 24-hour window and its state machine
    booking/         Booking aggregate: raises the event that opens a claim
  application/       use cases (all instrumented), ports, mappers, composition root
  infrastructure/    Drizzle schema and queries, logging, metrics, seeds
  components/        UI primitives (token-only) + domain components
  features/          screen-level client components
  app/               Next.js routes
  styles/tokens.css  every design value in the product, in one file
```

### Three decisions worth knowing about

**The engine is pure functions; the aggregates wrap them.** The spec requires a pure,
dependency-free engine, and DDD aggregates need identity and mutation — the opposite. So the
arithmetic lives in free functions that the §3.8 fixtures test directly, and `Comparison`,
`Booking`, `Claim` and `CreditBucket` own the invariants and transitions and call the engine as
a stateless service. Neither layer is compromised: the functions have no `this`, the aggregates
have no formulas. (`DECISIONS.md` D-030.)

**Every use case is instrumented by construction, not by convention.** `UseCase.execute()` is
the only public entry point and it wraps the subclass's `handle()` with a timer, a structured
log line carrying the request id, a latency histogram, outcome counters and a budget check.
`handle()` is `protected abstract`, so a use case physically cannot run unmeasured. Metrics are
in-process and pulled from `/api/metrics` — §12 rules out a telemetry vendor, so nothing leaves
the deployment. (D-040, D-042.)

**All design values live in `src/styles/tokens.css` and nowhere else.** No component contains a
raw hex, rgba, px font size or px radius; `tailwind.config.ts` resolves every class to a
`var()`. This started as the mitigation for the one genuinely unresolved question in the spec
(§6.1 — the owner asked for "the 70mm Sentry app design" and no such thing was found): if the
assumption is wrong, reversing it is a one-file edit. (D-050.) **The assumption was wrong, and
the bet paid out**: on 2026-08-03 the owner asked for a cleaner, Airbnb-inspired UI, and the
swap was a rewrite of this one file's *values* — palette, radii, shadows and type scale
measured from airbnb.com's computed styles, re-stepped where the measured pairs miss WCAG AA,
light-first with a re-authored charcoal dark mode. Almost everything else restyled itself.
(D-158.)

---

## The parts that are easy to get wrong

Four things in this domain are counterintuitive enough that they each have a dedicated fixture
or aggregate, and changing any of them should make a test go red.

**Amex FHR cannot be price matched.** Amex's rate guarantee explicitly excludes Fine Hotels +
Resorts and The Hotel Collection — exactly the programmes a Platinum holder uses. An FHR markup
is permanent; an Edit markup is claimable for 24 hours. That is asymmetric *risk*, not
asymmetric price, so it cannot be read off the ranking, which is why §8.4 requires it rendered
as a persistent note. Fixture **TC-06** is the tripwire for the inverse bug — applying Chase's
logic to an Amex channel.

**Credits are computed after the refund.** A statement credit keys off what you actually
charged, and a price-match refund lowers that charge. Reversing the order produces a plausible,
too-generous number in exactly the case where the user most needs the truth. Fixture **TC-05**
pins it: a $400 booking with a $222.37 refund keeps only $177.63 of a $250 credit, and $72.37
evaporates.

**`minCashFloor = face + expectedRefund` is the most actionable number in the product.** It is
the answer to "how do I not lose part of that credit", it has to be on screen *before* the user
leaves for the portal, and §8.3 requires it phrased as an instruction naming the number and the
consequence — "Charge at least $472.37" — not as a statistic.

**Effective net can legitimately be negative.** Perks plus credits plus refund can exceed a
cheap stay's total. The engine returns the true negative, the UI clamps only the bar length,
and the `OVER_SUBSIDIZED` warning fires so an inflated breakfast valuation gets questioned
rather than celebrated.

---

## Testing

| Layer | Tool | Standard |
|---|---|---|
| Engine | Vitest + fast-check | Every §3.8 fixture as an executable test, plus the §3.9 properties. **100% of branches.** |
| Aggregates | Vitest | Including DST and UTC-midnight crossings on the 24-hour claim window |
| Components | Testing Library | Every state in §6.4, `CurrencyInput` exhaustively |
| Application | Vitest | That instrumentation actually fires, and that the API layer and the engine agree |
| E2E | Playwright | The §10.3 flows, at 1440px and 390px |

Two rules from §10.2 that are load-bearing: **never mock the engine**, and **never mock time in
a way that hides a timezone bug** — the clock is injected as a parameter, which is what makes
the DST tests possible at all.

The fixtures in §3.8 are ground truth. If the implementation disagrees with one, the
implementation is wrong. Do not edit a fixture to make a test pass.

**Running `pnpm test:e2e` locally needs two things beyond a migrated, seeded Postgres:**
`AUTH_SECRET` set in your shell (or `.env`) — `playwright.config.ts` runs this suite against a
*production* build (`pnpm build && pnpm start`), and `src/lib/auth/session.ts` deliberately
refuses to issue or accept any session in production without it, which surfaces as every
authenticated request 401ing rather than as an obviously-auth-shaped error. `.env.example`'s
`AUTH_SECRET` ships blank; generate one with `openssl rand -base64 32` before running the suite,
even though the "Local setup" steps above don't need it for `pnpm dev`.

**E2E coverage status (updated 2026-08-03):** all nine `e2e/*.spec.ts` files run for real
against the Postgres service container CI provisions — the `test.fixme(!process.env.
DATABASE_URL, …)` guards four of them carry are live checks that evaluate false there, not
skips. The `e2e` job went green in CI once two fixes landed: CI's `env:` had been missing
`AUTH_SECRET` (the production build refuses every session without it, which surfaced as
401s rather than anything auth-shaped), and the DB-mutating specs shared one demo account.
That second one was the suite's only real flake, and it is now fixed at the root rather
than absorbed by retries: **each Playwright worker seeds and signs in as its own fixture
account**, keyed off `TEST_PARALLEL_INDEX` (`e2e/support/constants.ts`). `resetDemoData()`
is a cascading `DELETE FROM users`, so with a shared account one spec's reset routinely
fired while a sibling's test was mid-flow and deleted its booking and claim underneath it —
seen as `Claim not found` on the evidence POST. Serializing the resets could never fix
that, because the collision was between a reset and a *running test*; not sharing the data
is what fixes it. Measured before: 1 flaky of 51 under `workers: 2`. After: 51/51 clean,
twice consecutively.
Visual-regression baselines are committed for both `darwin` (local runs) and `linux` (CI) —
Playwright suffixes snapshots per platform, and a repo that only carries one platform's
baselines fails wholesale on the other, which is exactly how the first visual job run went.
The `/credits` baselines mask the "N days" countdown text: those figures are server-rendered
from the real clock and would stale any unmasked baseline within 24 hours.

---

## What this deliberately does not do

Building any of these would be a failure, not a bonus:

- **No scraping, ever.** No headless browser against amextravel.com, chase.com or any OTA.
- **No stored credentials.** Parity never asks for, stores, transmits or proxies a bank,
  card-issuer or hotel-portal password. There is no OAuth-shaped workaround.
- **No live rate feeds** in v1. Rates come from you.
- **No booking.** Parity ranks and reminds; you book in the portal yourself.
- **No LLM anywhere in a numeric path.** The engine is deterministic arithmetic. Text
  summarisation is permitted only behind a feature flag, clearly labelled, and never feeding
  back into a number you see.
- **No affiliate links.** If they are ever added they must be disclosed inline and must never
  influence ranking — the ranking function stays a pure function of the numbers, because that
  is the product's entire credibility.

Analytics, if added, must be self-hosted or privacy-preserving. The app knows which hotels you
are considering; that is treated as sensitive throughout.

---

## Not financial advice

Parity computes estimates from rates you enter and published programme terms. Programme terms
change, and approval of any claim is at the issuer's discretion. Nothing here is a guarantee of
a refund or a saving.

Domain rules were verified July 2026 against the sources listed in §2.9 of the spec, and every
one of them renders on `/settings/rules` with its verified date and source link. Re-verify
before relying on any threshold after January 2027 — anything older than 180 days is flagged in
the UI automatically.
