# DECISIONS.md

> Required deliverable per §0.3 and Part 14. Every judgment call the spec does not cover.
> Resolution order used throughout: (1) generalise an existing rule, (2) follow a stack
> convention, (3) **if it touches money math or a legal claim, take the conservative
> option, mark `// SPEC-GAP:` in code, and log it here**, (4) otherwise choose, log one
> line, keep moving.
>
> Entries tagged **[MONEY]** or **[LEGAL]** were resolved conservatively under §0.3 item 3
> and carry a `// SPEC-GAP:` marker at the implementation site.

---

## Discrepancies found in the spec itself

### D-001 — §2.2 says "Eight channels" but defines nine
The prose sentence reads "Eight channels." The table below it lists nine enum values, and
the `Channel` union in §3.2 independently lists the same nine (`FHR`, `THC`, `EDIT`,
`CHASE_TRAVEL`, `DIRECT_FLEX`, `DIRECT_PREPAID`, `OTA`, `FORA`, `PHONE`).
**Chosen:** implement nine. Two independent definitions agree with each other; the prose
count is the outlier. Not treated as a fixture conflict — no fixture depends on the count.

### D-002 — §3.8 TC-04 attributes a non-refundable competitor to PM8, not PM9
TC-04 sets `competitorRefundable false` and says "PM8 fails". PM8 is the exact-parameter
match, which does include *refund policy* in its enumerated list, so this is consistent —
but PM9 (publicly available) is a separate flag and does **not** fail here.
**Chosen:** refund-policy mismatch reports as **PM8**; `competitorPublic false` reports as
**PM9**. They are independently reportable and both are surfaced by
`failedConditions`. The `COMPETITOR_NON_REFUNDABLE` warning fires on the PM8 case, per the
fixture.

### D-004 [MONEY] — §3.9's monotonicity property is false for the spec's own algorithm in one regime
§3.9 asserts unconditionally that "increasing any channel's `totalCents` never decreases
its `effectiveNetCents`." Property testing found a counterexample within 656 runs, and
differentiating step 14 of §3.3 confirms it is systematic rather than a rounding artefact:

| regime | d(net)/d(total) |
|---|---|
| Amex prepaid, credit fully kept | +0.75 |
| Amex prepaid, **credit capped by the charge** | **−0.25** |
| Edit qualifying, credit capped by the charge | 0.00 |
| Edit qualifying, credit fully kept | +0.09 |
| Fora, 7% rebate | +0.93 |

Once `netCharge < face`, each extra cent charged is fully absorbed by the statement credit
*and* earns points on the full total, so the marginal return exceeds the marginal cost and
a more expensive booking nets better.

