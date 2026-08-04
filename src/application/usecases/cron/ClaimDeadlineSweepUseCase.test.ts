import { describe, it, expect } from 'vitest';
import { ClaimDeadlineSweepUseCase } from './ClaimDeadlineSweepUseCase';
import { InMemoryClaimRepository, FakeNotifier, InMemoryNotificationsSentRepository } from '../../testing/fakes';
import { IdempotentNotifier } from '@/infrastructure/notifications/IdempotentNotifier';
import { DurableIdempotentNotifier } from '@/infrastructure/notifications/DurableIdempotentNotifier';
import { PreviewNotifier } from '@/infrastructure/notifications/PreviewNotifier';
import { MemoryLogger } from '@/infrastructure/observability/Logger';
import { MetricsRegistry } from '@/infrastructure/observability/MetricsRegistry';
import { FixedClock } from '@/domain/shared/Clock';
import { cents } from '@/domain/shared/cents';
import type { ExecutionContext, UseCaseDependencies } from '../../shared/UseCase';

/**
 * Part 9's `claim-deadline-sweep`: idempotency ("a double-fire cannot
 * double-send"), the T+1h/T+6h/T+20h checkpoints, the three-notification cap,
 * quiet hours, and auto-expiry. All against in-memory fakes — no live
 * database, no real clock, no real network.
 *
 * A second block below layers in `DurableIdempotentNotifier`, backed by a
 * shared `InMemoryNotificationsSentRepository`, to prove the durability fix:
 * unlike a bare `IdempotentNotifier`, its dedup state is not lost when a
 * "fresh notifier instance" (a cold start) picks up the next tick.
 */

/** A helper to build the real, deployed-shape decorator chain over a shared durable repo. */
function durableNotifier(repo: InMemoryNotificationsSentRepository, inner: FakeNotifier = new FakeNotifier()) {
  return { notifier: new IdempotentNotifier(new DurableIdempotentNotifier(repo, inner, new MemoryLogger())), inner };
}

function deps(): UseCaseDependencies & { logger: MemoryLogger; metrics: MetricsRegistry } {
  return {
    logger: new MemoryLogger(),
    metrics: new MetricsRegistry({ now: () => 0 }),
    clock: new FixedClock('2026-07-27T12:00:00Z'),
  };
}

function ctxAt(iso: string): ExecutionContext {
  return { userId: 'cron', requestId: 'req-1', now: new Date(iso) };
}

function seedOpenClaim(
  claims: InMemoryClaimRepository,
  options: { bookedAt: Date; deadlineAt: Date; timezone?: string },
) {
  claims.rows.push({
    id: 'claim-1',
    userId: 'user-1',
    bookingId: 'booking-1',
    competingRateId: null,
    kind: 'CHASE_PM',
    deadlineAt: options.deadlineAt,
    status: 'ELIGIBLE',
    claimedGapCents: cents(10_000),
    awardedCents: null,
    submittedAt: null,
    resolvedAt: null,
    denialReason: null,
    denialCode: null,
    notes: null,
    createdAt: options.bookedAt,
  });
  claims.sweepMeta.set('claim-1', {
    bookedAt: options.bookedAt,
    userEmail: 'user@example.com',
    userTimezone: options.timezone ?? 'America/New_York',
  });
}

