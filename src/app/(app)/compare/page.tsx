import { cookies } from 'next/headers';
import { CompareScreen, type CardVisibility, type PropertyOption } from '@/features/compare/CompareScreen';
import { ONBOARDING_DISMISSED_COOKIE } from '@/features/compare/onboardingCookie';
import { PROPERTY_SEEDS } from '@/infrastructure/persistence/seed/properties.seed';
import type { BrandOrNone } from '@/domain/rules/channels.rules';
import { getSession, type Session } from '@/lib/auth/session';
import { toIsoDate } from '@/domain/credit/CreditWindow';
import {
  deriveBucketAvailability,
  type BucketAvailabilitySnapshot,
} from '@/domain/credit/CreditBucketResolution';
import {
  AMEX_HOTEL_CREDIT_FACE_CENTS,
  CSR_EDIT_CREDIT_FACE_CENTS,
} from '@/domain/rules/credit.rules';

export const metadata = { title: 'Compare · Parity' };

/**
 * `/compare` — the primary screen (§7.3).
 *
 * Properties are loaded server-side so the combobox is populated on first
 * paint. §13.3 names input friction as the existential risk, and a search box
 * that is empty for 400 ms is friction the user feels on every single use.
 *
 * Falls back to the seed list when the database is unreachable, because a
 * comparator that cannot be used without a database is a comparator that fails
 * exactly when the user is standing in a hotel lobby on hotel wifi.
 *
 * §5.3 / Defect A: the caller's live credit-bucket snapshot is hydrated here
 * too, for the same reason — see `loadBucketAvailability`'s own doc comment.
 *
 * Onboarding addition: also determines whether to show the first-run welcome
 * banner (`loadShowOnboarding`) and which of the two statement-credit toggles
 * the caller should even see (`loadCardVisibility` — honest cards gating,
 * see that function's own comment). `getSession()` is read once, here, and
 * threaded into every loader below instead of each one calling it again —
 * cheap either way (a signed cookie decode, no I/O), but one call keeps the
 * four loaders reading the same caller identity by construction.
 */
export default async function ComparePage() {
  const session = await getSession();

  const [properties, bucketHydration, cardVisibility, showOnboarding] = await Promise.all([
    loadProperties(),
    loadBucketAvailability(session),
    loadCardVisibility(session),
    loadShowOnboarding(session),
  ]);

  return (
    <CompareScreen
      properties={properties}
      initialBucketAvailability={bucketHydration.snapshot}
      bucketAvailabilityKnown={bucketHydration.known}
      currentYear={new Date().getUTCFullYear()}
      cardVisibility={cardVisibility}
      showOnboarding={showOnboarding}
    />
  );
}

async function loadProperties(): Promise<readonly PropertyOption[]> {
  try {
    const { listProperties } = await import('@/infrastructure/persistence/queries/properties');
    const rows = await listProperties();
    if (rows.length > 0) return rows;
  } catch {
    // Fall through to the seeds.
  }

  return PROPERTY_SEEDS.map((seed, index) => ({
    id: `seed-${index}`,
    name: seed.name,
    city: seed.city,
    brand: seed.brand as BrandOrNone,
    inFhr: seed.inFhr,
    inThc: seed.inThc,
    inEdit: seed.inEdit,
    propertyCreditFaceCents: seed.propertyCreditFaceCents,
    propertyCreditKind: seed.propertyCreditKind,
  }));
}

/**
 * §5.3 / Defect A — hydrates the caller's live bucket snapshot server-side so
 * `useComparison`'s very first optimistic pass computes from the same inputs
 * `POST /api/compare` (`CompareChannelsUseCase`) will use, instead of a
 * pessimistic `false`/`false` guess that visibly shifted ~300ms after each
 * debounce settled. `CompareScreen` seeds its toggle state directly from the
 * returned snapshot, so optimistic and authoritative agree from the first
 * paint — `useComparison`'s own server reconciliation stays wired as a safety
 * net for the (now rare) case where the two genuinely diverge.
 *
 * Resilient, matching this file's own `loadProperties` and the `/ledger` and
 * `/credits` server pages' pattern: a dynamic import inside `try/catch` so an
 * unreachable database degrades the *page* rather than crashing it. The
 * degrade direction is deliberately the opposite of the usual "assume the
 * worst" instinct, though. §0.3 item 3 says a decision touching money math
 * must take the conservative option — but "conservative" here is not "assume
 * the credit is spent": that would silently cost the user a real, unspent
 * credit by hiding it from the comparison, which is the failure mode §7.5
 * calls "the number that costs real money if ignored." The conservative read
 * is instead "assume it's available, exactly like `POST /api/compare` already
 * falls back to whatever the client sent when the client can't say either,
 * and say out loud that this is a guess" — never a silent one. `known: false`
 * is what lets `CompareScreen` render the visible "could not check your
 * credits" note instead of presenting the assumption as fact.
 */
