/**
 * `pnpm db:seed` — §4.4.
 *
 * Idempotent: safe to re-run against a database that already has some or all
 * of this data. Every section checks what already exists before writing,
 * rather than assuming a clean table — the same discipline Part 9's cron jobs
 * need, applied to a script instead of a schedule.
 *
 * Seeds three things:
 * 1. The ~45 properties in `properties.seed.ts`, `user_id = NULL` (global).
 * 2. The six credit-bucket definitions, each for the current and the next
 *    occurrence of its window, against one demo user.
 * 3. A demo account (`demo@parity.local`) with two saved comparisons and one
 *    open claim, so a freshly-cloned, freshly-migrated database still demos
 *    (§0.4, §4.4) — set `PARITY_DEMO_USER` in `.env` to the id this script
 *    prints to sign in as it locally with no SMTP provider configured.
 */
import '../load-env';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { users, userSettings, properties, comparisons } from '../schema';
import { PROPERTY_SEEDS } from './properties.seed';
import { CREDIT_BUCKET_DEFINITIONS, type CreditBucketDefinition } from '@/domain/rules/credit.rules';
import { windowForDefinition, type DateWindow } from '@/domain/credit/CreditWindow';
import { SavingsEngine } from '@/domain/engine/SavingsEngine';
import type { StayContext, ChannelQuote } from '@/domain/engine/types';
import { cents } from '@/domain/shared/cents';
import { Booking } from '@/domain/booking/Booking';
import { Claim, type ClaimKind } from '@/domain/claim/Claim';
import { DrizzleComparisonRepository } from '../repositories/DrizzleComparisonRepository';
import { DrizzleBookingRepository } from '../repositories/DrizzleBookingRepository';
import { DrizzleClaimRepository } from '../repositories/DrizzleClaimRepository';
import { DrizzleCreditBucketRepository } from '../repositories/DrizzleCreditBucketRepository';

/**
 * The demo account this script builds. Overridable by environment so the E2E
 * suite can seed one fixture account *per Playwright worker*
 * (`e2e/support/constants.ts` explains why: a shared account meant one spec's
 * reset cascade-deleted a sibling spec's in-flight data). Unset — a plain
 * `pnpm db:seed`, and worker slot 0 — is the canonical pair below, so the
 * documented local setup is unchanged.
 */
const DEMO_USER_ID = process.env.PARITY_SEED_USER_ID ?? '11111111-1111-4111-8111-111111111111';
const DEMO_EMAIL = process.env.PARITY_SEED_EMAIL ?? 'demo@parity.local';
const DEMO_ANNIVERSARY = '2020-03-15';

async function seedDemoUser(): Promise<void> {
  await db
    .insert(users)
    .values({ id: DEMO_USER_ID, name: 'Demo User', email: DEMO_EMAIL })
    .onConflictDoNothing({ target: users.email });

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
  const demoUserId = existing?.id ?? DEMO_USER_ID;

  await db
    .insert(userSettings)
    .values({ userId: demoUserId, cardmemberAnniversary: DEMO_ANNIVERSARY, foraMember: true })
    .onConflictDoNothing({ target: userSettings.userId });

  console.log(`[seed] demo user ready: ${demoUserId} <${DEMO_EMAIL}>`);
}

async function resolveDemoUserId(): Promise<string> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
  if (!row) throw new Error('Demo user was not created — seedDemoUser() must run first.');
  return row.id;
}

async function seedProperties(): Promise<void> {
  let inserted = 0;
  for (const seed of PROPERTY_SEEDS) {
    const [existing] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(sql`${properties.userId} IS NULL AND lower(${properties.name}) = lower(${seed.name})`)
      .limit(1);
    if (existing) continue;

    await db.insert(properties).values({
      userId: null,
      name: seed.name,
      address: seed.address,
      city: seed.city,
      country: seed.country,
      brand: seed.brand,
      inFhr: seed.inFhr,
      inThc: seed.inThc,
      inEdit: seed.inEdit,
      propertyCreditFaceCents: seed.propertyCreditFaceCents,
      propertyCreditKind: seed.propertyCreditKind,
      notes: seed.notes,
    });
    inserted += 1;
  }
  console.log(`[seed] properties: ${inserted} inserted, ${PROPERTY_SEEDS.length - inserted} already present.`);
}

