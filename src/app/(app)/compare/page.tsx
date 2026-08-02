import { CompareScreen, type PropertyOption } from '@/features/compare/CompareScreen';
import { PROPERTY_SEEDS } from '@/infrastructure/persistence/seed/properties.seed';
import type { BrandOrNone } from '@/domain/rules/channels.rules';
import { getSession } from '@/lib/auth/session';
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
 */
export default async function ComparePage() {
  const [properties, bucketHydration] = await Promise.all([
    loadProperties(),
    loadBucketAvailability(),
  ]);

  return (
    <CompareScreen
      properties={properties}
      initialBucketAvailability={bucketHydration.snapshot}
      bucketAvailabilityKnown={bucketHydration.known}
      currentYear={new Date().getUTCFullYear()}
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
async function loadBucketAvailability(): Promise<{
  snapshot: BucketAvailabilitySnapshot;
  known: boolean;
}> {
  try {
    const session = await getSession();
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
