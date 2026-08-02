import { describe, it, expect } from 'vitest';
import {
  defineRule,
  isRuleStale,
  ruleAgeDays,
  RULE_STALENESS_DAYS,
  VERIFIED_ON,
  type RuleConstant,
} from './rule-types';
import {
  ALL_RULES,
  buildRuleViews,
  findRule,
  staleRules,
  formatRuleValue,
} from './registry';
import {
  CHANNEL_RANK_ORDER,
  PERK_GRANTING_CHANNELS,
  PRICE_MATCHABLE_CHANNELS,
  CHANNEL_CATALOG_RULE,
  isChannel,
  type Channel,
} from './channels.rules';
import { CREDIT_BUCKET_DEFINITIONS } from './credit.rules';

const DAY_MS = 86_400_000;

/** Builds a throwaway rule for exercising isRuleStale/ruleAgeDays in isolation. */
function fixtureRule(verifiedOn: string): RuleConstant<number> {
  return defineRule({
    key: 'TEST_FIXTURE_RULE',
    label: 'Test fixture rule',
    description: 'Constructed only for this test — not part of the real registry.',
    category: 'POINTS',
    value: 1,
    unit: 'count',
    verifiedOn,
    sourceUrl: 'https://example.com/test-fixture-rule',
  });
}

// ============================================================= rule-types.ts

describe('isRuleStale and ruleAgeDays — §2.8', () => {
  it('is not stale, and reports a small age, for a recently verified rule', () => {
    const rule = fixtureRule('2026-01-01');
    const now = new Date('2026-01-05T00:00:00Z');
    expect(ruleAgeDays(rule, now)).toBe(4);
    expect(isRuleStale(rule, now)).toBe(false);
  });

  it('is not stale exactly at the staleness boundary — the check is strictly greater-than', () => {
    const rule = fixtureRule('2026-01-01');
    const verified = new Date('2026-01-01T00:00:00Z');
    const now = new Date(verified.getTime() + RULE_STALENESS_DAYS * DAY_MS);

    expect(ruleAgeDays(rule, now)).toBe(RULE_STALENESS_DAYS);
    expect(isRuleStale(rule, now)).toBe(false);
  });

  it('is stale one day past the boundary', () => {
    const rule = fixtureRule('2026-01-01');
    const verified = new Date('2026-01-01T00:00:00Z');
    const now = new Date(verified.getTime() + (RULE_STALENESS_DAYS + 1) * DAY_MS);

    expect(ruleAgeDays(rule, now)).toBe(RULE_STALENESS_DAYS + 1);
    expect(isRuleStale(rule, now)).toBe(true);
  });

  it('treats an unparseable verifiedOn date as stale, with infinite age', () => {
    const rule = fixtureRule('not-a-real-date');
    const now = new Date('2026-01-05T00:00:00Z');

    expect(isRuleStale(rule, now)).toBe(true);
    expect(ruleAgeDays(rule, now)).toBe(Number.POSITIVE_INFINITY);
  });
});

// ================================================================ registry.ts

describe('buildRuleViews', () => {
  it('projects every rule in the registry, with correct age and staleness for the given now', () => {
    const verified = new Date(`${VERIFIED_ON}T00:00:00Z`);
    const freshNow = new Date(verified.getTime() + 30 * DAY_MS);

    const views = buildRuleViews(freshNow);
    expect(views).toHaveLength(ALL_RULES.length);

    const channelView = views.find((v) => v.key === CHANNEL_CATALOG_RULE.key);
    expect(channelView).toBeDefined();
    expect(channelView).toMatchObject({
      key: CHANNEL_CATALOG_RULE.key,
      label: CHANNEL_CATALOG_RULE.label,
      category: 'CHANNEL',
      categoryLabel: 'Channels',
      value: CHANNEL_CATALOG_RULE.value,
      unit: 'count',
      ageDays: 30,
      stale: false,
    });
  });

  it('marks every rule stale once now is well past the staleness window', () => {
    const verified = new Date(`${VERIFIED_ON}T00:00:00Z`);
    const farFuture = new Date(verified.getTime() + (RULE_STALENESS_DAYS + 100) * DAY_MS);

    const views = buildRuleViews(farFuture);
    expect(views.every((v) => v.stale)).toBe(true);
  });
});

describe('findRule', () => {
  it('finds a rule by its key', () => {
    expect(findRule('CHANNEL_COUNT')).toBe(CHANNEL_CATALOG_RULE);
  });

  it('returns undefined for a key that does not exist', () => {
    expect(findRule('NOT_A_REAL_RULE_KEY')).toBeUndefined();
  });
});

describe('staleRules — feeds the weekly digest job', () => {
  it('returns nothing when now equals the verification date', () => {
    const now = new Date(`${VERIFIED_ON}T00:00:00Z`);
    expect(staleRules(now)).toHaveLength(0);
  });

  it('returns every rule once now is well past the staleness window', () => {
    const verified = new Date(`${VERIFIED_ON}T00:00:00Z`);
    const farFuture = new Date(verified.getTime() + (RULE_STALENESS_DAYS + 100) * DAY_MS);
    expect(staleRules(farFuture)).toHaveLength(ALL_RULES.length);
  });
});