describe('ClaimDeadlineSweepUseCase — idempotency', () => {
  it('running the sweep twice for the same due checkpoint sends exactly one notification', async () => {
    const claims = new InMemoryClaimRepository();
    // Booked at noon UTC so "1.5h later" lands at 09:30 America/New_York —
    // outside the quiet-hours band, which is not what this test is about.
    const bookedAt = new Date('2026-07-27T12:00:00Z');
    seedOpenClaim(claims, { bookedAt, deadlineAt: new Date('2026-07-28T12:00:00Z') });

    const spy = new FakeNotifier();
    const notifier = new IdempotentNotifier(spy);
    const now = new Date('2026-07-27T13:30:00Z'); // 1.5h after booking — T+1h checkpoint is due

    const first = await new ClaimDeadlineSweepUseCase(deps(), claims, notifier).execute(
      { dryRun: false },
      { ...ctxAt(now.toISOString()) },
    );
    const second = await new ClaimDeadlineSweepUseCase(deps(), claims, notifier).execute(
      { dryRun: false },
      { ...ctxAt(now.toISOString()) },
    );

    expect(first.notified).toBe(1);
    expect(second.notified).toBe(0);
    expect(second.deduped).toBe(1);
    expect(spy.sent).toHaveLength(1);
  });

  it('never sends more than three notifications for one claim, even scanning every checkpoint at once', async () => {
    const claims = new InMemoryClaimRepository();
    const bookedAt = new Date('2026-07-27T00:00:00Z');
    // The claim itself is still open (deadline is 24h out); a huge elapsed
    // time simulates the sweep having missed several ticks in a row.
    seedOpenClaim(claims, { bookedAt, deadlineAt: new Date('2026-07-28T00:00:00Z') });

    const spy = new FakeNotifier();
    const notifier = new IdempotentNotifier(spy);
    const now = new Date('2026-07-27T21:00:00Z'); // 21h elapsed — all three checkpoints are due

    const result = await new ClaimDeadlineSweepUseCase(deps(), claims, notifier).execute(
      { dryRun: false },
      ctxAt(now.toISOString()),
    );

    expect(result.notified).toBe(3);
    expect(spy.sent).toHaveLength(3);
    expect(new Set(spy.sent.map((m) => m.idempotencyKey)).size).toBe(3);
  });

  it('honours quiet hours — a checkpoint due at 3 a.m. local is not sent', async () => {
    const claims = new InMemoryClaimRepository();
    const bookedAt = new Date('2026-07-27T00:00:00Z'); // 00:00 UTC = 20:00 the previous day in New York
    seedOpenClaim(claims, { bookedAt, deadlineAt: new Date('2026-07-28T00:00:00Z'), timezone: 'America/New_York' });

    const spy = new FakeNotifier();
    const notifier = new IdempotentNotifier(spy);
    // 07:30 UTC = 03:30 America/New_York — squarely inside the quiet-hours band.
    const now = new Date('2026-07-27T07:30:00Z');

    const result = await new ClaimDeadlineSweepUseCase(deps(), claims, notifier).execute(
      { dryRun: false },
      ctxAt(now.toISOString()),
    );

    expect(result.notified).toBe(0);
    expect(result.skippedQuietHours).toBeGreaterThan(0);
    expect(spy.sent).toHaveLength(0);
  });

  it('auto-expires a claim past its deadline, idempotently across two runs', async () => {
    const claims = new InMemoryClaimRepository();
    const bookedAt = new Date('2026-07-25T00:00:00Z');
    seedOpenClaim(claims, { bookedAt, deadlineAt: new Date('2026-07-26T00:00:00Z') });

    const notifier = new IdempotentNotifier(new FakeNotifier());
    const now = new Date('2026-07-27T00:00:00Z'); // well past the 24h deadline

    const first = await new ClaimDeadlineSweepUseCase(deps(), claims, notifier).execute(
      { dryRun: false },
      ctxAt(now.toISOString()),
    );
    expect(first.expired).toBe(1);
    expect((await claims.findById('claim-1', 'user-1'))?.status).toBe('EXPIRED');

    // The claim no longer appears in `listOpenForSweep` (it is terminal), so
    // a second run finds nothing left to expire — no double-transition.
    const second = await new ClaimDeadlineSweepUseCase(deps(), claims, notifier).execute(
      { dryRun: false },
      ctxAt(now.toISOString()),
    );
    expect(second.expired).toBe(0);
    expect(second.claimsScanned).toBe(0);
  });

  it('?dry=1 has zero side effects — no expiry, no send, no dedupe state consumed', async () => {
    const claims = new InMemoryClaimRepository();
    const bookedAt = new Date('2026-07-25T00:00:00Z');
    seedOpenClaim(claims, { bookedAt, deadlineAt: new Date('2026-07-26T00:00:00Z') });

    const spy = new FakeNotifier();
    const notifier = new IdempotentNotifier(spy);
    const now = new Date('2026-07-27T00:00:00Z');

    const dryResult = await new ClaimDeadlineSweepUseCase(deps(), claims, notifier).execute(
      { dryRun: true },
      ctxAt(now.toISOString()),
    );

    expect(dryResult.expired).toBe(1); // reported…
    expect((await claims.findById('claim-1', 'user-1'))?.status).toBe('ELIGIBLE'); // …but not persisted
    expect(spy.sent).toHaveLength(0);
  });
});

