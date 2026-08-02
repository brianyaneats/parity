import { describe, it, expect } from 'vitest';
import { WatchlistReshopUseCase } from './WatchlistReshopUseCase';
import { InMemoryWatchlistRepository, FakeNotifier } from '../../testing/fakes';
import { MemoryLogger } from '@/infrastructure/observability/Logger';
import { MetricsRegistry } from '@/infrastructure/observability/MetricsRegistry';
import { FixedClock } from '@/domain/shared/Clock';
import type { ExecutionContext, UseCaseDependencies } from '../../shared/UseCase';

/**
 * Same addition as `BucketExpirySweepUseCase.test.ts`: this job shares
 * `createNotifier.ts`'s one `Notifier` singleton, so it now attributes its
 * message's `userId` for `DurableIdempotentNotifier`. No prior test file
 * existed for this use case to extend.
 */

function deps(): UseCaseDependencies {
  return {
    logger: new MemoryLogger(),
    metrics: new MetricsRegistry({ now: () => 0 }),
    clock: new FixedClock('2026-07-27T12:00:00Z'),
  };
}

function ctxAt(iso: string): ExecutionContext {
  return { userId: 'cron', requestId: 'req-1', now: new Date(iso) };
}

describe('WatchlistReshopUseCase — durable dedup attribution', () => {
  it('attaches the watchlist entry owner as userId on the notification it sends', async () => {
    const watchlist = new InMemoryWatchlistRepository();
    const entry = await watchlist.create({
      userId: 'user-1',
      bookingId: 'booking-1',
      nextCheckAt: new Date('2026-07-27T00:00:00Z'),
    });
    watchlist.sweepDetails.set(entry.id, {
      propertyNameSnapshot: 'Four Seasons Otemachi',
      comparisonId: null,
      checkIn: '2026-08-01',
      checkOut: '2026-08-05',
      cancelDeadline: '2026-08-10', // comfortably >= 2 days out
      userEmail: 'user@example.com',
      userTimezone: 'America/New_York',
    });

    const spy = new FakeNotifier();
    // 09:00 America/New_York, outside quiet hours.
    const result = await new WatchlistReshopUseCase(deps(), watchlist, spy).execute(
      { dryRun: false },
      ctxAt('2026-07-27T13:00:00Z'),
    );

    expect(result.notified).toBe(1);
    expect(spy.sent).toHaveLength(1);
    expect(spy.sent[0]?.userId).toBe('user-1');
  });
});