/**
 * §4.4: "the six credit buckets for the current AND next window." For every
 * kind but `FIXED` that means this year's occurrence and next year's. A
 * `FIXED` window (`CSR_BRANDS`, a fixed end date through 2026-12-31) has no
 * distinct "next" occurrence before the programme itself ends — computing one
 * naively would set a window start *after* its end, which
 * `CreditBucket.create` correctly rejects as invalid — so it seeds once.
 */
function windowsToSeed(definition: CreditBucketDefinition, currentYear: number): DateWindow[] {
  if (definition.windowKind === 'FIXED') {
    return [windowForDefinition(definition, { year: currentYear })];
  }
  return [
    windowForDefinition(definition, { year: currentYear, anniversary: DEMO_ANNIVERSARY }),
    windowForDefinition(definition, { year: currentYear + 1, anniversary: DEMO_ANNIVERSARY }),
  ];
}

async function seedCreditBuckets(demoUserId: string): Promise<void> {
  const currentYear = new Date().getUTCFullYear();
  const creditBuckets = new DrizzleCreditBucketRepository();

  let count = 0;
  for (const definition of CREDIT_BUCKET_DEFINITIONS) {
    for (const window of windowsToSeed(definition, currentYear)) {
      await creditBuckets.upsert({
        userId: demoUserId,
        cardId: null,
        key: definition.key,
        label: definition.label,
        faceCents: definition.faceCents,
        window,
      });
      count += 1;
    }
  }
  console.log(`[seed] credit buckets: ${count} rows upserted for the demo user.`);
}

/** TC-01's published fixture inputs (`application.test.ts`) — a real, checked ranking. */
function tc01Context(): StayContext {
  return {
    nights: 3,
    taxRateBps: 1240,
    breakfastPerDayCents: cents(7_000),
    propertyCreditFaceCents: cents(10_000),
    realizationPct: 100,
    mrValueMicro: 15_000,
    urValueMicro: 17_500,
    foraRateBps: 700,
    amexBucketAvailable: true,
    editBucketAvailable: true,
    competitorBaseCents: cents(300_000),
    competitorRefundable: true,
    competitorPublic: true,
    brand: 'NONE',
  };
}