async function loadBucketAvailability(session: Session | null): Promise<{
  snapshot: BucketAvailabilitySnapshot;
  known: boolean;
}> {
  try {
    if (!session) return { snapshot: ASSUME_AVAILABLE, known: false };

    const { listLiveCreditBuckets } = await import(
      '@/infrastructure/persistence/queries/buckets'
    );
    const liveBuckets = await listLiveCreditBuckets(session.userId);
    const snapshot = deriveBucketAvailability(liveBuckets, toIsoDate(new Date()));
    return { snapshot, known: true };
  } catch {
    return { snapshot: ASSUME_AVAILABLE, known: false };
  }
}

const ASSUME_AVAILABLE: BucketAvailabilitySnapshot = {
  amexBucketAvailable: true,
  amexRemainingCents: AMEX_HOTEL_CREDIT_FACE_CENTS,
  editBucketAvailable: true,
  editRemainingCents: CSR_EDIT_CREDIT_FACE_CENTS,
};

/** Both toggles show — today's founding assumption, and the honest fallback
 * for a caller who hasn't configured any card, or whom this couldn't check. */
const BOTH_CARDS_VISIBLE: CardVisibility = { amex: true, edit: true };

/**
 * Honest cards gating (Feature B, item 3). `/settings`' `CardsSection` lets a
 * caller declare which cards they actually hold; until now nothing on
 * `/compare` read it, so the Amex and Chase statement-credit toggles showed
 * for every caller regardless — including one who has explicitly said they
 * only carry a Chase Sapphire Reserve, no Amex Platinum.
 *
 * Fails open to `BOTH_CARDS_VISIBLE` on every uncertain case — no session, no
 * configured cards, or a database miss. That is the opposite direction from
 * §5.3/Defect A's money-math conservatism deliberately: showing one extra
 * toggle the caller doesn't need is a minor annoyance, not the "confidently
 * wrong dollar figure" §7.5 warns about, so there is no honest reason to hide
 * a toggle this function isn't actually sure the caller lacks.
 *
 * `CompareScreen` gates on the result server-side by not rendering the hidden
 * toggle at all and by never letting its underlying boolean reach the engine
 * — see that component's own comment on `cardVisibility`.
 */
async function loadCardVisibility(session: Session | null): Promise<CardVisibility> {
  try {
    if (!session) return BOTH_CARDS_VISIBLE;

    const { listActiveCards } = await import('@/infrastructure/persistence/queries/cards');
    const activeKinds = await listActiveCards(session.userId);
    if (activeKinds.length === 0) return BOTH_CARDS_VISIBLE;

    return {
      amex: activeKinds.includes('AMEX_PLATINUM'),
      edit: activeKinds.includes('CSR'),
    };
  } catch {
    return BOTH_CARDS_VISIBLE;
  }
}

/**
 * §7.3 onboarding: whether to render `OnboardingBanner` above the compare
 * form. True only for a signed-in caller with zero saved comparisons who has
 * not already dismissed it (`ONBOARDING_DISMISSED_COOKIE`). An anonymous
 * caller never sees it — there is nothing for "load a sample comparison" to
 * save it against — and a database hiccup degrades to "no banner" rather
 * than breaking the comparator itself, the same resilience direction as
 * every other read on this page.
 */
async function loadShowOnboarding(session: Session | null): Promise<boolean> {
  if (!session) return false;

  try {
    const store = await cookies();
    if (store.get(ONBOARDING_DISMISSED_COOKIE)) return false;

    const { hasAnyComparisons } = await import('@/infrastructure/persistence/queries/comparisons');
    return !(await hasAnyComparisons(session.userId));
  } catch {
    return false;
  }
}
