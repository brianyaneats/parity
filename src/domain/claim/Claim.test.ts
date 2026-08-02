import { describe, it, expect } from 'vitest';
import { Claim } from './Claim';
import { isTransitionAllowed, ALLOWED_TRANSITIONS, CLAIM_STATUSES, type ClaimStatus } from './ClaimStatus';
import { EVIDENCE_CHECKLIST, looksCropped, isScreenshotWideEnough } from './EvidenceChecklist';
import { FixedClock, MS_PER_HOUR } from '../shared/Clock';
import type { Cents } from '../shared/cents';

const CENTS = (n: number) => n as Cents;

function openClaim(bookedAt = '2026-07-27T12:00:00Z'): Claim {
  return Claim.openForBooking({
    id: 'claim-1',
    userId: 'user-1',
    bookingId: 'booking-1',
    kind: 'CHASE_PM',
    bookedAt: new Date(bookedAt),
    claimedGapCents: CENTS(14_947),
  });
}

describe('Claim.openForBooking — §5.2, §7.4', () => {
  it('sets the deadline to exactly 24 hours after booking', () => {
    const bookedAt = new Date('2026-07-27T12:00:00Z');
    const claim = openClaim();

    expect(claim.deadlineAt.getTime() - bookedAt.getTime()).toBe(24 * MS_PER_HOUR);
    expect(claim.deadlineAt.toISOString()).toBe('2026-07-28T12:00:00.000Z');
  });

  it('starts ELIGIBLE and records that it was opened', () => {
    const claim = openClaim();
    expect(claim.status).toBe('ELIGIBLE');
    expect(claim.isOpen).toBe(true);
    expect(claim.pullDomainEvents().map((e) => e.type)).toEqual(['claim.opened']);
  });

  it('carries the claimed gap so the queue can show it before the kit is opened', () => {
    expect(openClaim().claimedGapCents).toBe(14_947);
  });
});

/**
 * §13.3: "The 24-hour window is time-math-heavy and time math is where bugs
 * live." §10.2 requires explicit tests across a DST boundary and across UTC
 * midnight, with a real clock injected as a parameter.
 */
describe('the 24-hour window does not drift — §10.2, §13.3', () => {
  it('is exactly 24 hours across the US spring-forward transition', () => {
    // 2026-03-08: US clocks jump 02:00 → 03:00 local. A calendar-field
    // implementation would produce 23 or 25 hours here.
    const bookedAt = new Date('2026-03-07T23:30:00-05:00');
    const claim = Claim.openForBooking({
      id: 'c',
      userId: 'u',
      bookingId: 'b',
      kind: 'CHASE_PM',
      bookedAt,
    });

    expect(claim.deadlineAt.getTime() - bookedAt.getTime()).toBe(24 * MS_PER_HOUR);
  });

  it('is exactly 24 hours across the US fall-back transition', () => {
    const bookedAt = new Date('2026-10-31T23:30:00-04:00');
    const claim = Claim.openForBooking({
      id: 'c',
      userId: 'u',
      bookingId: 'b',
      kind: 'CHASE_PM',
      bookedAt,
    });

    expect(claim.deadlineAt.getTime() - bookedAt.getTime()).toBe(24 * MS_PER_HOUR);
  });

  it('is exactly 24 hours across UTC midnight', () => {
    const bookedAt = new Date('2026-07-27T23:59:59Z');
    const claim = Claim.openForBooking({
      id: 'c',
      userId: 'u',
      bookingId: 'b',
      kind: 'CHASE_PM',
      bookedAt,
    });

    expect(claim.deadlineAt.toISOString()).toBe('2026-07-28T23:59:59.000Z');
  });

  it('counts down to the second and never goes negative', () => {
    const claim = openClaim();
    const clock = new FixedClock('2026-07-27T12:00:00Z');

    expect(claim.msRemaining(clock.now())).toBe(24 * MS_PER_HOUR);

    clock.advanceHours(23);
    expect(claim.msRemaining(clock.now())).toBe(MS_PER_HOUR);

    clock.advanceHours(5);
    expect(claim.msRemaining(clock.now())).toBe(0);
    expect(claim.hasPassedDeadline(clock.now())).toBe(true);
  });

  it('has not passed the deadline at the exact deadline instant', () => {
    const claim = openClaim();
    expect(claim.hasPassedDeadline(new Date('2026-07-28T12:00:00Z'))).toBe(false);
    expect(claim.hasPassedDeadline(new Date('2026-07-28T12:00:00.001Z'))).toBe(true);
  });
});

