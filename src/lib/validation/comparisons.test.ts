import { describe, it, expect } from 'vitest';
import {
  createComparisonSchema,
  comparisonPatchSchema,
  comparisonListQuerySchema,
} from './comparisons';

const validContext = {
  nights: 3,
  taxRateBps: 1240,
  breakfastPerDayCents: 7000,
  propertyCreditFaceCents: 10000,
  realizationPct: 100,
  mrValueMicro: 15000,
  urValueMicro: 17500,
  foraRateBps: 700,
  amexBucketAvailable: true,
  editBucketAvailable: true,
  competitorBaseCents: 300000,
  competitorRefundable: true,
  competitorPublic: true,
  brand: 'NONE' as const,
};

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    propertyNameSnapshot: 'Four Seasons Otemachi',
    checkIn: '2026-11-10',
    checkOut: '2026-11-13',
    context: validContext,
    quotes: [{ channel: 'EDIT', totalCents: 354000, prepaid: true, refundable: true }],
    ...overrides,
  };
}

describe('createComparisonSchema — §5.2 POST /api/comparisons', () => {
  it('accepts a well-formed payload', () => {
    expect(createComparisonSchema.safeParse(validPayload()).success).toBe(true);
  });

  it('rejects a malformed check-in date', () => {
    const result = createComparisonSchema.safeParse(validPayload({ checkIn: '11/10/2026' }));
    expect(result.success).toBe(false);
  });

  it('rejects an empty property name', () => {
    expect(createComparisonSchema.safeParse(validPayload({ propertyNameSnapshot: '' })).success).toBe(false);
  });

  it('accepts an optional competing rate and rejects a fractional cent inside it', () => {
    const competingRate = {
      siteDomain: 'fourseasons.com',
      url: 'https://www.fourseasons.com/otemachi/',
      baseCents: 300000,
      refundable: true,
      publiclyAvailable: true,
    };
    expect(createComparisonSchema.safeParse(validPayload({ competingRate })).success).toBe(true);

    const badRate = validPayload({ competingRate: { ...competingRate, baseCents: 300000.5 } });
    expect(createComparisonSchema.safeParse(badRate).success).toBe(false);
  });

  it('rejects an invalid competing-rate URL', () => {
    const bad = validPayload({
      competingRate: {
        siteDomain: 'fourseasons.com',
        url: 'not-a-url',
        baseCents: 300000,
        refundable: true,
        publiclyAvailable: true,
      },
    });
    expect(createComparisonSchema.safeParse(bad).success).toBe(false);
  });

  it('reuses the shared channel enum — rejects an unknown channel', () => {
    const bad = validPayload({
      quotes: [{ channel: 'MYSTERY', totalCents: 1000, prepaid: true, refundable: true }],
    });
    expect(createComparisonSchema.safeParse(bad).success).toBe(false);
  });
});

describe('comparisonPatchSchema — §5.2 PATCH /api/comparisons/:id', () => {
  it('accepts a status-only patch', () => {
    expect(comparisonPatchSchema.safeParse({ status: 'DECIDED' }).success).toBe(true);
  });

  it('accepts a null chosenChannel — clearing the decision', () => {
    expect(comparisonPatchSchema.safeParse({ chosenChannel: null }).success).toBe(true);
  });

  it('rejects an empty patch — nothing to update', () => {
    expect(comparisonPatchSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(comparisonPatchSchema.safeParse({ status: 'ARCHIVED' }).success).toBe(false);
  });

  it('does not accept a snapshot field — §4.3/§13.3, checked at the boundary too', () => {
    const result = comparisonPatchSchema.safeParse({ status: 'DECIDED', resultSnapshot: [] });
    // Zod's default mode strips unknown keys rather than rejecting them, but
    // the parsed value must not carry the field through regardless.
    expect(result.success && !('resultSnapshot' in result.data)).toBe(true);
  });
});

describe('comparisonListQuerySchema — §5.2 GET /api/comparisons', () => {
  it('accepts an empty query', () => {
    expect(comparisonListQuerySchema.safeParse({}).success).toBe(true);
  });

  it('coerces a numeric limit from a query string', () => {
    const result = comparisonListQuerySchema.safeParse({ limit: '10' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.limit).toBe(10);
  });

  it('rejects a limit over 100', () => {
    expect(comparisonListQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });
});
