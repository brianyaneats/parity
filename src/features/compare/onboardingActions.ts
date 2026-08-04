'use server';

import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth/session';
import { SavingsEngine } from '@/domain/engine/SavingsEngine';
import { toIsoDate } from '@/domain/credit/CreditWindow';
import {
  DEFAULT_BREAKFAST_PER_DAY_CENTS,
  DEFAULT_PROPERTY_CREDIT_FACE_CENTS,
  DEFAULT_REALIZATION_PCT,
} from '@/domain/rules/perks.rules';
import { DEFAULT_MR_VALUE_MICRO, DEFAULT_UR_VALUE_MICRO } from '@/domain/rules/points.rules';
import { DEFAULT_FORA_RATE_BPS } from '@/domain/rules/fora.rules';
import type { StayContext, ChannelQuote } from '@/domain/engine/types';
import { cents } from '@/domain/shared/cents';
import { ONBOARDING_DISMISSED_COOKIE } from './onboardingCookie';

/**
 * Server actions backing the `/compare` first-run banner (`OnboardingBanner`).
 * Lives in `src/features/compare/**`, same reasoning `properties/actions.ts`
 * gives for its own placement: a Server Action needs no `src/app/api/**`
 * route file, and this is the one path this task owns for a write.
 *
 * Every action returns a value instead of throwing, matching every other
 * feature's actions module (`properties/actions.ts`, `settings/actions.ts`)
 * — a thrown server-action error surfaces as an opaque framework overlay
 * rather than the inline message `OnboardingBanner` is built to show.
 */

export type CreateSampleResult =
  | { readonly ok: true; readonly comparisonId: string }
  | { readonly ok: false; readonly message: string };

/**
 * The name of a real, seeded (`user_id IS NULL`) property — see
 * `PROPERTY_SEEDS` in `src/infrastructure/persistence/seed/properties.seed.ts`
 * — chosen because it is §4.4's own first Tokyo entry and carries real FHR
 * and Edit membership, so a sample comparison that links to it behaves like a
 * real one rather than a placeholder with no programme intelligence behind
 * it. The comparison's own `propertyNameSnapshot` is deliberately a
 * *different*, obviously-sample string (`SAMPLE_PROPERTY_NAME_SNAPSHOT`
 * below) — see that constant's own comment for why the two must not match.
 */
const SEED_PROPERTY_NAME = 'Four Seasons Hotel Tokyo at Otemachi';

/**
 * What the created row is named, deliberately distinct from
 * `SEED_PROPERTY_NAME` above and from every real property name in
 * `PROPERTY_SEEDS`: a "Sample ·" prefix so this row is never mistaken for a
 * comparison the user actually priced out — on `/trips`, `/watchlist`, or
 * anywhere else saved comparisons are listed by name, it must read as what it
 * is.
 */
const SAMPLE_PROPERTY_NAME_SNAPSHOT = 'Sample · Four Seasons Tokyo';

/** A representative two-channel comparison — enough to show the 60-second
 * loop's actual output (a ranked winner with a real effective-net gap)
 * without inventing numbers implausible for the property. */
function sampleContext(propertyCreditFaceCents: number): StayContext {
  return {
    nights: 3,
    taxRateBps: 1_240,
    breakfastPerDayCents: DEFAULT_BREAKFAST_PER_DAY_CENTS,
    propertyCreditFaceCents: cents(propertyCreditFaceCents),
    realizationPct: DEFAULT_REALIZATION_PCT,
    mrValueMicro: DEFAULT_MR_VALUE_MICRO,
    urValueMicro: DEFAULT_UR_VALUE_MICRO,
    foraRateBps: DEFAULT_FORA_RATE_BPS,
    amexBucketAvailable: true,
    editBucketAvailable: true,
    competitorBaseCents: null,
    competitorRefundable: true,
    competitorPublic: true,
    brand: 'NONE',
  };
}

const SAMPLE_QUOTES: readonly ChannelQuote[] = [
  { channel: 'EDIT', totalCents: cents(105_000), prepaid: true, refundable: true },
  { channel: 'FHR', totalCents: cents(108_000), prepaid: true, refundable: true },
];