**Chosen:** do not change the algorithm. This is not a defect — it is the exact phenomenon
`minCashFloor` exists to exploit (§2.4, §8.3: "charge at least $472.37 and cover the rest
with points"). Satisfying the property would require breaking the clawback rule and
fixture TC-05 with it, and §0.2 makes fixtures the higher authority. The property is
asserted over its true domain (`clawbackCents === 0` on both sides, via `fc.pre`), and a
companion test pins the exception as documented, intended behaviour rather than leaving a
silent hole. The engine already flags exactly this regime with `CLAWBACK_RISK`.

### D-003 — TC-09's break-even resolves to 0.4400¢, spec says "≈ 0.44¢"
Binary search on `urValueMicro` with MR held at 15000 gives a crossover at **4399.54
micro-cents** (0.44¢ to two decimals). The spec's stated tolerance is ±0.01¢, so this
agrees. **Chosen:** the sensitivity function returns the un-rounded micro value and the UI
formats to two decimals; the test asserts within ±100 micro (±0.01¢) of 4400.

---

## Engine and money math

### D-010 [MONEY] — Rounding is half-away-from-zero, not JavaScript's `Math.round`
§3.1 says "`Math.round` at every division, half away from zero." Those two clauses
conflict for negative values: JS `Math.round(-5990.5)` is `-5990` (half *up*), but half
away from zero is `-5991`.
**Chosen:** implement `roundHalfAwayFromZero`. TC-01's `DIRECT_PREPAID` row settles it —
it expects `perNight = −5991` from `−17972 / 3 = −5990.67`. That value rounds identically
under both rules, so it does not discriminate; but the stated *rule* ("half away from
zero") is explicit prose and the conservative reading, so the prose wins. Applied
uniformly at every division so behaviour never depends on operand sign.

### D-011 [MONEY] — `pointsFor` for a non-prepaid `THC` booking
§2.2 marks `THC` as always prepaid, and §2.5 gives an explicit 1× rule only for
non-prepaid `FHR`. A non-prepaid `THC` quote is therefore unspecified but *enterable*.
**Chosen (conservative):** treat non-prepaid `THC` exactly like non-prepaid `FHR` — 1× MR,
credit face 0 (the face table already requires `prepaid`), and the same
`FHR_PAY_AT_PROPERTY_1X` warning. Under-claims rather than over-claims. `// SPEC-GAP:`

### D-012 [MONEY] — Points value is computed from cents, and never floats through an intermediate
The chain `cents → points → value` invites a float. **Chosen:** one fused integer
expression, `round(spendCents × multiplier × valueMicro / 1_000_000)`, so there is a
single rounding site. Verified against every fixture: TC-01 EDIT 43967, FHR 27000, OTA
3600; TC-02 EDIT 47467; TC-03/04 46060; TC-07 14299; TC-08 27417 / 30917.

### D-013 [MONEY] — `OTA` "~1% cash-equivalent" is modelled as exactly 1%, as a rule constant
§2.2 says "~1%". An approximation cannot be a constant in a product that promises
auditable arithmetic. **Chosen:** exactly 100 bps, exported as `OTA_LOYALTY_RATE_BPS` in
`src/domain/rules/` with its own `verifiedOn`, so the user can see and change it rather
than discover it hardcoded. TC-01 confirms: 360000 × 1% = 3600.

### D-014 [MONEY] — `minCashFloor` is reported for every channel, not only qualifying ones
§2.4 defines it as `face + expectedRefund`. Where no credit or no refund exists it
degenerates to 0 or to the bare face. **Chosen:** always compute it; the UI only surfaces
it prominently when `face > 0`, since "charge at least $0" is noise. Matches TC-05's
47237.

### D-015 — `pmQualifies` requires the booking to be refundable
Step 6 of §3.3 includes `∧ refundable` on the *own* booking. PM4 ("unmodified and
uncancelled") does not obviously imply it, but the spec's algorithm is explicit and the
algorithm is a higher authority than my inference. **Chosen:** follow §3.3 exactly. A
non-refundable Edit booking does not qualify, and the failed condition is reported as PM8
(refund-policy parameter match).

### D-016 — Failed-condition reporting for conditions the engine cannot observe
PM1 (which card), PM4 (unmodified), PM5 (within 24h of booking) and PM6 (check-in ≥ 24h
away) depend on state the pure engine is not given — it receives no clock and no card.
**Chosen:** the engine reports only the conditions it can evaluate from `StayContext` and
`ChannelQuote` (PM2, PM3, PM7, PM8, PM9). PM1/PM4/PM5/PM6 are evaluated in the
*application* layer, where the card, the booking timestamp and an injected clock exist,
and merged into the same `failedConditions` array for the UI. This keeps §3's purity rule
intact without weakening §8.2's requirement that all nine render. Documented on the type.

### D-017 — `nights ≤ 0` is rejected at validation, and the engine asserts rather than guesses
§3.6 says the engine "may assume `nights ≥ 1`". **Chosen:** Zod rejects at the boundary,
and the engine additionally throws a typed `DomainError` if it is ever reached with
`nights < 1`. A thrown error is preferable to a silent division by zero producing
`Infinity` in a money figure.

### D-018 — Ranking tie-break (c) uses the §2.2 table order, made explicit
§3.4's third tie-break is "channel enum order as listed in §2.2". **Chosen:** exported as
an explicit `CHANNEL_RANK_ORDER` array rather than relying on TypeScript union or object
key order, which are not a stable contract. Property test §3.9 asserts shuffling inputs
never changes the winner.

### D-019 — Duplicate channels are labelled `EDIT (1)`, `EDIT (2)` by input order
§3.6 says duplicates are allowed and must be labelled by index, without giving a format.
**Chosen:** 1-based suffix, applied only when a channel appears more than once, so the
common case stays clean.

### D-020 — BRG minimum-gap comparisons follow the spec table's own notation
§2.3.3 states minimums two ways: "$1/night" for Marriott, Hyatt, Wyndham and Best Western,
and "> 1%" for Hilton and IHG. Choice states "greater of $1 or 1%".
**Chosen:** honour the notation as written. An absolute floor stated as a *minimum* is
inclusive (a gap of exactly $1/night qualifies); a floor written with an explicit `>` is
strictly greater. Where both apply (Choice), the harder threshold binds and the strict
comparison is used. Encoded as a `BrgMinimumGapKind` discriminant so the rule is data, not
a chain of conditionals.

### D-021 [MONEY] — The relative BRG floor is taken against the user's own base rate
§2.3.3 says "> 1%" without saying one percent *of what*. The candidates are the user's own
base rate and the competitor's.
**Chosen (conservative):** the user's own base rate, which is the larger of the two
whenever a gap exists, making the threshold harder to clear. This under-claims eligibility
rather than over-claiming it, per §0.3 item 3. `// SPEC-GAP:`

### D-022 — `EDIT_UNDER_TWO_NIGHTS` also fires for The Hotel Collection
§3.7 names the warning for The Edit, but §2.4 gives The Hotel Collection the identical
two-night minimum against a larger $300 credit.
**Chosen:** fire for both. Generalising an existing rule is §0.3 item 1, and suppressing it
for THC would silently cost the user $300 in exactly the case the warning exists to
prevent. The enum name is kept as specified so the contract does not drift.

### D-023 [MONEY] — IHG's "5× points, capped at 40,000" is reported as text, not as a number
Computing IHG's kicker needs a base points-earning rate that §2.3.3 does not supply.
Deriving one would be inventing a programme rule, which §13.4 explicitly forbids.
**Chosen (conservative):** `pointsKicker` stays 0 for IHG and the payout description
carries the real terms. The app under-states the benefit rather than fabricating a figure
the user would check and find wrong. `// SPEC-GAP:`

### D-024 — A best-rate guarantee is evaluated against the cheapest direct quote
§3.5's signature takes `ownTotalCents` without saying which quote supplies it. A chain
guarantee requires booking direct with the chain, so only `DIRECT_FLEX` is BRG-eligible
per §2.2.
**Chosen:** use the cheapest BRG-eligible direct quote in the comparison. With no direct
quote entered, `evaluateBrg` returns `null` and the UI prompts for one rather than the
engine inventing a rate.

---

## Domain modelling (OOP / DDD)

### D-030 — The engine is pure functions; the DDD objects wrap it, never replace it
§3 mandates a pure, dependency-free module. DDD aggregates need identity and mutation,
which is the opposite. **Chosen:** a two-layer split. `src/domain/engine/` stays pure
functions over plain data (fixtures test it directly). The aggregates —
`Comparison`, `Booking`, `Claim`, `CreditBucket` — are classes that *own the invariants and
transitions* and call the engine as a stateless domain service. Neither layer is
compromised: the engine has no `this`, and the aggregates have no arithmetic of their own.

### D-031 — `Cents` is both a branded type and a `Money` value object
§3.1 mandates the branded primitive for the engine's hot path. A branded number cannot
carry behaviour. **Chosen:** keep `Cents` exactly as specified for engine boundaries, and
add a `Money` value object (immutable, `equals`, `plus`, `minus`, `allocate`, formatting)
for the application and UI layers where ergonomics matter more than allocation count.
`Money.toCents()` is the one bridge.

### D-032 — Aggregates emit domain events; there is no event bus in v1
`Booking` raising `BookingRecorded` is what triggers auto-claim creation (§5.2). A full
bus is unjustified for one user. **Chosen:** aggregates collect events in
`pullDomainEvents()`; the use case drains them in the same transaction and dispatches
synchronously through a typed in-process dispatcher. Swappable for a real bus later
without touching a single aggregate.

### D-033 — Repositories are ports in `src/application/ports/`, implemented in `src/infrastructure/`
Standard hexagonal placement. The domain layer imports nothing from infrastructure; this
is enforced by an ESLint `no-restricted-imports` rule rather than left to discipline.

### D-034 — Claim status transitions live in the `Claim` aggregate as an explicit state machine
§7.4 requires that an expired claim can move only to `EXPIRED` or `NOT_PURSUED`. **Chosen:**
a declarative transition table on the aggregate, so the rule is stated once and enforced
identically by the API, the UI and the cron sweep.

---

## Persistence

### D-070 [OPEN] — Row-level security is not enabled, deliberately, and this is a gap
§4.1 says "Enable RLS on every user-scoped table even though the app also filters in the query
layer; belt and braces." The schema does **not** call `.enableRLS()`.
**Reason:** enabling RLS in Postgres with zero policies defined blocks *all* access, including
the application's own. Writing real policies requires deciding how the request's user identity
reaches the database session (a `current_setting('app.user_id')` convention set per
transaction, a separate authenticated role, or Neon's own mechanism) — an architectural choice
that touches the connection pool, not a schema detail.
**Chosen:** ship the query-layer `userId` filter (which is in place and tested), and leave RLS
off with this entry rather than enabling it half-way and discovering in production that either
everything is blocked or nothing is protected. **This is a real deviation from §4.1 and the
one item in Part 4 that is not done.** The fix is a follow-up migration adding a policy per
table plus a `SET LOCAL app.user_id` in the transaction wrapper.
**Amended 2026-08-03:** this entry's premise — "the query-layer filter is in place" — was
found to be only half true: several list queries took `userId` as *optional* and read
unfiltered when it was omitted, and the server-component pages omitted it. A compensating
control that callers can skip is not a control; see D-152 for the incident and the fix that
made the parameter unskippable. RLS itself remains the open follow-up.

### D-071 — Auth.js tables follow the adapter's shapes, not §4.1's universal `id` rule
§4.2 names the Auth.js tables but gives them no DDL. §4.1's "every table gets a uuid `id`"
would break the adapter contract: `accounts` is keyed on `(provider, providerAccountId)`,
`sessions` on `sessionToken`, `verificationTokens` on `(identifier, token)`.
**Chosen:** use the standard adapter shapes. `users.id` is `uuid` rather than Auth.js's more
common `text` default, because every other table's `user_id` FK is declared `uuid` in §4.2 and
a type mismatch there would be far worse than a deviation from the adapter's default.

### D-072 — `user_settings` has no separate `id`, and `quotes`/`competing_rates` have no `userId`
§4.2's own DDL makes `user_settings.user_id` the primary key, and scopes `quotes` and
`competing_rates` only through `comparison_id`. Both contradict §4.1's general rules.
**Chosen:** follow §4.2's explicit column lists. A specific DDL outranks a general statement,
and the cascade from `comparisons` already scopes the child rows correctly. Asserted in the
schema test so the deviation is deliberate rather than accidental.

---

## Observability (owner requirement, beyond the spec)

### D-040 — Every application task is instrumented by construction, not by convention
The owner asked for logging and performance metrics on each task. **Chosen:** an abstract
`UseCase` base class whose public `execute()` wraps the subclass's `handle()` with a timer,
a structured log line (start / success / failure, with a correlation id), a latency
histogram and a success/failure counter. Instrumentation cannot be forgotten because
subclasses cannot bypass it — `execute()` is `final` by convention and `handle()` is
`protected abstract`.

### D-041 — The engine is measured from outside, so §3's purity rule is not broken
No timer, logger or counter is imported inside `src/domain/engine/`. The
`CompareChannelsUseCase` measures the call. A separate opt-in `EngineProfiler` can be
passed by tests and the dev overlay to get per-step timings; it defaults to a no-op object
that the JIT elides, and it never affects a returned number.

### D-042 — Metrics are in-process, with a pull endpoint; no third-party telemetry vendor
§12 bans third-party pixels and treats the hotel list as sensitive. A vendor SDK is the
same category of risk. **Chosen:** an in-process registry (counters, gauges, histograms
with p50/p95/p99) exposed at `/api/metrics` behind auth, plus Prometheus text format for
future scraping. No data leaves the deployment.

### D-043 — `POST /api/compare`'s p95 budget is asserted, not just aspired to
§5.3 sets p95 < 100 ms. **Chosen:** the histogram for that route is checked by a test that
runs the engine over the fixture set and fails if p95 exceeds budget, so the number in the
spec is a gate rather than a comment.

### D-100 — A data-viz series colour is never used as a text colour
Found during review: the ledger tooltips rendered "Realized $X" in `--series-1` and "Projected
$X" in `--series-2`. §6.5 verifies the series palette at **≥3:1**, which §6.7 permits for
graphical objects and large text but *not* for body text, where the floor is 4.5:1. This is
the same failure mode as `--brand` (D-052), one step further out.
**Chosen:** carry the series identity on a swatch and leave the words on `--text-primary`.
That also satisfies §6.5 rule 7, which forbids identity being carried by colour alone. Banned
going forward by a check in `src/compliance.test.ts`, alongside the `text-brand` ban.

### D-140 [LEGAL] — The session cookie was unsigned; it is now HMAC-signed and fails closed
Found in a critical self-review after the build was "done": `encodeSession` was plain
base64url JSON, and the magic-link callback set it as the session. Any visitor could mint a
cookie naming any `userId` and become that user — including against `DELETE /api/account`.
It crept in because the magic-link flow was hand-rolled instead of using Auth.js as the
spec's stack list assumed, and nothing in 1,195 tests exercised forgery.
**Chosen:** HMAC-SHA256 over the payload with `AUTH_SECRET`, verified with a constant-time
compare; a missing or invalid signature is an unauthenticated request; production with no
`AUTH_SECRET` refuses to issue or accept sessions rather than degrading. The E2E auth helper
signs through the same code path rather than duplicating the HMAC.

### D-141 [MONEY] — `CHANNEL_CHOICE` is projected and cash-only; "realized" means statement money
The first implementation wrote a **realized** event of `Δ(effectiveNet + refund)`. That
number double-counted the statement credit (also logged as `CREDIT_BURNED` in the same
transaction) and embedded breakfast and points *valuations* — soft dollars that never appear
on a credit-card statement — inside a figure §1.5 says must survive the user's own statement
reconciliation. Coverage was also accidental: no OTA row meant no event at all.
**Chosen:** the decomposition rule that makes the by-source breakdown sum honestly — every
excluded component is either not statement-money or has its own event when it actually lands.
`CHANNEL_CHOICE` is **projected**, computed sticker-vs-sticker (both numbers exist on real
booking pages), floored at zero; `CREDIT_BURNED` and `PRICE_MATCH` remain the realized
events. Baseline is the OTA row when present, else the worst sticker with the note naming
which baseline was used.

### D-142 — Unauthenticated mutations get an IP-based budget; magic-link is strictest
The per-user rate limiter deliberately skipped unauthenticated requests so a 401 was never
masked by a 429 — which left `POST /api/auth/magic-link`, the one endpoint that emails
arbitrary addresses, with no throttle at all.
**Chosen:** a second budget keyed by client IP for unauthenticated mutating requests, with
magic-link tightest. The anti-enumeration property is preserved: a 429 reveals nothing about
whether the address exists.

### D-143 — Optimistic and authoritative comparisons must share *inputs*, not just math
§5.3's one-module rule kept the arithmetic identical, but once the server began deriving
bucket availability from live state, the client's optimistic pass computed from a guess and
visibly re-settled ~300ms later — the same erosion the rule exists to prevent, one level up.
**Chosen:** the page hydrates the caller's live bucket snapshot server-side, the optimistic
pass computes from it, and the server echo is normally a no-op. The reconciliation stays as a
safety net, not as the mechanism.

### D-144 — Notification dedup is durable; quiet hours delay rather than drop
The in-process dedup `Map` is empty on every serverless cold start, and the sweep's
deliberately wide re-evaluation window then re-sends each crossed checkpoint every 15
minutes. Worse, quiet hours *dropped* suppressed sends, so the T+20h final call could be
permanently lost — against §1.5's "no claim window is ever missed".
**Chosen:** a `notifications_sent` table whose unique `idempotencyKey` index arbitrates
(insert-first, `onConflictDoNothing`, row-count check — no read-then-write race), layered
under the existing in-memory check and Resend header. Quiet hours delay to the next tick;
the final checkpoint is exempt when the deadline would pass before quiet hours end — a 3am
email is a product failure (§9), a silently expired claim is a bigger one. `?dry=1` writes no
dedup rows, so a dry run cannot silence the next real one.

### D-145 — One DI pattern: per-route construction; the container and its seam are gone
Twenty-five routes constructed dependencies directly; one went through a container that had
accreted a lazy dynamic import and a mutable global test seam. Two patterns is one too many,
and a global seam is a worse test story than the constructor injection every other test uses.
**Chosen:** standardise on per-route construction; the route test mocks at the module
boundary instead of poking a global.

### D-146 [OPEN] — Two money-math questions raised to the owner, deliberately not decided here
1. **The engine prices 3 of the 6 credit buckets.** `creditFaceFor` models FHR/THC/Edit
   exactly as §3.3 specifies and the fixtures pin — but `CSR_TRAVEL` ($300) and `CSR_BRANDS`
   ($250) never enter the ranking, so Chase channels can be understated by up to $550 when
   those are live. Fixing it changes ground-truth fixtures, which §0.2 puts above the
   implementation; owner's call.
2. **Currency.** Refusing a foreign-currency paste (D-131) is honest but hostile to a user
   whose seeded cities are half non-USD. The right fix is a currency on `StayContext` plus a
   user-entered conversion rate — a §3.2 spec change.

### D-130 — Product review found the UI finished and the wiring absent; the wiring is the product
Two product managers reviewed the build independently — one on `/compare` + `/claims`, one on
the year-long collection loop — and converged on the same root cause without seeing each
other's work. I verified every claim in the code before acting on it:

| Finding | Verified by | Result |
|---|---|---|
| `ClaimKit` never calls the API | `grep -c "fetch(" ClaimKit.tsx` | **0** |
| Booking never consumes a credit bucket | `grep -c "Bucket" RecordBookingUseCase.ts` | **0** |
| Watchlist page returns a literal `[]` | read the source | confirmed |
| `savings_events` written in one place only | grep across `src/application` | only `TransitionClaimUseCase` |
| Currency detected then discarded | `grep -c "currency" engine/types.ts` | **0** |

All five were real. The pattern is worth naming, because it is invisible to the test suite
that was passing: **1,154 tests, 100% engine branch coverage, and every screen rendering its
states — while the actions those screens offered reached nothing.** Unit tests assert a
component's behaviour; component tests assert its states; neither asks "and does the button
do anything." That question belongs to E2E, and E2E was the layer blocked on a database.

The most expensive one, `ClaimKit`, was worse than a missing feature: the user could tick all
ten evidence items, copy the claim text, file it with Chase, press "Mark submitted", get a
success toast — and the row never left `ELIGIBLE`, so the sweep auto-expired it at T+24h. The
app was manufacturing the false confidence that causes the exact failure §1.5's second
criterion exists to prevent.

**Chosen:** persist first, then advance local state — never the reverse. `transitionTo`
mutates in place, and a half-applied rollback on a state machine is how a UI ends up showing a
status the database disagrees with. Component tests now stub `fetch` and assert the PATCH was
actually made, so "the button does something" is a claim under test rather than an assumption.

### D-133 [MONEY] — The on-property credit face is a visible assumption, never a silent default
With no property selected, the engine fell back to `DEFAULT_PROPERTY_CREDIT_FACE_CENTS`
($100) with nothing on screen saying so — against a real figure of $250 (The Edit) or $300
(Amex/THC). That understates perks by $150–200 on exactly the comparisons where the user has
no seeded property and is therefore already typing everything by hand.
**Chosen:** the face value is an editable field in Assumptions, it adopts the property's real
figure when one is selected, and its hint says plainly whether the number is known or guessed.
A default that changes the ranking has to be visible; §2.6 makes the same argument about
breakfast valuations, and this is the same class of assumption.

### D-131 [MONEY] — A foreign-currency paste is refused, not converted
The parser correctly reads `¥40,000` as 40,000 minor units — and then every figure downstream
is rendered and compared as dollars, because `StayContext` carries no currency (§3.2). Tokyo,
London and Paris are three of the six seeded cities (§4.4), so this is the normal case abroad.
**Chosen (conservative, §0.3 item 3):** refuse the paste and say why, naming the exchange-rate
consequence. The user converts and re-pastes — a minute of work — rather than booking against
a number wrong by a third. Adding a currency to the engine is the real fix and is a spec-level
change to §3.2, not one to make unilaterally.

### D-132 — The paste parser never assumes a channel
Every applied row defaulted to `EDIT`, silently granting 8× Ultimate Rewards, price-match
eligibility and a $250 statement credit to a pasted Marriott.com or Expedia rate. Nothing in a
rate block reliably says which portal it came from.
**Chosen:** the confirmation panel asks, and Apply stays disabled until it is answered. §13.3's
friction argument does not license guessing an input that changes the ranking — a wrong
channel is worse than one more tap.

### D-120 — Layout tokens must exist in the Tailwind scale the utility actually reads
Found by an E2E run measuring `elementFromPoint`: the fixed 220px sidebar was covering the
left edge of every screen at ≥ 640px, so small left-anchored controls could not be clicked —
by a real mouse, not just a test runner.

The cause is a silent one. `AppShell` correctly wrote `sm:pl-rail lg:pl-sidebar`, and
`tailwind.config.ts` correctly defined `sidebar` and `rail` — but under `width`, not
`spacing`. `pl-*` resolves against the **spacing** scale, so both classes emitted *nothing*.
No error, no warning, no missing-token diagnostic; the padding simply never existed.

**Chosen:** define layout dimensions in both scales, with a comment at the definition saying
why. Verified in a real browser after the fix (`mainPaddingLeft: 220px`,
`navCoversMainStart: false`) rather than by reading the config, because reading the config is
what produced the bug. A compliance test now asserts the spacing entries exist.

**The general lesson, worth keeping:** §6.1's "no raw values, tokens only" rule makes a
*wrong* value impossible but not a *missing* one — an undefined Tailwind key fails silently
and looks identical to a style nobody asked for. Token discipline needs a rendered check, not
just a grep.

### D-110 — Rate limiting is built behind a port, with an in-process implementation
§5.1 says "Rate limit mutations at 60/min/user **via Upstash**." No `@upstash/*` package is
installed and no credentials exist in this environment. The options were to skip the
requirement or to build the guarantee behind an interface.
**Chosen:** a `RateLimiter` port with a sliding-window in-process implementation, enforced in
the shared `route()` wrapper so all twenty-five routes get it without any of them opting in.
Sliding rather than fixed-window, because a fixed window permits a full quota in the last
second of one window and again in the first of the next — 2× the stated limit at exactly the
moment a limit matters.
**Stated limitation, not papered over:** the in-process counter is per instance, so on
serverless N warm instances allow up to N × the limit. `RateLimiter.distributed` is `false` and
a test asserts it. Dropping in Upstash is a one-line change at the single construction site.
`POST /api/compare` is explicitly exempt — §5.3 has it called on every keystroke behind a
250 ms debounce, and it persists nothing, so a mutation budget would throttle ordinary typing.
The exemption is a named list entry rather than an accident of pattern-matching.

### D-111 — Data export and deletion, the §12 requirement with no route in §5.2's table
§12 requires both, "from `/settings`", and says to test it. §5.2's route table lists neither,
which is how they came close to being missed entirely.
**Chosen:** `GET /api/account/export` and `DELETE /api/account`, plus the controls on
`/settings`. Three details are load-bearing:
- **`quotes` and `competing_rates` carry no `user_id`** (§4.2 scopes them through
  `comparison_id`). Exporting "every table with a userId column" silently omits the user's own
  entered rates — the data they would most want back. Both are reached through their parents.
- **Screenshots are in both paths.** They live in object storage, outside the cascade. The
  export lists their keys and the deletion returns them, gathered *before* the delete — after
  it, the rows naming them are gone and the images would be unreachable but still readable.
- **Deletion requires typing the account's email.** §1.5 promises the ledger survives the
  user's own audit, which only holds if a year of records cannot be destroyed by a mis-click.

Deletion itself is a single `DELETE FROM users` relying on §4.1's cascade, rather than
enumerating child deletes: a hand-written list silently misses a table added later, whereas a
missing cascade is caught by the test asserting every table is empty afterwards. A structural
test derives the expected export list *from the schema*, so adding a table and forgetting the
export fails the build.

### D-102 — The programme-mismatch warning stays silent when membership is unknown
§8.5 has two halves. The first — pre-populating the channel rows a property belongs to — is a
convenience. The second is the one that catches a mistake: "warn when a user is about to
compare FHR at a property that isn't in FHR." Without it the engine happily grants breakfast,
an on-property credit and a $300 statement credit that booking cannot earn, and that channel
wins the ranking on entitlements it never had.
**Chosen:** warn per quote row, naming the property, the programme, and the consequence
(§13.1's rule: name the number and the consequence in the same sentence). **Silent when there
is no property selected, and silent for channels with no programme membership to check** —
warning on absence of data would train the user to ignore the warning, which costs more than
the warning is worth. The predicate is exported and unit-tested rather than buried in JSX,
because it encodes a domain rule.

### D-101 — Part 12's constraints are enforced as tests, not just documented
§12 says its constraints are "non-negotiable" and that violating any of them "is a product
failure regardless of how well it works". A constraint that only exists in prose erodes.
**Chosen:** `src/compliance.test.ts` mechanically checks the ones that can be: no
guarantee language in user-facing copy (D-060), no password/card/CVV field anywhere, no LLM
client or `fetch` in the domain layer, no headless browser or OTA client in runtime
dependencies, no third-party analytics or session recording, no raw hex/rgba/px in components,
no `--brand` or series colour as text, and the hexagonal import boundary (D-033). Twenty-two
checks, all passing.

---

## Design system

### D-050 [OPEN] — Proceeding on the Sentry assumption from §6.1
§6.1 records that the owner's "70mm Sentry app design" request was never resolved, and
§13.2 says to ask this before starting if a question is available. The build instruction
was to implement to the fullest without waiting, so I proceeded on the **documented
Sentry assumption** with its canonical values.
**Mitigation, which is the actual answer to the risk:** every colour, radius, spacing,
type and motion value lives in `src/styles/tokens.css` alone. No component contains a raw
hex, rgba, px font size or px radius. Swapping design systems is a one-file edit; I verify
this by actually performing a throwaway palette swap in development and reverting.
**This remains open and is the one question worth the owner's time.**

### D-051 — Light mode is authored, never derived
§6.2 and §13.2 item 5 both forbid generating light from dark. **Chosen:** two independent
token blocks with the spec's own verified contrast values. No `invert()`, no lightness
negation, no filter. Radii, spacing, type and motion are shared and declared once.

### D-052 — `--brand` is never used as a text colour in any component
It clears contrast in light mode (6.5:1) but not dark (3.3:1). A component cannot know the
theme. **Chosen:** components use `--text-*` for text and `--brand` only for fills,
borders and large text. Enforced by a lint rule rather than review discipline, per §6.7.

### D-053 — The focus ring token is theme-dependent and therefore indirected
§6.7 requires lime in dark and brand in light. **Chosen:** a `--focus-ring` token defined
in both blocks; components reference only `--focus-ring` and never choose.

---

## Product behaviour

### D-060 [LEGAL] — No copy anywhere states or implies a guaranteed refund
§12 bans "guaranteed savings". **Chosen:** estimates are labelled "estimated", the
price-match panel carries the partial-approval caveat inline (not in a tooltip), and a
persistent quiet disclaimer appears on every screen showing money. A test greps the
rendered copy for "guarantee" outside the proper nouns "Best Rate Guarantee" and "Lowest
Hotel Rate Guarantee".

### D-061 — The paste parser is regex-based and always shows its work
§13.3 requires it and §1.4 forbids an LLM in any numeric path. **Chosen:** explicit
pattern matchers per source, a confirmation step rendering every extracted field before it
reaches the engine, and a hard rule that an unparsed field stays empty rather than being
guessed.

### D-080 [MONEY] — The paste parser refuses an ambiguous numeric date rather than picking one
`01/09/2026` is 1 September to half the world and 9 January to the other half. §2.3.1's PM8
requires the competing rate to match the booking exactly on dates, so a silently wrong check-in
does not produce a slightly-off comparison — it produces a claim that gets denied after the
user has done all the work.
**Chosen:** parse a slash-separated date only when one field exceeds 12 and the order is
therefore unambiguous. Otherwise return null and list it as missing. The same rule governs
every field: an unparsed value stays empty rather than being guessed.

### D-081 [MONEY] — Money parsing is string assembly, never `parseFloat(x) * 100`
`19.99 * 100` is `1998.9999999999998` in IEEE-754. §3.1 forbids a float touching money at all.
**Chosen:** split on the last separator and reassemble the integer by string concatenation, so
no floating-point value ever exists. A three-digit tail is read as a thousands group (no
currency has three minor digits); a one- or two-digit tail is the minor unit; anything else is
refused. Zero-decimal currencies (JPY, KRW) are handled explicitly — reading `¥40,000` as
40000 minor units instead of 4,000,000 would understate a Tokyo stay by a factor of a hundred.

### D-082 — The parser takes the pessimistic reading of a cancellation policy
§2.3.3 calls a cancellation-policy mismatch "the universal denial cause, all programs". A block
saying "free cancellation until Sep 1, non-refundable thereafter" is a rate that will be
non-refundable by the time it matters.
**Chosen:** when both refundable and non-refundable phrasing appear, report non-refundable, and
give the explicit non-refundable match `high` confidence against `medium` for the refundable
one. Under-claims eligibility rather than over-claiming it.

### D-083 — A parse that found no money is not offered for confirmation
`isParseUseful` gates the confirmation panel on at least a total or a base rate having been
found. Showing a confirmation for a block that yielded only a currency symbol trains the user
to click through the confirmation step — and that step is the entire safety mechanism §13.3
requires.

### D-090 — `totalsFor` returns realized and projected separately, with no combined field
§8.6 forbids conflating them and §1.5 makes the ledger's auditability a success criterion.
**Chosen:** the totals object has no `totalCents`. A caller that wants one number has to write
the addition itself and, in doing so, notice that it is mixing banked money with expected
money. The CSV export spells the status as `banked`/`projected` rather than `TRUE`/`FALSE` for
the same reason — a boolean column invites summing the amount column in a spreadsheet.

### D-091 — A realized savings event must reference a booking or a claim
An entry that says money was banked but cannot say where it came from is exactly what fails
§1.5's audit criterion.
**Chosen:** enforced as a constructor invariant. Projected events may have no source, since
nothing has happened yet.

### D-092 — `Comparison` exposes no way to mutate its snapshot
§4.3 forbids recomputing a historical comparison in place, and §13.3 predicts this will be
gotten wrong because "the instinct is to recompute everything on read."
**Chosen:** make it structurally impossible rather than a rule to remember. The snapshot is
frozen at construction, there is no setter and no `update`/`refresh` method, and `recomputeAs()`
returns a **new aggregate with a new id** linked back via `recomputedFromId`. A test asserts
the absence of those method names, so adding one later fails the build.

### D-062 — Credit buckets are seeded data with windows, and window membership is date-driven
§2.4 says do not hardcode. **Chosen:** `credit_buckets` rows carry their own
`window_start` / `window_end`; the "is this bucket available" question is a date range
test against the *booking* date, not the stay date — because a prepaid booking made now
for a stay next year burns this window's credit (§7.5 calls this out as the
highest-leverage non-obvious move).

### D-063 — `CSR_TRAVEL`'s cardmember-year window is derived from a user-set anniversary
§2.4 gives the window as "cardmember year (user-set anniversary)". **Chosen:** when the
anniversary is unset, the bucket seeds against the calendar year and the UI flags it as an
assumption with a direct link to set the real date, rather than silently guessing.

### D-064 — Recompute always creates a new row; the original is immutable
§4.3, restated here because §13.3 predicts it will be gotten wrong. Enforced by the
repository interface: there is no `update` method that touches `context_snapshot` or
`result_snapshot`.

### D-150 — SPA/RESORT realization auto-default is a UI heuristic, not a versioned rule constant
Product review flagged that a property's credit `kind` of SPA or RESORT left `realizationPct`
at the general 100% default, contradicting `PROPERTY_CREDIT_KIND_HINTS`'s own hint text
("worth far less than face unless a treatment is already planned"). §2.6 gives 100% as the
default and makes realization per-stay editable, but names no alternate figure for a spa/resort
credit, and §2.8 reserves `src/domain/rules/**` for figures with a `verifiedOn` date and a
source — there is no primary source for "the typical fraction of a spa credit a cardholder
actually uses."
**Chosen:** 60%, defined locally in `CompareScreen.tsx`
(`SPA_RESORT_REALIZATION_PCT_DEFAULT`) rather than in `src/domain/rules/perks.rules.ts` — a
deliberately rough, conservative-leaning midpoint between "ignored" and "fully used," applied
only when the property's selection has not already been overridden by the user
(`realizationPctTouched`, sticky for the session once set). Still fully user-editable per §2.6.

### D-151 — A free-text-created property (Defect B) persists with no known programme membership
§7.3 item 1 and §13.3 require free text to create a property inline rather than forcing a
detour to `/properties`. `savePropertyOverride` (`src/features/properties/actions.ts`) shadows
by name, not by id, and returns only `{ok}` — never a server-issued uuid — so the created row
selected in the same session carries a synthetic client-side id (`local-…`), the same shape
`ComparePage`'s own `seed-…` DB-unreachable fallback already uses.
**Chosen:** the created property gets brand `NONE` and no FHR/THC/Edit flags — guessing
programme membership for a property the seed data has never heard of is exactly the kind of
silent guess §0.3 forbids — and a visible, dismissable-by-navigation note tells the user its
membership is unknown until set on `/properties` (§8.5). `CompareScreen`'s `saveInput` treats
both `seed-` and `local-` ids as "no real foreign key yet" and saves the comparison unlinked,
named from the snapshot instead, rather than sending a bogus `propertyId` to `POST
/api/comparisons`.

### D-152 — The page tier bypassed the query-layer filter; the filter is now unskippable
A 2026-08-02 security review found the worst kind of gap: `/trips`, `/ledger` and `/watchlist`
called `listTrips()` / `listSavingsEvents()` / `listWatchlistBookings()` with no arguments,
and those functions' optional `userId` fell back to an unfiltered read — every user's rows,
served to anyone, signed in or not. `/claims` had the sibling bug
(`.where(session ? … : undefined)`, and Drizzle treats `undefined` as "no WHERE"), and the
three `[id]` detail pages fetched by UUID with no owner check at all. The API tier was scoped
correctly throughout; the leak lived entirely in the server-component pages, which do not pass
through `route()`.
**Reason:** an optional scoping parameter makes "forgot to scope" compile, run, and render
convincingly. Nothing in the type system distinguished the safe call from the leaking one.
**Chosen:** make the parameter required and delete the fallbacks — the unscoped query no
longer exists to be called. Every `(app)` page resolves the session itself (outside its
try/catch, since `redirect()` throws) and passes `session.userId`; detail pages AND their
queries take the owner id, so a wrong-owner UUID is indistinguishable from a missing one.
Three layers now stack: `middleware.ts` (cookie-presence redirect — a router, not a guard;
Edge runtime cannot verify HMACs from `node:crypto`), the `(app)` layout's `getSession()`
gate, and the required parameter, which is the only layer that cannot be forgotten.

### D-153 — Sign-up is the magic-link request itself
`RequestMagicLinkUseCase` used to look up the address and silently bail if no user existed —
correct anti-enumeration behavior, but combined with "nothing else ever inserts a `users`
row," it meant no stranger could ever use a deployed instance at all. Sign-in existed;
sign-up did not.
**Reason:** magic-link auth means an email address *is* an account. A separate registration
flow would collect nothing extra (no password, no profile — §12) and would necessarily
introduce the "does this account exist yet" distinction that enumeration defenses then have
to hide.
**Chosen:** `findOrCreateUserByEmail` — an unknown address gets a user row and the same link
a known one gets, atomically idempotent under the `users.email` unique constraint. The
enumeration surface is removed rather than disguised: there is no "no such user" branch left
to time. The email-budget check runs *before* creation, so a bombing run cannot
mass-manufacture rows; the response floor (D-behavior in `MIN_RESPONSE_FLOOR_MS`) keeps
timing uniform.

### D-154 [OPEN] — Sessions now expire server-side; revocation is still cookie-deep only
Sessions were signed but carried no expiry claim: the cookie's `maxAge` was the only limit,
and `maxAge` is a request to the browser, not a property of the value — a captured cookie
worked forever. There was also no way to log out.
**Chosen:** an `exp` claim (30 days, `SESSION_TTL_SECONDS`) inside the signed payload,
enforced in `decodeSession` — cookies without it (the old format) are rejected outright,
which forcibly re-authenticates existing sessions once, deliberately. `POST /api/auth/logout`
clears the cookie (POST, not GET — a GET logout is CSRF-by-prefetch). **Still open:** the
value is stateless, so logout removes the browser's copy without revoking the value itself;
`exp` bounds the exposure. True server-side revocation (the so-far-unused `sessions` table)
remains the follow-up.

### D-155 — Magic-link tokens are digested at rest
`verification_tokens.token` stored the raw UUID the emailed link carries, and — worse — the
raw token rode into the logs inside the notifier's `idempotencyKey` whenever `RESEND_API_KEY`
was unset and `LoggingNotifier` printed the message instead of sending it. Anyone with read
access to either could sign in as anyone mid-window.
**Chosen:** store `sha256(token)` (`tokenDigest.ts`); the verify path digests before lookup;
the idempotency key uses a digest prefix. Plain SHA-256 with no salt or work factor,
deliberately: these are 122-bit random values with a 15-minute lifetime, not passwords —
there is nothing to dictionary-attack, and the digest only needs to be one-way.

### D-156 — CSP ships with `'unsafe-inline'` scripts rather than not shipping
**Reason:** Next.js's own bootstrap and the flash-free theme snippet
(`THEME_BOOTSTRAP_SCRIPT`) are inline scripts; a nonce-based policy requires per-request
nonces threaded through `headers()` into every inline emission, which Next only supports via
middleware-generated CSP — heavier machinery than this change should carry.
**Chosen:** a real policy now — `default-src 'self'`, `connect-src 'self'` (the §12 promise
that nothing phones out, now enforced by the browser too), `frame-ancestors 'none'`,
`form-action 'self'`, img/font locked to self — accepting `script-src 'unsafe-inline'` until
a nonce pass. A CSP that blocks exfiltration and embedding today beats a perfect one that
stays on the backlog.

### D-157 — `db:migrate` and `db:seed` load `.env` themselves
The README's clean-clone sequence — `cp .env.example .env`, then `pnpm db:migrate` — failed
on step 5 with "DATABASE_URL is not set": Next.js loads `.env` for the app, but nothing
loaded it for a bare `tsx` script. The docs promised eight working commands and delivered
seven.
**Chosen:** a side-effect `load-env.ts` using Node's built-in `process.loadEnvFile()` —
`engines` already floors at Node 22.13, so this costs zero dependencies. Exported shell
variables still win (same precedence as Next); a missing `.env` is silently fine because CI
sets real variables and has no file.

### D-158 — The second design system: measured from airbnb.com, swapped in one file
D-050's bet — every design value behind a token, "swapping to a different design system must
be a single-file edit" — got its test on 2026-08-03 when the owner asked for a cleaner,
Airbnb-inspired UI. The system was *measured*, not eyeballed: computed styles pulled from
airbnb.com gave the palette (ink `#222` on white, rausch `#FF385C` with `#DA1249` as its
pressed/deep step, `#DDDDDD` hairlines, `#F7F7F7` wells, warm sand `#F4F2EC`), the radii
(8px inputs, 12px cards, pills for everything interactive), exactly four layered shadows,
and the 28/22/16/14/12 type scale in weights 400–700.
**Chosen:** rewrite `tokens.css` values under the *existing* token names (`--accent-lime`
is now a historical name for "CTA fill"; a rename is mechanical follow-up), flip the app
light-first (`:root` = light, `[data-theme='dark']` the override, bootstrap error-fallback
`light`), and re-step any measured pair that misses WCAG AA for this app's denser text —
raw rausch on white is 3.9:1, so text and CTA fills use the deep step at 5.9:1 and the raw
hue is reserved for large figures. The typeface is the system stack — Airbnb's own fallback
chain — because Cereal is proprietary and copying assets was never the assignment. Dark
mode is re-authored as neutral charcoal (Airbnb ships no web dark mode to measure), same
verification discipline. Status and data-viz hues are untouched: the CVD separation numbers
are math, not taste, and survive the swap. Component changes: `Button` goes pill + semibold
— the rest of the app restyled itself, which was D-050's whole promise.

### D-159 — Claim evidence lives in Postgres, behind the same signed-URL contract
The evidence flow minted signed upload URLs pointing at `/api/storage/upload` — a route that
did not exist. The spec's shape (presigned PUT, §5.2) assumed a bucket this deployment does
not have, and shipping a dead endpoint dressed as a working one is worse than either option
below.
**Chosen:** implement the route for real against a new `evidence_blobs` table (`bytea`, 5 MB
cap, content-type allowlist shared as one constant between the mint schema and the upload
route — the two layers previously disagreed, so a mint could succeed and the very next PUT
422). The URL contract is unchanged and S3-shaped — `HMAC(key:exp:contentType:userId)`,
verified constant-time, expiry checked after — so swapping Postgres for a real bucket later
changes the storage adapter and nothing else. Reads require a session and return 404 for
"missing" and "not yours" alike. A database is not a blob store at scale; at "screenshots
attached to claims by one household," it is exactly one fewer external dependency.

### D-160 — A command palette is the one overlay the modal ban permits
§0.5 bans any modal that could have been an inline expansion. The ⌘K palette is a genuine
global overlay: it belongs to no page section, exists only while summoned, and duplicates
nothing an inline expansion could host. It ships (cmdk inside a Radix Dialog with a real
focus trap) with navigation, theme, and sign-out commands; the sidebar advertises it with a
muted `⌘K` hint. Sign-out itself is deliberately *not* a 9th mobile tab — a destructive
account action does not belong in a navigation row — so the tap-only path lives on
`/settings` ("Signed in as …" row), which the mobile tab bar now reaches directly.

### D-161 — Sign-up-adjacent UX: the first run gets a banner, the cards setting gets teeth
Two follow-ons from D-153 opening the door to strangers. First: a brand-new user landed on
an empty `/compare` with no orientation at all. Now a zero-comparisons account (and only
one that hasn't dismissed it) sees one inline banner — never a modal, §0.5 — explaining the
sixty-second loop, with a "load a sample comparison" action that builds a clearly-labelled
`Sample ·` DRAFT against a seeded global property, dated 60 days out so it never reads as a
past stay. Second: the `/settings` cards section was fully built and read by nothing —
add or remove a card and every screen still assumed Amex Platinum + CSR. The read side now
exists (`listActiveCards`, required `userId`): configured cards gate which credit surfaces
render on `/credits` and `/compare`, enforced where the engine `context` is built (not just
at render, so a stale toggle can never leak a phantom credit into the math), with a visible
"cards you don't hold are hidden" line so the gating is legible rather than mysterious.
Zero cards configured keeps the both-cards default — the founding assumption, and what the
demo account shows.