describe('Claim state machine — §7.4, DECISIONS.md D-034', () => {
  const now = new Date('2026-07-27T13:00:00Z');

  it('walks the happy path from eligible to a recorded outcome', () => {
    const claim = openClaim();
    claim.transitionTo('PREPARING', now);
    claim.transitionTo('SUBMITTED', now);
    claim.transitionTo('PARTIAL', now, { awardedCents: CENTS(10_000) });

    expect(claim.status).toBe('PARTIAL');
    expect(claim.awardedCents).toBe(10_000);
    expect(claim.submittedAt).toEqual(now);
    expect(claim.resolvedAt).toEqual(now);
    expect(claim.isTerminal).toBe(true);
  });

  it('refuses a transition the table does not allow', () => {
    const claim = openClaim();
    expect(() => claim.transitionTo('APPROVED', now, { awardedCents: CENTS(1) })).toThrow(
      /cannot move from ELIGIBLE to APPROVED/,
    );
  });

  it('refuses SUBMITTED once the deadline has passed, but still allows EXPIRED', () => {
    const claim = openClaim();
    const late = new Date('2026-07-28T12:00:01Z');

    expect(() => claim.transitionTo('SUBMITTED', late)).toThrow(/past deadline/);
    expect(() => claim.transitionTo('EXPIRED', late)).not.toThrow();
    expect(claim.status).toBe('EXPIRED');
  });

  it('allows NOT_PURSUED after the deadline as the only other exit', () => {
    const claim = openClaim();
    claim.transitionTo('NOT_PURSUED', new Date('2026-07-29T00:00:00Z'));
    expect(claim.status).toBe('NOT_PURSUED');
  });

  it('lets a claim submitted in time still be resolved days later', () => {
    // The 24 hours govern submission, not the issuer's response time.
    const claim = openClaim();
    claim.transitionTo('SUBMITTED', new Date('2026-07-27T13:00:00Z'));
    claim.transitionTo('APPROVED', new Date('2026-08-15T00:00:00Z'), {
      awardedCents: CENTS(14_947),
    });
    expect(claim.status).toBe('APPROVED');
  });

  it('requires an awarded amount for APPROVED and PARTIAL — §5.2', () => {
    const approved = openClaim();
    approved.transitionTo('SUBMITTED', now);
    expect(() => approved.transitionTo('APPROVED', now)).toThrow(/requires the amount/);

    const partial = openClaim();
    partial.transitionTo('SUBMITTED', now);
    expect(() => partial.transitionTo('PARTIAL', now, { awardedCents: null })).toThrow(
      /requires the amount/,
    );
  });

  it('rejects a negative award', () => {
    const claim = openClaim();
    claim.transitionTo('SUBMITTED', now);
    expect(() => claim.transitionTo('APPROVED', now, { awardedCents: CENTS(-1) })).toThrow(
      /cannot be negative/,
    );
  });

  it('records a denial reason without requiring an award', () => {
    const claim = openClaim();
    claim.transitionTo('SUBMITTED', now);
    claim.transitionTo('DENIED', now, { denialReason: 'Competing rate was member-only.' });

    expect(claim.status).toBe('DENIED');
    expect(claim.denialReason).toBe('Competing rate was member-only.');
    expect(claim.awardedCents).toBeNull();
  });

  it('treats every terminal status as final', () => {
    for (const terminal of ['APPROVED', 'PARTIAL', 'DENIED', 'EXPIRED', 'NOT_PURSUED'] as const) {
      expect(ALLOWED_TRANSITIONS[terminal]).toEqual([]);
    }
  });

  it('emits one transition event carrying both the old and new status', () => {
    const claim = openClaim();
    claim.pullDomainEvents();
    claim.transitionTo('PREPARING', now);

    const [event] = claim.pullDomainEvents();
    expect(event?.type).toBe('claim.transitioned');
    expect(event?.payload).toMatchObject({ from: 'ELIGIBLE', to: 'PREPARING' });
  });

  it('never allows a transition into a status outside the declared union', () => {
    for (const status of CLAIM_STATUSES) {
      for (const target of ALLOWED_TRANSITIONS[status]) {
        expect(CLAIM_STATUSES).toContain(target as ClaimStatus);
      }
    }
  });

  it('agrees with the standalone predicate', () => {
    expect(isTransitionAllowed('ELIGIBLE', 'SUBMITTED')).toBe(true);
    expect(isTransitionAllowed('SUBMITTED', 'ELIGIBLE')).toBe(false);
    expect(isTransitionAllowed('EXPIRED', 'SUBMITTED')).toBe(false);
  });
});

/**
 * Part 9: "All jobs idempotent, keyed so a double-fire cannot double-send."
 * The sweep runs every fifteen minutes, so a double fire is not hypothetical.
 */
