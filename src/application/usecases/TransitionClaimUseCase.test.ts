import { describe, it, expect } from 'vitest';
import { TransitionClaimUseCase } from './TransitionClaimUseCase';
import { InMemoryUnitOfWork } from '../testing/fakes';
import { MemoryLogger } from '@/infrastructure/observability/Logger';
import { MetricsRegistry } from '@/infrastructure/observability/MetricsRegistry';
import { FixedClock } from '@/domain/shared/Clock';
import { ApiError } from '@/lib/api/errors';
import { cents } from '@/domain/shared/cents';
import type { ExecutionContext, UseCaseDependencies } from '../shared/UseCase';
import type { ClaimStatus } from '@/domain/claim/ClaimStatus';

/**
 * §5.2 load-bearing behaviour #2: on APPROVED/PARTIAL, `awardedCents` is
 * required and a realized `savings_events` row is written — driven through
 * the `Claim` aggregate so §7.4's transition table is the one and only
 * authority, including for the case this file exists to pin down: an expired
 * claim can only ever move to EXPIRED or NOT_PURSUED.
 */

function deps(): UseCaseDependencies & { logger: MemoryLogger; metrics: MetricsRegistry } {
  return {
    logger: new MemoryLogger(),
    metrics: new MetricsRegistry({ now: () => 0 }),
    clock: new FixedClock('2026-07-27T12:00:00Z'),
  };
}

const ctx: ExecutionContext = {
  userId: 'user-1',
  requestId: 'req-1',
  now: new Date('2026-07-27T12:00:00Z'),
};

async function seedClaim(uow: InMemoryUnitOfWork, status: ClaimStatus) {
  const booking = await uow.bookings.create({
    id: 'booking-1',
    userId: 'user-1',
    comparisonId: null,
    channel: 'EDIT',
    confirmationNumber: null,
    bookedAt: new Date('2026-07-20T00:00:00Z'),
    checkIn: '2026-08-01',
    checkOut: '2026-08-04',
    totalCents: cents(354_000),
    baseCents: cents(314_947),
    cashChargedCents: cents(354_000),
    pointsUsed: null,
    refundable: true,
    cancelDeadline: '2026-07-30',
    bucketId: null,
    status: 'ACTIVE',
  });
  return uow.claims.create({
    id: 'claim-1',
    userId: 'user-1',
    bookingId: booking.id,
    competingRateId: null,
    kind: 'CHASE_PM',
    deadlineAt: new Date('2026-07-21T00:00:00Z'),
    status,
    claimedGapCents: cents(14_947),
  });
}

describe('TransitionClaimUseCase — §5.2 claim → savings-event side effect', () => {
  it('requires awardedCents on APPROVED and writes a realized savings event when given one', async () => {
    const uow = new InMemoryUnitOfWork();
    await seedClaim(uow, 'SUBMITTED');
    const useCase = new TransitionClaimUseCase(deps(), uow);

    const updated = await useCase.execute(
      { id: 'claim-1', userId: 'user-1', status: 'APPROVED', awardedCents: 14_947 },
      ctx,
    );

    expect(updated.status).toBe('APPROVED');
    expect(updated.awardedCents).toBe(14_947);

    expect(uow.savingsEvents.rows).toHaveLength(1);
    const event = uow.savingsEvents.rows[0];
    expect(event?.realized).toBe(true);
    expect(event?.amountCents).toBe(14_947);
    expect(event?.claimId).toBe('claim-1');
    expect(event?.bookingId).toBe('booking-1');
    expect(event?.kind).toBe('PRICE_MATCH');
  });

  it('rejects APPROVED with no awardedCents — the aggregate is the one authority', async () => {
    const uow = new InMemoryUnitOfWork();
    await seedClaim(uow, 'SUBMITTED');
    const useCase = new TransitionClaimUseCase(deps(), uow);

    await expect(
      useCase.execute({ id: 'claim-1', userId: 'user-1', status: 'APPROVED' }, ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    expect(uow.savingsEvents.rows).toHaveLength(0);
    // The claim itself must not have moved — a rejected transition is a no-op.
    expect((await uow.claims.findById('claim-1', 'user-1'))?.status).toBe('SUBMITTED');
  });

  it('writes a BRG-kind savings event for a chain best-rate claim', async () => {
    const uow = new InMemoryUnitOfWork();
    const claim = await seedClaim(uow, 'SUBMITTED');
    uow.claims.rows[uow.claims.rows.indexOf(claim)] = { ...claim, kind: 'BRG_HYATT' };
    const useCase = new TransitionClaimUseCase(deps(), uow);

    await useCase.execute(
      { id: 'claim-1', userId: 'user-1', status: 'PARTIAL', awardedCents: 5_000 },
      ctx,
    );

    expect(uow.savingsEvents.rows[0]?.kind).toBe('BRG');
  });

  it('writes no savings event on DENIED', async () => {
    const uow = new InMemoryUnitOfWork();
    await seedClaim(uow, 'SUBMITTED');
    const useCase = new TransitionClaimUseCase(deps(), uow);

    const updated = await useCase.execute(
      { id: 'claim-1', userId: 'user-1', status: 'DENIED', denialReason: 'Rate no longer public.' },
      ctx,
    );

    expect(updated.status).toBe('DENIED');
    expect(updated.denialReason).toBe('Rate no longer public.');
    expect(uow.savingsEvents.rows).toHaveLength(0);
  });

  it('§7.4: an expired claim can only move to EXPIRED or NOT_PURSUED — SUBMITTED is rejected as a conflict', async () => {
    const uow = new InMemoryUnitOfWork();
    await seedClaim(uow, 'EXPIRED');
    const useCase = new TransitionClaimUseCase(deps(), uow);

    const error = await useCase
      .execute({ id: 'claim-1', userId: 'user-1', status: 'SUBMITTED' }, ctx)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('CONFLICT');
    expect((error as ApiError).status).toBe(409);
    expect(uow.savingsEvents.rows).toHaveLength(0);
  });

  it('404s on a claim the caller does not own', async () => {
    const uow = new InMemoryUnitOfWork();
    await seedClaim(uow, 'SUBMITTED');
    const useCase = new TransitionClaimUseCase(deps(), uow);

    await expect(
      useCase.execute({ id: 'claim-1', userId: 'someone-else', status: 'DENIED' }, ctx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
