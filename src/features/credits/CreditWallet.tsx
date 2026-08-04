'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, StatTile, Button, EmptyState } from '@/components/ui';
import { BucketMeter } from '@/components/credits/BucketMeter';
import { CreditBucket, totalUnburnedCents, nearestExpiry } from '@/domain/credit/CreditBucket';
import { CREDIT_BUCKET_DEFINITIONS, type CreditBucketDefinition } from '@/domain/rules/credit.rules';
import type { CardKind } from '@/domain/rules/price-match.rules';
import { cents } from '@/domain/shared/cents';
import { formatCents, formatDays, formatNights } from '@/lib/format';
import { CreditPostingTracker } from './CreditPostingTracker';
import type { BucketRow, PostingListItem, RoutableComparison } from './types';

/**
 * `/credits` — the credit wallet (§7.5).
 *
 * "The screen's headline figure is total unburned credit and the nearest
 * expiry — the number that costs real money if ignored." Both figures reuse
 * `totalUnburnedCents`/`nearestExpiry` from the `CreditBucket` aggregate
 * rather than being summed here, so the wallet and any future screen that
 * needs the same total can never disagree.
 */

export interface CreditWalletProps {
  readonly buckets: readonly BucketRow[];
  readonly comparisons: readonly RoutableComparison[];
  /** "Did it actually post?" rows — §ownership: `CreditPostingTracker`. */
  readonly postings: readonly PostingListItem[];
  readonly todayIsoDate: string;
  /** False when `buckets` was computed from rule definitions rather than read
   * from the database — see `features/credits/fallback.ts`. The headline
   * math is correct either way; this only controls the disclosure note. */
  readonly isLive: boolean;
  /**
   * Honest cards gating — the `kind`s of cards the caller has told
   * `/settings` they actually hold (`listActiveCards`). Empty means "nothing
   * configured", which keeps today's founding assumption of showing both
   * cards' sections — the same behaviour the seeded demo account has always
   * shown. Once non-empty, only the section(s) for cards actually in this
   * list render; see `CARD_ORDER`'s use below.
   */
  readonly activeCardKinds: readonly CardKind[];
}

const CARD_LABEL: Record<CreditBucketDefinition['card'], string> = {
  AMEX_PLATINUM: 'Amex Platinum',
  CSR: 'Chase Sapphire Reserve',
};

const CARD_ORDER: readonly CreditBucketDefinition['card'][] = ['AMEX_PLATINUM', 'CSR'];