describe('auto-expiry sweep — Part 9 idempotency', () => {
  it('expires an open claim once the deadline has passed', () => {
    const claim = openClaim();
    const clock = new FixedClock('2026-07-28T12:00:01Z');

    expect(claim.expireIfPastDeadline(clock)).toBe(true);
    expect(claim.status).toBe('EXPIRED');
  });

  it('is idempotent — a second sweep changes nothing and emits nothing', () => {
    const claim = openClaim();
    const clock = new FixedClock('2026-07-28T12:00:01Z');

    claim.expireIfPastDeadline(clock);
    claim.pullDomainEvents();

    expect(claim.expireIfPastDeadline(clock)).toBe(false);
    expect(claim.pendingEvents).toEqual([]);
  });

  it('leaves a claim inside its window alone', () => {
    const claim = openClaim();
    expect(claim.expireIfPastDeadline(new FixedClock('2026-07-28T11:59:59Z'))).toBe(false);
    expect(claim.status).toBe('ELIGIBLE');
  });

  it('never expires a claim that was already submitted', () => {
    const claim = openClaim();
    claim.transitionTo('SUBMITTED', new Date('2026-07-27T13:00:00Z'));
    expect(claim.expireIfPastDeadline(new FixedClock('2026-08-01T00:00:00Z'))).toBe(false);
    expect(claim.status).toBe('SUBMITTED');
  });
});

describe('evidence and realised savings', () => {
  it('attaches a competing rate and records it', () => {
    const claim = openClaim();
    claim.pullDomainEvents();
    claim.attachCompetingRate('rate-1', new Date());

    expect(claim.competingRateId).toBe('rate-1');
    expect(claim.pullDomainEvents()[0]?.type).toBe('claim.evidence_attached');
  });

  it('refuses to attach evidence to a resolved claim', () => {
    const claim = openClaim();
    claim.transitionTo('NOT_PURSUED', new Date());
    expect(() => claim.attachCompetingRate('rate-1', new Date())).toThrow(/resolved claim/);
  });

  it('realises only what was actually awarded — §8.6', () => {
    const claim = openClaim();
    expect(claim.realisedSavingCents()).toBe(0);

    claim.transitionTo('SUBMITTED', new Date('2026-07-27T13:00:00Z'));
    claim.transitionTo('PARTIAL', new Date('2026-07-27T18:00:00Z'), {
      awardedCents: CENTS(10_000),
    });

    // The documented Edit claim paid $100 against a $116.31 gap. The ledger
    // records the $100, never the estimate.
    expect(claim.realisedSavingCents()).toBe(10_000);
    expect(claim.claimedGapCents).toBe(14_947);
  });

  it('realises nothing from a denied claim', () => {
    const claim = openClaim();
    claim.transitionTo('SUBMITTED', new Date('2026-07-27T13:00:00Z'));
    claim.transitionTo('DENIED', new Date('2026-07-28T00:00:00Z'));
    expect(claim.realisedSavingCents()).toBe(0);
  });

  it('round-trips through JSON without losing the deadline', () => {
    const claim = openClaim();
    const json = claim.toJSON();
    expect(json.deadlineAt).toBe('2026-07-28T12:00:00.000Z');
    expect(json.status).toBe('ELIGIBLE');
  });
});

describe('the evidence checklist — §7.4', () => {
  it('has exactly the ten elements the spec enumerates', () => {
    expect(EVIDENCE_CHECKLIST).toHaveLength(10);
  });

  it('flags cancellation policy and public availability as the high-risk pair', () => {
    const highRisk = EVIDENCE_CHECKLIST.filter((item) => item.highRisk).map((item) => item.id);
    expect(highRisk).toEqual(['cancellation_policy', 'public_rate']);
  });

  it('gives every item a reason, because a checklist without consequences gets skimmed', () => {
    for (const item of EVIDENCE_CHECKLIST) {
      expect(item.why.length).toBeGreaterThan(40);
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  it('names the free-membership trap explicitly on the public-rate item', () => {
    const publicRate = EVIDENCE_CHECKLIST.find((item) => item.id === 'public_rate');
    expect(publicRate?.why).toMatch(/free/i);
  });

  it('accepts a screenshot at the minimum width and rejects one below it', () => {
    expect(isScreenshotWideEnough(1000)).toBe(true);
    expect(isScreenshotWideEnough(999)).toBe(false);
  });

  it('warns about a capture that looks like a cropped strip', () => {
    expect(looksCropped(1600, 200)).toBe(true);
    expect(looksCropped(1600, 900)).toBe(false);
    expect(looksCropped(1600, 0)).toBe(true);
  });
});
