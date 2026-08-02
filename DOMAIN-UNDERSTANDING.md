# DOMAIN-UNDERSTANDING.md

> Required by Part 14 of `parity-build-spec.md`. This is the domain restated in my own
> words *before* implementation, so a misreading surfaces here rather than in the engine.
> Where my reading disagrees with the spec's prose, I say so explicitly and log it in
> [`DECISIONS.md`](./DECISIONS.md).

---

## 1. The channels

A **channel** is a way of buying the same night in the same room at the same hotel. The
product's entire premise is that these are not interchangeable: the same room bought
through different doors has materially different *effective* cost once perks, statement
credits, points, refunds and rebates are netted out.

> **Discrepancy found.** §2.2 says "Eight channels" in its prose sentence, but the table
> beneath it lists **nine** enum values, and the `Channel` union type in §3.2 also lists
> nine. I implement **nine** — the type declaration and table agree with each other, so
> the prose count is the outlier. Logged as `D-001`.

| # | Enum | What it actually is | Portal perks? | Credit it can unlock | Points | Price-matchable by the issuer |
|---|---|---|---|---|---|---|
| 1 | `FHR` | Amex Fine Hotels + Resorts | **yes** | Amex $300 half-year bucket, any length of stay | 5× MR when prepaid, **1× when paying at the property** | **No — and this is the product's central fact** |
| 2 | `THC` | Amex The Hotel Collection | **yes** | Amex $300 bucket, **2-night minimum** | 5× MR prepaid | **No** |
| 3 | `EDIT` | Chase The Edit | **yes** | Edit $250 bucket, **2-night minimum** | 8× UR on the portion no credit covered | **Yes** |
| 4 | `CHASE_TRAVEL` | Chase Travel, outside The Edit | no | select-brands $250 where the brand qualifies | 8× UR | **Yes** |
| 5 | `DIRECT_FLEX` | Hotel's own site, flexible member rate | no | none | chain points, modelled only in the BRG path | No issuer match — but **BRG-eligible** |
| 6 | `DIRECT_PREPAID` | Hotel's own site, advance purchase | no | none | chain points, BRG path only | No |
| 7 | `OTA` | Expedia, Booking.com, etc. | no | none | ~1% cash-equivalent loyalty | No |
| 8 | `FORA` | Booked through the user's own Fora advisor account | partner perks vary | **none — cannot use portal credits** | none | No |
| 9 | `PHONE` | Negotiated directly by telephone | varies | none | chain points, BRG path only | No |

Two things I want to be sure I have right:

- **`grantsPortalPerks` is exactly three channels: `FHR`, `THC`, `EDIT`.** It means
  breakfast for two plus the on-property credit. `CHASE_TRAVEL` is explicitly `no` in the
  table even though it is a Chase portal — only The Edit carries the perks.
- **`PHONE` is a data-entry row, not an action.** The app never places a call. It exists
  so a negotiated quote can be ranked honestly against the portals.

## 2. The nine Chase price-match conditions

These are a **conjunction** — every one must hold. I implement them as a list of named
predicates rather than one boolean, because the UI has to say *which* one failed. "Your
claim doesn't qualify" is useless; "your claim doesn't qualify because the competing rate
is non-refundable" tells the user what to go fix.

| ID | Condition | The trap in it |
|---|---|---|
| **PM1** | The card is Sapphire **Reserve**, Reserve for Business, or J.P. Morgan Reserve | Sapphire *Preferred* and Ink Preferred do **not** qualify. Card tier, not card family. |
| **PM2** | The booking was made through Chase Travel | **The Edit counts.** Chase confirmed this. Getting this wrong silently deletes the product's best feature. |
| **PM3** | The booking is prepaid | Pay-at-property Chase bookings are out. |
| **PM4** | The booking is unmodified and uncancelled | Any change voids it. |
| **PM5** | The claim is filed within **24 hours of booking** | A hard cutoff measured from booking time, not from check-in. This is the deadline the whole `/claims` screen exists to defend. |
| **PM6** | Check-in is at least **24 hours away** | No same-day claims. |
| **PM7** | The nightly **base-rate** difference is **strictly greater than $5.00** | *Strictly.* A gap of exactly 500 cents/night fails. Not `>=`. TC-03 tests right at this boundary. |
| **PM8** | The competing rate matches exactly on hotel name, address, dates, room type, bed type, **refund policy**, guest count and currency | The refund-policy clause inside PM8 is what kills a cheaper non-refundable rate quoted against a refundable booking. |
| **PM9** | The competing rate is **publicly available** | Member, loyalty, AAA, AARP, corporate, government, military, group, package, opaque-site and promotional rates are all excluded — **even when the membership is free and signup is instant.** That last clause is the one people get wrong. |