describe('ClaimDeadlineSweepUseCase — durable dedup across a simulated cold start', () => {
  it('the same checkpoint sends exactly once across two fresh notifier instances sharing one durable repository', async () => {
    const claims = new InMemoryClaimRepository();
    const bookedAt = new Date('2026-07-27T12:00:00Z');
    seedOpenClaim(claims, { bookedAt, deadlineAt: new Date('2026-07-28T12:00:00Z') });
    const now = new Date('2026-07-27T13:30:00Z'); // T+1h due, outside NY quiet hours

    const sharedRepo = new InMemoryNotificationsSentRepository();

    // Each `durableNotifier(...)` call below builds a brand new
    // `IdempotentNotifier` — an empty in-process map, i.e. a fresh cold
    // start — but they share `sharedRepo`, standing in for the one durable
    // Postgres table that actually persists between two invocations.
    const first = await new ClaimDeadlineSweepUseCase(
      deps(),
      claims,
      durableNotifier(sharedRepo).notifier,
    ).execute({ dryRun: false }, ctxAt(now.toISOString()));

    const second = await new ClaimDeadlineSweepUseCase(
      deps(),
      claims,
      durableNotifier(sharedRepo).notifier,
    ).execute({ dryRun: false }, ctxAt(now.toISOString()));

    expect(first.notified).toBe(1);
    expect(second.notified).toBe(0);
    expect(second.deduped).toBe(1);
    expect(sharedRepo.rows).toHaveLength(1);
    expect(sharedRepo.rows[0]).toMatchObject({ userId: 'user-1', idempotencyKey: 'claim-deadline:claim-1:1h' });
  });

  it('a concurrent insert race between two overlapping sweeps still sends exactly once', async () => {
    const claims = new InMemoryClaimRepository();
    const bookedAt = new Date('2026-07-27T12:00:00Z');
    seedOpenClaim(claims, { bookedAt, deadlineAt: new Date('2026-07-28T12:00:00Z') });
    const now = new Date('2026-07-27T13:30:00Z');

    const sharedRepo = new InMemoryNotificationsSentRepository();
    const a = durableNotifier(sharedRepo);
    const b = durableNotifier(sharedRepo);

    // Two overlapping invocations racing on the same claim/checkpoint — the
    // realistic shape of Vercel Cron firing (or retrying) the same tick.
    const [resultA, resultB] = await Promise.all([
      new ClaimDeadlineSweepUseCase(deps(), claims, a.notifier).execute({ dryRun: false }, ctxAt(now.toISOString())),
      new ClaimDeadlineSweepUseCase(deps(), claims, b.notifier).execute({ dryRun: false }, ctxAt(now.toISOString())),
    ]);

    expect(resultA.notified + resultB.notified).toBe(1);
    expect(resultA.deduped + resultB.deduped).toBe(1);
    expect(a.inner.sent.length + b.inner.sent.length).toBe(1);
  });

  it('the three-notification cap holds through the durable ledger, even across a cold start mid-claim', async () => {
    const claims = new InMemoryClaimRepository();
    const bookedAt = new Date('2026-07-27T00:00:00Z');
    // Deadline is 24h out; a huge elapsed time simulates several missed ticks.
    seedOpenClaim(claims, { bookedAt, deadlineAt: new Date('2026-07-28T00:00:00Z') });
    const now = new Date('2026-07-27T21:00:00Z'); // 21h elapsed — all three checkpoints due

    const sharedRepo = new InMemoryNotificationsSentRepository();

    const first = await new ClaimDeadlineSweepUseCase(
      deps(),
      claims,
      durableNotifier(sharedRepo).notifier,
    ).execute({ dryRun: false }, ctxAt(now.toISOString()));
    expect(first.notified).toBe(3);

    // A second, independent sweep (fresh notifier = fresh cold start) at the
    // same instant must not resend any of the three — the durable ledger,
    // not the (now-empty) in-memory map, is what stops it.
    const second = await new ClaimDeadlineSweepUseCase(
      deps(),
      claims,
      durableNotifier(sharedRepo).notifier,
    ).execute({ dryRun: false }, ctxAt(now.toISOString()));

    expect(second.notified).toBe(0);
    expect(second.deduped).toBe(3);
    expect(sharedRepo.rows).toHaveLength(3);
  });

  it('?dry=1 never writes a durable row — the next real run still sends', async () => {
    const claims = new InMemoryClaimRepository();
    const bookedAt = new Date('2026-07-27T12:00:00Z');
    seedOpenClaim(claims, { bookedAt, deadlineAt: new Date('2026-07-28T12:00:00Z') });
    const now = new Date('2026-07-27T13:30:00Z'); // T+1h due, outside NY quiet hours

    const sharedRepo = new InMemoryNotificationsSentRepository();
    // What `createNotifier(logger, { dryRun: true })` actually returns —
    // bypasses the whole in-memory + durable chain, not just the network send.
    const dryRunNotifier = new PreviewNotifier(new MemoryLogger());

    const dryResult = await new ClaimDeadlineSweepUseCase(deps(), claims, dryRunNotifier).execute(
      { dryRun: true },
      ctxAt(now.toISOString()),
    );
    expect(dryResult.notified).toBe(0);
    expect(sharedRepo.rows).toHaveLength(0);

    const real = durableNotifier(sharedRepo);
    const realResult = await new ClaimDeadlineSweepUseCase(deps(), claims, real.notifier).execute(
      { dryRun: false },
      ctxAt(now.toISOString()),
    );

    // If the dry run had consumed the idempotency key, this would come back
    // deduped instead of sent — exactly the bug item 4 guards against.
    expect(realResult.notified).toBe(1);
    expect(real.inner.sent).toHaveLength(1);
  });
});

