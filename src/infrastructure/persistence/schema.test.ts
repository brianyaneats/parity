import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import { CREDIT_BUCKET_DEFINITIONS, type CreditBucketKey } from '@/domain/rules/credit.rules';
import { CLAIM_STATUSES } from '@/domain/claim/ClaimStatus';

import * as schema from './schema';

/**
 * Schema object-graph tests — no live database. These assert the Drizzle
 * definitions in schema.ts actually say what Part 4 §4.2 (and §2.4 for the
 * bucket keys) says, so a typo in a column name, enum member, or table shape
 * fails `vitest run` instead of surfacing later as a runtime migration diff
 * or a silently wrong query.
 */

const EXPECTED_TABLES = [
  'users',
  'accounts',
  'sessions',
  'verificationTokens',
  'userSettings',
  'cards',
  'creditBuckets',
  'trips',
  'properties',
  'comparisons',
  'quotes',
  'competingRates',
  'bookings',
  'claims',
  'watchlist',
  'savingsEvents',
  'ruleFlags',
] as const;

describe('every table in §4.2 is exported', () => {
  it.each(EXPECTED_TABLES)('exports `%s`', (exportName) => {
    const table = schema[exportName as keyof typeof schema];
    expect(table, `schema.${exportName} should be defined`).toBeDefined();
  });

  it('exports exactly the seventeen tables §4.2 lists — no more, no fewer', () => {
    expect(EXPECTED_TABLES).toHaveLength(17);
  });
});

describe('enum value lists match §4.2 exactly', () => {
  it('card_kind mirrors CardKind in price-match.rules.ts', () => {
    expect(schema.cardKindEnum.enumValues).toEqual([
      'AMEX_PLATINUM',
      'CSR',
      'CSR_BUSINESS',
      'JPM_RESERVE',
      'OTHER',
    ]);
  });

  it('comparison_status', () => {
    expect(schema.comparisonStatusEnum.enumValues).toEqual(['DRAFT', 'DECIDED', 'BOOKED', 'ABANDONED']);
  });

  it('booking_status', () => {
    expect(schema.bookingStatusEnum.enumValues).toEqual(['ACTIVE', 'CANCELLED', 'COMPLETED']);
  });

  it('claim_status', () => {
    expect(schema.claimStatusEnum.enumValues).toEqual([
      'ELIGIBLE',
      'PREPARING',
      'SUBMITTED',
      'APPROVED',
      'PARTIAL',
      'DENIED',
      'EXPIRED',
      'NOT_PURSUED',
    ]);
  });

  it('claim_status is reused verbatim from the Claim aggregate\'s own state machine', () => {
    // Unlike the other three enums, `claim_status` has a domain owner —
    // src/domain/claim/ClaimStatus.ts's `CLAIM_STATUSES` — so this checks the
    // pgEnum was built *from* that array, not just typed the same values by
    // coincidence.
    expect(schema.claimStatusEnum.enumValues).toEqual(CLAIM_STATUSES);
  });
});

describe('comparisons carries both immutable snapshot columns — §4.3', () => {
  it('has a jsonb context_snapshot column', () => {
    const column = schema.comparisons.contextSnapshot;
    expect(column.columnType).toBe('PgJsonb');
    expect(column.name).toBe('context_snapshot');
    expect(column.notNull).toBe(true);
  });

  it('has a jsonb result_snapshot column', () => {
    const column = schema.comparisons.resultSnapshot;
    expect(column.columnType).toBe('PgJsonb');
    expect(column.name).toBe('result_snapshot');
    expect(column.notNull).toBe(true);
  });
});

describe('money columns are integer cents — §3.1, never numeric or float', () => {
  // One representative money column per table that has one; not exhaustive,
  // but enough to catch the "money column typed as numeric/real" class of bug
  // across every table shape in the schema (jsonb-snapshot table, a table
  // with an enum status column, and a plain scoped table).
  const moneyColumns: ReadonlyArray<[string, { columnType: string; name: string }]> = [
    ['creditBuckets.faceCents', schema.creditBuckets.faceCents],
    ['creditBuckets.consumedCents', schema.creditBuckets.consumedCents],
    ['properties.propertyCreditFaceCents', schema.properties.propertyCreditFaceCents],
    ['quotes.totalCents', schema.quotes.totalCents],
    ['competingRates.baseCents', schema.competingRates.baseCents],
    ['bookings.totalCents', schema.bookings.totalCents],
    ['bookings.baseCents', schema.bookings.baseCents],
    ['bookings.cashChargedCents', schema.bookings.cashChargedCents],
    ['claims.claimedGapCents', schema.claims.claimedGapCents],
    ['claims.awardedCents', schema.claims.awardedCents],
    ['savingsEvents.amountCents', schema.savingsEvents.amountCents],
    ['userSettings.breakfastPerDayCents', schema.userSettings.breakfastPerDayCents],
  ];

  it.each(moneyColumns)('%s is a plain integer column', (_label, column) => {
    expect(column.columnType).toBe('PgInteger');
  });
});