**What gets paid.** The base-rate difference, back to the original form of payment
(card or points), typically one to two billing cycles.

**What never gets paid: taxes and fees, on either side of the comparison.** The engine
compares base rates only, and the UI has to show the tax figure as explicitly
non-recoverable so the user doesn't expect it back.

**Honesty requirement.** Partial approval is common. One documented Edit claim was
approved in under five hours but paid $100 against a $116.31 gap, described as a
courtesy, despite two parameter mismatches. So: model the **full gap as the estimate**,
and never let the word "guaranteed" appear near it.

## 3. Why Amex FHR cannot be price matched — the asymmetry

Amex *does* run a Lowest Hotel Rate Guarantee on amextravel.com. It **explicitly excludes
Fine Hotels + Resorts and The Hotel Collection** — precisely the two programs a Platinum
holder would actually use for a luxury stay.

The consequence, stated plainly:

> **An FHR booking has no price-match backstop. If FHR is marked up over the market, the
> user simply eats the difference, permanently.**

The Edit does have that backstop. So even when FHR looks nominally competitive on sticker,
**The Edit is the more defensible booking**, because its downside is capped by a claim the
user can actually file. FHR's downside is not capped at all.

This is asymmetric *risk*, not asymmetric price, which is why it can't be read off the
ranked list — the ranking compares expected values, and this is about what happens when
the expectation is wrong. That is why §8.4 requires it rendered as a persistent,
first-class note with this comparison's specific dollar consequence, and not as a tooltip.

It is also why fixture **TC-06** exists: it is a tripwire for the single most likely
implementation bug, which is applying the Chase price-match branch to an Amex channel
because both are "portals". `pmQualifies` is gated on channel membership in
`{EDIT, CHASE_TRAVEL}` *first*, before anything else is evaluated.

## 4. The clawback formula

A statement credit does not key off what the room *cost*. It keys off **what the user
actually charged to the card**. A price-match refund reduces that charge. If the charge
after the refund lands below the credit's face value, the issuer takes back the
difference.

```
netCharge     = total − refund
creditKept    = min(face, max(0, netCharge))
clawback      = face − creditKept
minCashFloor  = face + expectedRefund
```

Worked through TC-05, which is the fixture built to expose exactly this:

```
total          40000   ($400.00 Edit booking, 2 nights, prepaid, refundable)
refund         22237   (a $222.37 price-match gap, and it qualifies)
netCharge      17763   = 40000 − 22237      → only $177.63 ever stays charged
face           25000   ($250 Edit bucket, 2-night minimum satisfied)
creditKept     17763   = min(25000, 17763)  → the credit is capped by the charge
clawback        7237   = 25000 − 17763      → $72.37 of credit evaporates
minCashFloor   47237   = 25000 + 22237      → $472.37
```

**What `minCashFloor` means, in the user's language:** *charge at least $472.37 in cash to
this card and pay the rest with points, or the price-match refund will drag your charge
below $250 and you will lose part of the credit.*

That number has to be on screen **before** the user leaves for the booking portal. After
they have booked it is a post-mortem, not a decision. §8.3 requires it phrased as an
instruction naming both the number and the consequence — "Charge at least $472.37" — not
as a statistic like "Clawback protection active."

I believe this is the single most valuable computation in the product, because it is the
only one where the app tells the user to do something differently *right now*, and it is
not a number any competing tool produces.

## 5. The engine's exact order of operations

Order is load-bearing. **Credits are computed after the refund**, because the refund
changes the charge the credit keys off. Reversing steps 7 and 8–10 silently produces a
too-generous number in exactly the case (TC-05) where the user most needs the truth.