export function CreditWallet({
  buckets: rows,
  comparisons,
  postings,
  todayIsoDate,
  isLive,
  activeCardKinds,
}: CreditWalletProps) {
  const router = useRouter();

  // Honest cards gating (Feature B, item 2): both cards when nothing is
  // configured, otherwise only the ones the caller actually holds. Computed
  // from `CARD_ORDER` (not `activeCardKinds` directly) so the result stays in
  // §7.5's declared Amex-then-CSR order regardless of which order the caller
  // added their cards in, and so a configured card kind this screen has no
  // section for (there are only two) simply contributes nothing rather than
  // producing an unrenderable entry.
  const configuredCards = new Set(activeCardKinds);
  const visibleCards: readonly CreditBucketDefinition['card'][] =
    configuredCards.size > 0 ? CARD_ORDER.filter((card) => configuredCards.has(card)) : CARD_ORDER;
  const hidesACard = configuredCards.size > 0 && visibleCards.length < CARD_ORDER.length;

  // Reconstructed exactly once, here, at the server/client boundary — see
  // types.ts's `BucketRow` doc comment for why a class instance cannot be the
  // prop type. Everything below reuses the aggregate's own logic rather than
  // re-deriving remaining balances or status bands.
  const buckets = useMemo(
    () =>
      rows.map((row) =>
        CreditBucket.create({
          id: row.id,
          userId: row.userId,
          cardId: row.cardId,
          key: row.key,
          label: row.label,
          faceCents: cents(row.faceCents),
          window: { start: row.windowStart, end: row.windowEnd },
          consumedCents: cents(row.consumedCents),
          windowAssumed: row.windowAssumed,
        }),
      ),
    [rows],
  );

  const unburned = totalUnburnedCents(buckets, todayIsoDate);
  const nearest = nearestExpiry(buckets, todayIsoDate);

  // Only offered when the wallet is reading real rows — a fallback bucket's
  // id (`fallback-KEY`, see `computeFallbackBuckets`) isn't a `credit_buckets`
  // row `recordPosting`'s ownership check could ever find.
  const bucketOptions = useMemo(
    () => (isLive ? buckets.map((bucket) => ({ id: bucket.id, label: bucket.label })) : []),
    [buckets, isLive],
  );

  const byCard = useMemo(() => {
    const groups = new Map<CreditBucketDefinition['card'], CreditBucket[]>();
    for (const definition of CREDIT_BUCKET_DEFINITIONS) {
      const bucket = buckets.find((b) => b.key === definition.key);
      if (!bucket) continue;
      const list = groups.get(definition.card) ?? [];
      list.push(bucket);
      groups.set(definition.card, list);
    }
    return groups;
  }, [buckets]);

  if (buckets.length === 0) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 lg:p-6">
        <h1 className="text-h1 text-text-primary">Credits</h1>
        <EmptyState message="No credit buckets are configured yet." />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <div>
        <h1 className="text-h1 text-text-primary">Credits</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Six statement credits across two cards — the money that disappears if a window closes
          before you spend it.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile
          hero
          label="Total unburned credit"
          value={formatCents(unburned)}
          sublabel="Across every bucket whose window is still open"
        />
        <StatTile
          label="Nearest expiry"
          value={nearest ? formatDays(nearest.daysRemaining(todayIsoDate)) : 'Nothing left to burn'}
          sublabel={
            nearest
              ? `${nearest.label} · ${formatCents(nearest.remainingCents)} at stake`
              : 'Every open bucket is fully spent'
          }
        />
      </div>

      {!isLive ? (
        <p className="text-xs text-text-muted">
          Showing this window&rsquo;s six buckets at zero consumption — nothing has been recorded
          in the database yet. The dates and day counts are real; balances will update once
          bookings are tracked.
        </p>
      ) : null}

      {/* §7.5: "give it real estate, not a footnote." */}
      <Card className="border-border-strong bg-surface-2">
        <h2 className="text-h3 text-text-primary">
          The date that counts is when you book, not when you stay
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          A statement credit keys off the day you book, not the day you check in. Prepay a Hotel
          Collection or Edit stay for a trip next summer before this half closes and it still
          burns this window&rsquo;s $250&ndash;$300 credit in full &mdash; wait a few weeks and book
          the identical stay after the window rolls over, and the same charge lands in the fresh
          one instead. There is no way to move a booking between windows after the fact, so timing
          the booking date is the entire trick.
        </p>
      </Card>

      {hidesACard ? (
        <p className="text-xs text-text-muted">
          Cards you don&rsquo;t hold are hidden — manage in{' '}
          <Link href="/settings" className="underline">
            Settings
          </Link>
          .
        </p>
      ) : null}

      <CreditPostingTracker postings={postings} bucketOptions={bucketOptions} />

      {visibleCards.map((card) => {
        const list = byCard.get(card);
        if (!list || list.length === 0) return null;
        return (
          <section key={card} className="flex flex-col gap-3">
            <h2 className="text-h2 text-text-primary">{CARD_LABEL[card]}</h2>
            {list.map((bucket) => (
              <div key={bucket.id} className="flex flex-col gap-2">
                <BucketMeter bucket={bucket} todayIsoDate={todayIsoDate} />
                <RouteAction
                  bucket={bucket}
                  comparisons={comparisons}
                  onRoute={(id) => router.push(`/compare/${id}`)}
                />
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/**
 * §7.5: "Below each, a 'route a booking to this bucket' action that filters
 * saved comparisons to ones whose channel and night count qualify."
 */
function RouteAction({
  bucket,
  comparisons,
  onRoute,
}: {
  readonly bucket: CreditBucket;
  readonly comparisons: readonly RoutableComparison[];
  readonly onRoute: (comparisonId: string) => void;
}) {
  const definition = CREDIT_BUCKET_DEFINITIONS.find((d) => d.key === bucket.key);
  if (!definition) return null;

  const eligible = comparisons.filter(
    (c) =>
      definition.unlockChannels.includes(c.channel) &&
      c.nights >= definition.minNights &&
      (!definition.requiresPrepaid || c.prepaid),
  );

  return (
    <div className="rounded-md border border-border bg-surface-1 p-3">
      <p className="text-label uppercase text-text-muted">Route a booking here</p>
      {eligible.length === 0 ? (
        <p className="mt-1 text-sm text-text-secondary">
          No saved comparison currently qualifies. {definition.unlockDescription}
        </p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1.5">
          {eligible.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-text-primary">
                {c.propertyName} · {formatNights(c.nights)}
              </span>
              <Button variant="secondary" size="sm" onClick={() => onRoute(c.id)}>
                Route here
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
