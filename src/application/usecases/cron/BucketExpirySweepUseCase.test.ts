import { describe, it, expect } from 'vitest';
import { BucketExpirySweepUseCase } from './BucketExpirySweepUseCase';
import { InMemoryCreditBucketRepository, FakeNotifier } from '../../testing/fakes';
import { MemoryLogger } from '@/infrastructure/observability/Logger';
import { MetricsRegistry } from '@/infrastructure/observability/MetricsRegistry';
import { FixedClock } from '@/domain/shared/Clock';
import { cents } from '@/domain/shared/cents';
import type { ExecutionContext, UseCaseDependencies } from '../../shared/UseCase';

/**
 * This job shares `createNotifier.ts`'s one `Notifier` singleton with
 * `claim-deadline-sweep`, so it needed the same fix: every message now
 * carries `userId` so `DurableIdempotentNotifier` can durably attribute a
 * `notifications_sent` row to this bucket's owner (see that class's module
 * doc). This file only covers that addition — there was no prior test
 * coverage for this use case to extend.
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

describe('BucketExpirySweepUseCase — durable dedup attribution', () => {
  it('attaches the bucket owner as userId on every notification it sends', async () => {
    const buckets = new InMemoryCreditBucketRepository();
    buckets.rows.push({
      id: 'bucket-1',
      userId: 'user-1',
      cardId: null,
      key: 'AMEX_HOTEL_H2',
      label: 'Amex Hotel Credit',
      faceCents: cents(30_000),
      window: { start: '2026-07-01', end: '2026-07-30' },
      consumedCents: cents(0),
    });
    buckets.sweepMeta.set('bucket-1', { userEmail: 'user@example.com', userTimezone: 'America/New_York' });

    const spy = new FakeNotifier();
    // 09:00 America/New_York, outside quiet hours; 3 days from window end
    // crosses all four checkpoints (60/30/14/3) at once.
    const result = await new BucketExpirySweepUseCase(deps(), buckets, spy).execute(
      { dryRun: false },
      ctxAt('2026-07-27T13:00:00Z'),
    );

    expect(result.notified).toBeGreaterThan(0);
    expect(spy.sent.length).toBeGreaterThan(0);
    expect(spy.sent.every((message) => message.userId === 'user-1')).toBe(true);
  });
});