async function seedDemoComparisonsAndClaim(demoUserId: string): Promise<void> {
  const [comparisonCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(comparisons)
    .where(eq(comparisons.userId, demoUserId));
  const existingComparisons = comparisonCountRow?.count ?? 0;

  const comparisonRepository = new DrizzleComparisonRepository();
  const engine = new SavingsEngine();

  if (existingComparisons >= 2) {
    console.log('[seed] demo comparisons already present — skipping.');
  } else {
    const context = tc01Context();
    const quotes: ChannelQuote[] = [
      { channel: 'EDIT', totalCents: cents(354_000), prepaid: true, refundable: true },
      { channel: 'FHR', totalCents: cents(360_000), prepaid: true, refundable: true },
    ];
    const outcome = engine.compare({ context, quotes });

    const savedComparison = await comparisonRepository.create({
      userId: demoUserId,
      propertyNameSnapshot: 'Four Seasons Hotel Tokyo at Otemachi',
      checkIn: '2026-11-10',
      checkOut: '2026-11-13',
      nights: 3,
      taxRateBps: context.taxRateBps,
      realizationPct: context.realizationPct,
      contextSnapshot: context,
      resultSnapshot: outcome.results,
      engineVersion: outcome.engineVersion,
      status: 'BOOKED',
      chosenChannel: 'EDIT',
      quotes: quotes.map((quote, index) => ({
        channel: quote.channel,
        totalCents: quote.totalCents,
        prepaid: quote.prepaid,
        refundable: quote.refundable,
        sortIndex: index,
      })),
      competingRate: {
        siteDomain: 'fourseasons.com',
        url: 'https://www.fourseasons.com/otemachi/',
        baseCents: context.competitorBaseCents ?? cents(300_000),
        refundable: true,
        publiclyAvailable: true,
        capturedAt: new Date(),
      },
    });

    const draftContext: StayContext = { ...context, nights: 2, competitorBaseCents: null };
    const draftQuotes: ChannelQuote[] = [
      { channel: 'THC', totalCents: cents(240_000), prepaid: true, refundable: true },
    ];
    const draftOutcome = engine.compare({ context: draftContext, quotes: draftQuotes });

    await comparisonRepository.create({
      userId: demoUserId,
      propertyNameSnapshot: 'The Peninsula Chicago',
      checkIn: '2026-12-05',
      checkOut: '2026-12-07',
      nights: 2,
      taxRateBps: draftContext.taxRateBps,
      realizationPct: draftContext.realizationPct,
      contextSnapshot: draftContext,
      resultSnapshot: draftOutcome.results,
      engineVersion: draftOutcome.engineVersion,
      status: 'DRAFT',
      quotes: draftQuotes.map((quote, index) => ({
        channel: quote.channel,
        totalCents: quote.totalCents,
        prepaid: quote.prepaid,
        refundable: quote.refundable,
        sortIndex: index,
      })),
    });

    console.log('[seed] demo comparisons: 2 inserted (one BOOKED, one DRAFT).');

    // The claim below is opened *from* the booked comparison above via the
    // real domain flow (§5.2's own auto-claim rule), not inserted directly —
    // dogfooding the exact mechanism `RecordBookingUseCase` uses in
    // production, so the seed doubles as a smoke test of that path.
    const bookingRepository = new DrizzleBookingRepository();
    const claimRepository = new DrizzleClaimRepository();

    const bookedAt = new Date();
    const booking = Booking.record({
      id: randomUUID(),
      userId: demoUserId,
      comparisonId: savedComparison.id,
      channel: 'EDIT',
      confirmationNumber: 'DEMO-CONF-001',
      bookedAt,
      checkIn: '2026-11-10',
      checkOut: '2026-11-13',
      totalCents: cents(354_000),
      baseCents: cents(314_947),
      cashChargedCents: cents(354_000),
      pointsUsed: null,
      prepaid: true,
      refundable: true,
      cancelDeadline: '2026-11-08',
      bucketId: null,
    });
    const bookingRecord = await bookingRepository.create({
      id: booking.id,
      userId: booking.userId,
      comparisonId: booking.comparisonId,
      channel: booking.channel,
      confirmationNumber: booking.confirmationNumber,
      bookedAt: booking.bookedAt,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      totalCents: booking.totalCents,
      baseCents: booking.baseCents,
      cashChargedCents: booking.cashChargedCents,
      pointsUsed: booking.pointsUsed,
      refundable: booking.refundable,
      cancelDeadline: booking.cancelDeadline,
      bucketId: booking.bucketId,
      status: booking.status,
    });

    const events = booking.pullDomainEvents();
    for (const event of events) {
      if (event.type !== 'booking.recorded' || event.payload.opensClaim !== true) continue;
      const claim = Claim.openForBooking({
        id: randomUUID(),
        userId: demoUserId,
        bookingId: bookingRecord.id,
        kind: event.payload.claimKind as ClaimKind,
        bookedAt,
      });
      await claimRepository.create({
        id: claim.id,
        userId: claim.userId,
        bookingId: claim.bookingId,
        competingRateId: claim.competingRateId,
        kind: claim.kind,
        deadlineAt: claim.deadlineAt,
        status: claim.status,
        claimedGapCents: claim.claimedGapCents,
      });
      console.log(`[seed] demo claim opened: ${claim.id}, deadline ${claim.deadlineAt.toISOString()}.`);
    }
  }
}

async function main(): Promise<void> {
  await seedDemoUser();
  const demoUserId = await resolveDemoUserId();

  await seedProperties();
  await seedCreditBuckets(demoUserId);
  await seedDemoComparisonsAndClaim(demoUserId);

  console.log('[seed] done.');
  console.log(`[seed] set PARITY_DEMO_USER=${demoUserId} in .env to sign in as the demo account locally.`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('[seed] failed:', error);
    process.exit(1);
  });