describe('formatRuleValue', () => {
  it('formats a cents value as a currency string', () => {
    expect(formatRuleValue({ value: 30_000, unit: 'cents' })).toBe('$300.00');
  });

  it('falls back to String() for a non-number cents value', () => {
    expect(formatRuleValue({ value: 'n/a', unit: 'cents' })).toBe('n/a');
  });

  it('formats a bps value as a percentage', () => {
    expect(formatRuleValue({ value: 1_240, unit: 'bps' })).toBe('12.40%');
  });

  it('falls back to String() for a non-number bps value', () => {
    expect(formatRuleValue({ value: 'n/a', unit: 'bps' })).toBe('n/a');
  });

  it('formats a micro value as cents-per-point', () => {
    expect(formatRuleValue({ value: 15_000, unit: 'micro' })).toBe('1.50¢ per point');
  });

  it('falls back to String() for a non-number micro value', () => {
    expect(formatRuleValue({ value: 'n/a', unit: 'micro' })).toBe('n/a');
  });

  it('formats a percent value with a trailing % sign', () => {
    expect(formatRuleValue({ value: 40, unit: 'percent' })).toBe('40%');
  });

  it('falls back to String() for a non-number percent value', () => {
    expect(formatRuleValue({ value: 'n/a', unit: 'percent' })).toBe('n/a');
  });

  it('formats a singular night', () => {
    expect(formatRuleValue({ value: 1, unit: 'nights' })).toBe('1 night');
  });

  it('formats a plural night count', () => {
    expect(formatRuleValue({ value: 2, unit: 'nights' })).toBe('2 nights');
    expect(formatRuleValue({ value: 0, unit: 'nights' })).toBe('0 nights');
  });

  it('falls back to String() for a non-number nights value', () => {
    expect(formatRuleValue({ value: 'n/a', unit: 'nights' })).toBe('n/a');
  });

  it('formats a singular hour', () => {
    expect(formatRuleValue({ value: 1, unit: 'hours' })).toBe('1 hour');
  });

  it('formats a plural hour count', () => {
    expect(formatRuleValue({ value: 24, unit: 'hours' })).toBe('24 hours');
  });

  it('falls back to String() for a non-number hours value', () => {
    expect(formatRuleValue({ value: 'n/a', unit: 'hours' })).toBe('n/a');
  });

  it('formats boolean true as Yes and false as No', () => {
    expect(formatRuleValue({ value: true, unit: 'boolean' })).toBe('Yes');
    expect(formatRuleValue({ value: false, unit: 'boolean' })).toBe('No');
  });

  it('formats a count array by joining its elements', () => {
    expect(formatRuleValue({ value: ['CSR', 'CSR_BUSINESS', 'JPM_RESERVE'], unit: 'count' })).toBe(
      'CSR, CSR_BUSINESS, JPM_RESERVE',
    );
  });

  it('formats a scalar count value with String()', () => {
    expect(formatRuleValue({ value: 9, unit: 'count' })).toBe('9');
  });

  it('falls back to String() for an unrecognised unit', () => {
    const unknownUnit = 'unknown' as unknown as RuleConstant<unknown>['unit'];
    expect(formatRuleValue({ value: 42, unit: unknownUnit })).toBe('42');
  });
});

// ============================================================= registry invariants

describe('rule registry invariants — §2.8', () => {
  it('every rule key in ALL_RULES is unique', () => {
    const keys = ALL_RULES.map((rule) => rule.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every rule has a non-empty sourceUrl that starts with https://', () => {
    for (const rule of ALL_RULES) {
      expect(rule.sourceUrl.length).toBeGreaterThan(0);
      expect(rule.sourceUrl.startsWith('https://')).toBe(true);
    }
  });

  it('every rule was verified against the same build-wide VERIFIED_ON date', () => {
    for (const rule of ALL_RULES) {
      expect(rule.verifiedOn).toBe(VERIFIED_ON);
    }
  });
});

// ============================================================ channels.rules.ts

describe('CHANNEL_RANK_ORDER — §2.2, §3.4 tie-break (c)', () => {
  it('contains exactly the nine documented channels, in the spec order, with no duplicates', () => {
    const expected: readonly Channel[] = [
      'FHR',
      'THC',
      'EDIT',
      'CHASE_TRAVEL',
      'DIRECT_FLEX',
      'DIRECT_PREPAID',
      'OTA',
      'FORA',
      'PHONE',
    ];
    expect(CHANNEL_RANK_ORDER).toEqual(expected);
    expect(new Set(CHANNEL_RANK_ORDER).size).toBe(9);
  });
});

describe('PERK_GRANTING_CHANNELS — §2.2', () => {
  it('is exactly FHR, THC and EDIT', () => {
    expect(new Set(PERK_GRANTING_CHANNELS)).toEqual(new Set<Channel>(['FHR', 'THC', 'EDIT']));
  });
});

describe('PRICE_MATCHABLE_CHANNELS — §2.3.1 PM2, the product’s central asymmetry', () => {
  it('is exactly EDIT and CHASE_TRAVEL', () => {
    expect(new Set(PRICE_MATCHABLE_CHANNELS)).toEqual(
      new Set<Channel>(['EDIT', 'CHASE_TRAVEL']),
    );
  });

  it('explicitly excludes both Amex channels — FHR and THC have no price-match backstop', () => {
    expect(PRICE_MATCHABLE_CHANNELS.has('FHR')).toBe(false);
    expect(PRICE_MATCHABLE_CHANNELS.has('THC')).toBe(false);
  });
});

describe('isChannel', () => {
  it('accepts a real channel', () => {
    expect(isChannel('FHR')).toBe(true);
    expect(isChannel('PHONE')).toBe(true);
  });

  it('rejects a string that is not one of the nine channels', () => {
    expect(isChannel('NOT_A_CHANNEL')).toBe(false);
    expect(isChannel('')).toBe(false);
  });
});

// ============================================================= credit.rules.ts

describe('CREDIT_BUCKET_DEFINITIONS — §2.4', () => {
  it('has exactly six buckets with unique keys', () => {
    expect(CREDIT_BUCKET_DEFINITIONS).toHaveLength(6);
    const keys = CREDIT_BUCKET_DEFINITIONS.map((bucket) => bucket.key);
    expect(new Set(keys).size).toBe(6);
  });
});
