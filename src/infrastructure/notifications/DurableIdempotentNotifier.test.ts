import { describe, it, expect } from 'vitest';
import { DurableIdempotentNotifier, deriveNotificationKind } from './DurableIdempotentNotifier';
import { IdempotentNotifier } from './IdempotentNotifier';
import { PreviewNotifier } from './PreviewNotifier';
import { FakeNotifier, InMemoryNotificationsSentRepository } from '@/application/testing/fakes';
import { MemoryLogger } from '@/infrastructure/observability/Logger';
import type { NotificationsSentRepository } from '@/application/ports/NotificationsSentRepository';

/**
 * `DurableIdempotentNotifier` — the layer that closes the cold-start gap
 * `IdempotentNotifier`'s in-process `Map` cannot (see that class's module
 * doc). These tests exercise it directly, isolated from any particular §9
 * cron job; `ClaimDeadlineSweepUseCase.test.ts` covers the same mechanism in
 * its real, deployed shape (wrapped by `IdempotentNotifier`, driving the
 * quiet-hours and three-checkpoint-cap behaviour end to end).
 */

const message = (overrides: { idempotencyKey: string; userId?: string }) => ({
  to: 'user@example.com',
  subject: 'Test',
  text: 'Test body',
  idempotencyKey: overrides.idempotencyKey,
  userId: overrides.userId,
});

describe('DurableIdempotentNotifier', () => {
  it('sends once for a key, and durably dedupes a repeat of the same key', async () => {
    const repo = new InMemoryNotificationsSentRepository();
    const inner = new FakeNotifier();
    const notifier = new DurableIdempotentNotifier(repo, inner, new MemoryLogger());

    const first = await notifier.send(message({ idempotencyKey: 'k1', userId: 'user-1' }));
    const second = await notifier.send(message({ idempotencyKey: 'k1', userId: 'user-1' }));

    expect(first).toEqual({ sent: true, deduped: false });
    expect(second).toEqual({ sent: false, deduped: true });
    expect(inner.sent).toHaveLength(1);
    expect(repo.rows).toHaveLength(1);
  });

  it('survives a simulated cold start — two fresh instances sharing the durable repository still send exactly once', async () => {
    const sharedRepo = new InMemoryNotificationsSentRepository();

    // Each pair below has its own empty `IdempotentNotifier` map — a fresh
    // process, i.e. a cold start — but shares the one durable repository,
    // standing in for the real Postgres table surviving between them.
    const spy1 = new FakeNotifier();
    const notifier1 = new IdempotentNotifier(new DurableIdempotentNotifier(sharedRepo, spy1, new MemoryLogger()));
    const first = await notifier1.send(message({ idempotencyKey: 'claim-deadline:c1:1h', userId: 'user-1' }));

    const spy2 = new FakeNotifier();
    const notifier2 = new IdempotentNotifier(new DurableIdempotentNotifier(sharedRepo, spy2, new MemoryLogger()));
    const second = await notifier2.send(message({ idempotencyKey: 'claim-deadline:c1:1h', userId: 'user-1' }));

    expect(first).toEqual({ sent: true, deduped: false });
    expect(spy1.sent).toHaveLength(1);
    expect(second).toEqual({ sent: false, deduped: true });
    expect(spy2.sent).toHaveLength(0);
  });

  it('a concurrent insert race on the same key still sends exactly once — the unique index arbitrates, not a read-then-write check', async () => {
    const sharedRepo = new InMemoryNotificationsSentRepository();
    const spyA = new FakeNotifier();
    const spyB = new FakeNotifier();
    const notifierA = new DurableIdempotentNotifier(sharedRepo, spyA, new MemoryLogger());
    const notifierB = new DurableIdempotentNotifier(sharedRepo, spyB, new MemoryLogger());

    const [resultA, resultB] = await Promise.all([
      notifierA.send(message({ idempotencyKey: 'k-race', userId: 'user-1' })),
      notifierB.send(message({ idempotencyKey: 'k-race', userId: 'user-1' })),
    ]);

    const results = [resultA, resultB];
    expect(results.filter((r) => r.sent).length).toBe(1);
    expect(results.filter((r) => r.deduped).length).toBe(1);
    expect(spyA.sent.length + spyB.sent.length).toBe(1);
    expect(sharedRepo.rows).toHaveLength(1);
  });

  it('fails toward not sending when the durable check itself throws, and logs it', async () => {
    const throwingRepo: NotificationsSentRepository = {
      tryClaim: async () => {
        throw new Error('connection refused');
      },
    };
    const inner = new FakeNotifier();
    const logger = new MemoryLogger();
    const notifier = new DurableIdempotentNotifier(throwingRepo, inner, logger);

    const result = await notifier.send(message({ idempotencyKey: 'k1', userId: 'user-1' }));

    expect(result).toEqual({ sent: false, deduped: false });
    expect(inner.sent).toHaveLength(0);
    expect(logger.records.some((r) => r.level === 'error')).toBe(true);
  });

  it('a message with no userId is outside this layer entirely — delegated straight through, no repository call', async () => {
    const repo = new InMemoryNotificationsSentRepository();
    const inner = new FakeNotifier();
    const notifier = new DurableIdempotentNotifier(repo, inner, new MemoryLogger());

    const first = await notifier.send(message({ idempotencyKey: 'magic-link:user@example.com:tok1' }));
    const second = await notifier.send(message({ idempotencyKey: 'magic-link:user@example.com:tok1' }));

    // No userId to attribute a durable row to, so nothing is claimed — every
    // call reaches the inner notifier, exactly as before this class existed.
    expect(first.sent).toBe(true);
    expect(second.sent).toBe(true);
    expect(inner.sent).toHaveLength(2);
    expect(repo.rows).toHaveLength(0);
  });

  it('a dry run (PreviewNotifier) never reaches this layer, so it writes no durable row', async () => {
    const repo = new InMemoryNotificationsSentRepository();
    const dryRun = new PreviewNotifier(new MemoryLogger());

    await dryRun.send(message({ idempotencyKey: 'claim-deadline:c1:1h', userId: 'user-1' }));

    expect(repo.rows).toHaveLength(0);
  });

  describe('deriveNotificationKind', () => {
    it.each([
      ['claim-deadline:c1:1h', 'claim-deadline'],
      ['bucket-expiry:b1:30d:2026-12-31', 'bucket-expiry'],
      ['watchlist-reshop:w1:2026-07-27', 'watchlist-reshop'],
      ['rule-staleness:u1:2026-W30', 'rule-staleness'],
      ['no-separator', 'no-separator'],
    ])('derives %s -> %s', (key, expected) => {
      expect(deriveNotificationKind(key)).toBe(expected);
    });
  });

  it('claims a row carrying the derived kind, the sent instant, and EMAIL as the channel', async () => {
    const repo = new InMemoryNotificationsSentRepository();
    const inner = new FakeNotifier();
    const fixedNow = new Date('2026-07-27T13:30:00Z');
    const notifier = new DurableIdempotentNotifier(repo, inner, new MemoryLogger(), () => fixedNow);

    await notifier.send(message({ idempotencyKey: 'claim-deadline:c1:1h', userId: 'user-1' }));

    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({
      userId: 'user-1',
      idempotencyKey: 'claim-deadline:c1:1h',
      kind: 'claim-deadline',
      channel: 'EMAIL',
      sentAt: fixedNow,
    });
  });
});
