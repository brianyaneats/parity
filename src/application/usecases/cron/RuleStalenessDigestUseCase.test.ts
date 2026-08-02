import { describe, it, expect } from 'vitest';
import { RuleStalenessDigestUseCase } from './RuleStalenessDigestUseCase';
import { InMemoryUserSettingsRepository, FakeNotifier } from '../../testing/fakes';
import { MemoryLogger } from '@/infrastructure/observability/Logger';
import { MetricsRegistry } from '@/infrastructure/observability/MetricsRegistry';
import { FixedClock } from '@/domain/shared/Clock';
import type { ExecutionContext, UseCaseDependencies } from '../../shared/UseCase';

/**
 * Same addition as the other two cron jobs' new test files: this job shares
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

describe('RuleStalenessDigestUseCase — durable dedup attribution', () => {
  it('attaches the recipient as userId on the digest it sends', async () => {
    const settings = new InMemoryUserSettingsRepository();
    settings.recipients = [{ userId: 'user-1', email: 'user@example.com', timezone: 'America/New_York' }];

    const spy = new FakeNotifier();
    // Every rule's `verifiedOn` in this build is 2026-07-27 (§2.8); more than
    // 180 days later, all of them are stale, so the digest has something to
    // send. 08:00 America/New_York in February (EST, no DST) — outside
    // quiet hours.
    const result = await new RuleStalenessDigestUseCase(deps(), settings, spy).execute(
      { dryRun: false },
      ctxAt('2027-02-01T13:00:00Z'),
    );

    expect(result.notified).toBe(1);
    expect(spy.sent).toHaveLength(1);
    expect(spy.sent[0]?.userId).toBe('user-1');
  });
});