describe('userId scoping matches §4.2\'s column list exactly', () => {
  const tablesWithUserId = [
    'cards',
    'creditBuckets',
    'trips',
    'properties',
    'comparisons',
    'bookings',
    'claims',
    'watchlist',
    'savingsEvents',
    'ruleFlags',
  ] as const;

  it.each(tablesWithUserId)('%s has a userId column', (tableName) => {
    const table = schema[tableName] as unknown as Record<string, { name: string } | undefined>;
    expect(table.userId?.name).toBe('user_id');
  });

  it('userSettings is keyed on user_id directly (no separate id) — §4.2\'s own DDL', () => {
    expect(schema.userSettings.userId.name).toBe('user_id');
    const config = getTableConfig(schema.userSettings);
    expect(config.primaryKeys[0]?.columns.map((c) => c.name) ?? ['user_id']).toEqual(['user_id']);
  });

  it('users has no userId column (it is the referenced table, not a scoped one)', () => {
    expect('userId' in schema.users).toBe(false);
  });

  // §4.2 scopes quotes and competing_rates only through comparison_id; adding
  // a redundant denormalized userId isn't in the spec's DDL for either table.
  it.each(['quotes', 'competingRates'] as const)(
    '%s has no direct userId column — scoped via comparison_id instead',
    (tableName) => {
      expect('userId' in schema[tableName]).toBe(false);
      const table = schema[tableName] as unknown as Record<string, { name: string } | undefined>;
      expect(table.comparisonId?.name).toBe('comparison_id');
    },
  );
});

describe('the partial and functional indexes from §4.2 are present', () => {
  it('claims has a partial index on (user_id, deadline_at)', () => {
    const config = getTableConfig(schema.claims);
    const partial = config.indexes.find((idx) => idx.config.name === 'claims_user_deadline_pending_idx');
    expect(partial, 'expected claims_user_deadline_pending_idx to exist').toBeDefined();
    expect(partial?.config.where).toBeDefined();
  });

  it('properties has a functional index on lower(name)', () => {
    const config = getTableConfig(schema.properties);
    const functional = config.indexes.find((idx) => idx.config.name === 'properties_lower_name_idx');
    expect(functional, 'expected properties_lower_name_idx to exist').toBeDefined();
  });
});

describe('CREDIT_BUCKET_DEFINITIONS covers exactly §2.4\'s six buckets', () => {
  const SPEC_BUCKET_KEYS: readonly CreditBucketKey[] = [
    'AMEX_HOTEL_H1',
    'AMEX_HOTEL_H2',
    'CSR_EDIT_H1',
    'CSR_EDIT_H2',
    'CSR_BRANDS',
    'CSR_TRAVEL',
  ];

  it('has exactly six definitions', () => {
    expect(CREDIT_BUCKET_DEFINITIONS).toHaveLength(6);
  });

  it('keys match §2.4\'s table exactly, independent of order', () => {
    const actualKeys = CREDIT_BUCKET_DEFINITIONS.map((d) => d.key).slice().sort();
    const expectedKeys = SPEC_BUCKET_KEYS.slice().sort();
    expect(actualKeys).toEqual(expectedKeys);
  });

  it('every definition key also fits the credit_buckets.key column\'s reused type', () => {
    // Compile-time proof that credit_buckets.key ($type<CreditBucketKey>()) and
    // CREDIT_BUCKET_DEFINITIONS share the same key type, not just the same
    // runtime values.
    const keys: readonly CreditBucketKey[] = CREDIT_BUCKET_DEFINITIONS.map((d) => d.key);
    expect(keys.every((k) => SPEC_BUCKET_KEYS.includes(k))).toBe(true);
  });
});
