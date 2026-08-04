import { describe, it, expect } from 'vitest';
import {
  classifyPosting,
  daysSinceCharge,
  isOutstanding,
  type CreditPostingSnapshot,
  type CreditPostingStatus,
} from './CreditPosting';
import { CREDIT_POSTING_SETTLING_DAYS, CREDIT_POSTING_ABANDON_DAYS } from '../rules/posting.rules';

const CHARGED_ON = '2026-05-01';

function snapshot(status: CreditPostingStatus): CreditPostingSnapshot {
  return { chargedOn: CHARGED_ON, status };
}

function daysLater(days: number): Date {
  return new Date(new Date(`${CHARGED_ON}T00:00:00Z`).getTime() + days * 86_400_000);
}

describe('daysSinceCharge', () => {
  it('counts whole days from a UTC midnight charge date', () => {
    expect(daysSinceCharge(CHARGED_ON, daysLater(0))).toBe(0);
    expect(daysSinceCharge(CHARGED_ON, daysLater(1))).toBe(1);
    expect(daysSinceCharge(CHARGED_ON, daysLater(30))).toBe(30);
  });

  it('agrees across timezones because both ends are UTC midnights', () => {
    // 23:00 in New York on day 10 is already day 11 in UTC — daysSinceCharge
    // is computed from the instant, same as CreditWindow's own day counts.
    const nyLateNight = new Date('2026-05-11T03:00:00Z');
    expect(daysSinceCharge(CHARGED_ON, nyLateNight)).toBe(10);
  });
});

describe('classifyPosting — boundaries at exactly 14 and 70 days (§ posting.rules.ts)', () => {
  it('is SETTLING through day 14 inclusive — the calmer side of the boundary', () => {
    expect(classifyPosting(snapshot('PENDING'), daysLater(0))).toBe('SETTLING');
    expect(classifyPosting(snapshot('PENDING'), daysLater(CREDIT_POSTING_SETTLING_DAYS))).toBe('SETTLING');
  });

  it('becomes OVERDUE the day after settling ends', () => {
    expect(classifyPosting(snapshot('PENDING'), daysLater(CREDIT_POSTING_SETTLING_DAYS + 1))).toBe('OVERDUE');
  });

  it('stays OVERDUE through day 70 inclusive', () => {
    expect(classifyPosting(snapshot('PENDING'), daysLater(CREDIT_POSTING_ABANDON_DAYS))).toBe('OVERDUE');
  });

  it('becomes STALE the day after the abandon window closes', () => {
    expect(classifyPosting(snapshot('PENDING'), daysLater(CREDIT_POSTING_ABANDON_DAYS + 1))).toBe('STALE');
  });

  it('bands MISSING against the same clock as PENDING', () => {
    expect(classifyPosting(snapshot('MISSING'), daysLater(5))).toBe('SETTLING');
    expect(classifyPosting(snapshot('MISSING'), daysLater(20))).toBe('OVERDUE');
    expect(classifyPosting(snapshot('MISSING'), daysLater(90))).toBe('STALE');
  });
});

describe('classifyPosting — resolved statuses pass through regardless of days elapsed', () => {
  it('reports POSTED at any distance from the charge date', () => {
    expect(classifyPosting(snapshot('POSTED'), daysLater(0))).toBe('POSTED');
    expect(classifyPosting(snapshot('POSTED'), daysLater(200))).toBe('POSTED');
  });

  it('reports DISPUTED at any distance from the charge date', () => {
    expect(classifyPosting(snapshot('DISPUTED'), daysLater(0))).toBe('DISPUTED');
    expect(classifyPosting(snapshot('DISPUTED'), daysLater(200))).toBe('DISPUTED');
  });

  it('reports WRITTEN_OFF at any distance from the charge date', () => {
    expect(classifyPosting(snapshot('WRITTEN_OFF'), daysLater(0))).toBe('WRITTEN_OFF');
    expect(classifyPosting(snapshot('WRITTEN_OFF'), daysLater(200))).toBe('WRITTEN_OFF');
  });
});

describe('isOutstanding', () => {
  it('is true only for PENDING and MISSING — the statuses the attention section surfaces', () => {
    expect(isOutstanding('PENDING')).toBe(true);
    expect(isOutstanding('MISSING')).toBe(true);
    expect(isOutstanding('POSTED')).toBe(false);
    expect(isOutstanding('DISPUTED')).toBe(false);
    expect(isOutstanding('WRITTEN_OFF')).toBe(false);
  });
});