/**
 * §7.3 / onboarding: "Load a sample comparison" — the banner's one action.
 * Creates exactly one new `DRAFT` comparison for the signed-in caller, shaped
 * like `run-seed.ts`'s own demo comparisons (same context fields, same
 * `SavingsEngine.compare` call, same `quotes` shape), then hands back the new
 * row's id so the client can navigate to `/compare/[id]` — the same
 * client-driven navigation `CreditWallet`'s "route a booking here" action
 * already uses, rather than a `redirect()` thrown from inside the action.
 *
 * Deliberately not idempotent — see the task's own framing: calling this
 * twice creates a second sample row rather than upserting one, the same way
 * pressing "Save comparison" twice on `/compare` itself would. What it must
 * never do is touch any row outside the caller's own `userId`, which is why
 * that id comes only from `getSession()` here and is never accepted as an
 * argument.
 */
export async function createSampleComparison(): Promise<CreateSampleResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: 'Sign in to load a sample comparison.' };

  try {
    const { db } = await import('@/infrastructure/persistence/db');
    const { properties } = await import('@/infrastructure/persistence/schema');
    const { and, eq, isNull, sql } = await import('drizzle-orm');
    const { DrizzleComparisonRepository } = await import(
      '@/infrastructure/persistence/repositories/DrizzleComparisonRepository'
    );

    const [seedProperty] = await db
      .select({ id: properties.id, propertyCreditFaceCents: properties.propertyCreditFaceCents })
      .from(properties)
      .where(and(isNull(properties.userId), sql`lower(${properties.name}) = lower(${SEED_PROPERTY_NAME})`))
      .limit(1);

    const context = sampleContext(
      seedProperty?.propertyCreditFaceCents ?? DEFAULT_PROPERTY_CREDIT_FACE_CENTS,
    );

    const engine = new SavingsEngine();
    const outcome = engine.compare({ context, quotes: SAMPLE_QUOTES });

    // 60 days out: far enough that the sample never reads as a stay already
    // in progress, close enough that it still looks like a real trip being
    // planned rather than an arbitrary placeholder date.
    const checkInDate = new Date();
    checkInDate.setUTCDate(checkInDate.getUTCDate() + 60);
    const checkOutDate = new Date(checkInDate);
    checkOutDate.setUTCDate(checkOutDate.getUTCDate() + context.nights);

    const repository = new DrizzleComparisonRepository();
    const created = await repository.create({
      userId: session.userId,
      propertyId: seedProperty?.id ?? null,
      propertyNameSnapshot: SAMPLE_PROPERTY_NAME_SNAPSHOT,
      checkIn: toIsoDate(checkInDate),
      checkOut: toIsoDate(checkOutDate),
      nights: context.nights,
      taxRateBps: context.taxRateBps,
      realizationPct: context.realizationPct,
      contextSnapshot: context,
      resultSnapshot: outcome.results,
      engineVersion: outcome.engineVersion,
      status: 'DRAFT',
      quotes: SAMPLE_QUOTES.map((quote, index) => ({
        channel: quote.channel,
        totalCents: quote.totalCents,
        prepaid: quote.prepaid,
        refundable: quote.refundable,
        sortIndex: index,
      })),
    });

    return { ok: true, comparisonId: created.id };
  } catch {
    return {
      ok: false,
      message: 'Could not reach the database. The sample comparison was not created — try again shortly.',
    };
  }
}

/**
 * The banner's "dismiss" action. A pure UI preference, not user content: no
 * session check, because dismissing "you have no saved comparisons yet" is
 * meaningful even for the fallback `PARITY_DEMO_USER` path and costs nothing
 * to honour without one. `httpOnly: false` is deliberate — see
 * `onboardingCookie.ts`'s own comment.
 */
export async function dismissOnboarding(): Promise<{ readonly ok: true }> {
  const store = await cookies();
  store.set(ONBOARDING_DISMISSED_COOKIE, '1', {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return { ok: true };
}