describe('ClaimDeadlineSweepUseCase — quiet hours delay, not drop', () => {
  it('a checkpoint skipped for quiet hours is still sent on a later, non-quiet tick (fresh notifier instance)', async () => {
    const claims = new InMemoryClaimRepository();
    const bookedAt = new Date('2026-07-27T00:00:00Z'); // 00:00 UTC = 20:00 the previous day in New York
    seedOpenClaim(claims, { bookedAt, deadlineAt: new Date('2026-07-28T00:00:00Z'), timezone: 'America/New_York' });

    const sharedRepo = new InMemoryNotificationsSentRepository();

    // Tick 1: 07:30 UTC = 03:30 America/New_York — inside quiet hours. The
    // T+1h checkpoint is due but must be delayed, not dropped.
    const tick1 = await new ClaimDeadlineSweepUseCase(deps(), claims, durableNotifier(sharedRepo).notifier).execute(
      { dryRun: false },
      ctxAt('2026-07-27T07:30:00Z'),
    );
    expect(tick1.notified).toBe(0);
    expect(tick1.skippedQuietHours).toBeGreaterThan(0);
    expect(sharedRepo.rows).toHaveLength(0);

    // Tick 2, a new tick 15 minutes-plus later (13:30 UTC = 09:30 NY, well
    // outside quiet hours) via a *fresh* notifier instance — simulating a
    // cold start between the two ticks, the realistic serverless shape.
    // T+1h and T+6h are both due by now; T+20h is not yet.
    const tick2 = await new ClaimDeadlineSweepUseCase(deps(), claims, durableNotifier(sharedRepo).notifier).execute(
      { dryRun: false },
      ctxAt('2026-07-27T13:30:00Z'),
    );
    expect(tick2.notified).toBe(2);
    expect(sharedRepo.rows).toHaveLength(2);

    // Tick 3, yet another fresh instance, same instant re-evaluated: nothing
    // new to send, and no re-send of what tick 2 already delivered.
    const tick3 = await new ClaimDeadlineSweepUseCase(deps(), claims, durableNotifier(sharedRepo).notifier).execute(
      { dryRun: false },
      ctxAt('2026-07-27T13:30:00Z'),
    );
    expect(tick3.notified).toBe(0);
    expect(tick3.deduped).toBe(2);
  });

  it('exempts the T+20h final checkpoint from quiet hours when the deadline itself falls inside the same quiet-hours window', async () => {
    const claims = new InMemoryClaimRepository();
    // Deadline (bookedAt + 24h) is 2026-07-27T06:00:00Z = 02:00 America/New_York
    // — squarely inside quiet hours (21:00–08:00).
    const bookedAt = new Date('2026-07-26T06:00:00Z');
    seedOpenClaim(claims, { bookedAt, deadlineAt: new Date('2026-07-27T06:00:00Z'), timezone: 'America/New_York' });

    // now = bookedAt + 21h = 2026-07-27T03:00:00Z = 23:00 NY the previous
    // evening — also inside quiet hours, and all three checkpoints are due.
    const now = '2026-07-27T03:00:00Z';

    const result = await new ClaimDeadlineSweepUseCase(deps(), claims, durableNotifier(new InMemoryNotificationsSentRepository()).notifier).execute(
      { dryRun: false },
      ctxAt(now),
    );

    // T+1h and T+6h are delayed as normal; only the final checkpoint is
    // exempted and sent despite quiet hours.
    expect(result.skippedQuietHours).toBe(2);
    expect(result.quietHoursExempted).toBe(1);
    expect(result.notified).toBe(1);
  });

  it('does not exempt the final checkpoint when the deadline falls outside quiet hours — there is a real next-tick opportunity', async () => {
    const claims = new InMemoryClaimRepository();
    // Deadline is 2026-07-27T13:00:00Z = 09:00 America/New_York — outside
    // quiet hours (21:00–08:00), so a non-quiet tick can still catch it.
    const bookedAt = new Date('2026-07-26T13:00:00Z');
    seedOpenClaim(claims, { bookedAt, deadlineAt: new Date('2026-07-27T13:00:00Z'), timezone: 'America/New_York' });

    // now = bookedAt + 22h = 2026-07-27T11:00:00Z = 07:00 NY — inside quiet
    // hours, T+20h is due, but the deadline itself is not in quiet hours.
    const now = '2026-07-27T11:00:00Z';

    const result = await new ClaimDeadlineSweepUseCase(deps(), claims, durableNotifier(new InMemoryNotificationsSentRepository()).notifier).execute(
      { dryRun: false },
      ctxAt(now),
    );

    expect(result.quietHoursExempted).toBe(0);
    expect(result.notified).toBe(0);
    expect(result.skippedQuietHours).toBe(3);
  });
});