```
 1.  baseCents   = round(totalCents / (1 + taxRateBps/10000))
 2.  taxCents    = totalCents − baseCents                      // exact identity, always
 3.  perks       = grantsPortalPerks
                     ? breakfastPerDayCents × nights
                       + round(propertyCreditFaceCents × realizationPct / 100)
                     : 0
 4.  gap         = competitorBaseCents === null ? 0 : baseCents − competitorBaseCents
 5.  perNight    = nights > 0 ? round(gap / nights) : 0
 6.  pmQualifies = channel ∈ {EDIT, CHASE_TRAVEL}
                   ∧ prepaid ∧ refundable
                   ∧ competitorRefundable ∧ competitorPublic
                   ∧ competitorBaseCents !== null
                   ∧ perNight > 500                            // STRICTLY greater
 7.  refund      = pmQualifies ? gap : 0
 8.  face        = creditFaceFor(channel, prepaid, nights, bucketsAvailable)
 9.  netCharge   = totalCents − refund
10.  creditKept  = min(face, max(0, netCharge))
11.  clawback    = face − creditKept
12.  points      = pointsFor(channel, prepaid, total, netCharge, creditKept, values)
13.  rebate      = channel === FORA ? round(totalCents × foraRateBps / 10000) : 0
14.  net         = totalCents − perks − creditKept − points − refund − rebate
15.  nightly     = round(net / nights)
```

`creditFaceFor` — four cases, and the two-night minimum applies to two of them:

| Channel | Prepaid | Bucket live | Nights | Face |
|---|---|---|---|---|
| `FHR` | yes | Amex | any | **30000** |
| `THC` | yes | Amex | ≥ 2 | **30000** |
| `EDIT` | yes | Edit | ≥ 2 | **25000** |
| anything else | — | — | — | **0** |

`pointsFor` — note that only the Chase channels net off the credit:

| Channel | Earns on | Rate |
|---|---|---|
| `FHR` / `THC`, prepaid | full `totalCents` | 5× MR |
| `FHR` / `THC`, **not** prepaid | full `totalCents` | **1× MR** — the expensive mistake, warned about |
| `EDIT` / `CHASE_TRAVEL` | `netCharge − creditKept` | 8× UR |
| `OTA` | `totalCents` | 1% cash-equivalent |
| direct / Fora / phone | — | 0 in the engine; chain points live in the BRG comparison |

### Things I checked because they are easy to get subtly wrong

- **`effectiveNetCents` may legitimately be negative.** TC-05 nets −$240.00. Perks plus
  credit plus refund can exceed a cheap stay's sticker. The engine returns the true
  negative; the UI clamps only the *bar length* at zero and still prints the real figure;
  ranking uses the true value; and the `OVER_SUBSIDIZED` warning fires so an inflated
  breakfast valuation gets questioned rather than celebrated.
- **Money is integer cents everywhere, never a float.** Rates that aren't money are
  integers too: tax in basis points (`1240` = 12.40%), point values in micro-cents per
  point (`17500` = 1.75¢). Rounding is `Math.round`, **half away from zero**, applied at
  every division — which matters for negative gaps, where TC-01's `DIRECT_PREPAID` row
  expects `perNight = −5991` and not `−5990`.
- **Tax identity is exact by construction.** `tax = total − base`, computed by
  subtraction rather than by its own rounding, so `base + tax === total` holds for every
  input with no reconciliation drift.
- **A BRG and a Chase price match never stack.** They are mutually exclusive paths —
  a BRG requires booking direct with the chain, which by definition is not a portal
  booking. The UI must render them as a fork with an explicit "choose one", never as two
  additive savings.
- **The gap can be negative** (the user's own rate is already the cheapest). Then
  `pmQualifies` is false and the UI says "no lower rate found" — never a negative refund.

### Verification before implementation

I built a throwaway reference implementation from this restatement alone and ran all of
§3.8 through it. It reproduces every published figure exactly: TC-01's six net values
(239086 / 272000 / 317000 / 325500 / 350000 / 356400) and the `−5991` rounding edge,
TC-02 (260586 / 302000), TC-03 and TC-04 (251940, both non-qualifying for different
reasons), TC-05 (net −24000, clawback 7237, `minCashFloor` 47237), TC-06 (272000 with no
refund), TC-07 (70836 with face 0), TC-08 (137419 / 158919 and a Hyatt BRG all-in of
175164 plus 5,000 points), and TC-09's break-even at **4399.54 micro-cents ≈ 0.4400¢**,
inside the ±0.01¢ tolerance the spec requires.

The fixtures are ground truth and my reading of them is consistent. Proceeding.
