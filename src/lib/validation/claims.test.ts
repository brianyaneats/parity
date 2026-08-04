import { describe, it, expect } from 'vitest';
import { claimPatchSchema, claimListQuerySchema, claimEvidenceSchema } from './claims';

describe('claimPatchSchema — §5.2 PATCH /api/claims/:id', () => {
  it('accepts APPROVED with an awardedCents figure', () => {
    expect(claimPatchSchema.safeParse({ status: 'APPROVED', awardedCents: 10000 }).success).toBe(true);
  });

  it('rejects APPROVED with no awardedCents', () => {
    const result = claimPatchSchema.safeParse({ status: 'APPROVED' });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.path).toEqual(['awardedCents']);
  });

  it('rejects PARTIAL with no awardedCents', () => {
    expect(claimPatchSchema.safeParse({ status: 'PARTIAL' }).success).toBe(false);
  });

  it('does not require awardedCents for DENIED', () => {
    expect(claimPatchSchema.safeParse({ status: 'DENIED', denialReason: 'no longer public' }).success).toBe(true);
  });

  it('accepts a DENIED outcome carrying a structured denialCode', () => {
    expect(
      claimPatchSchema.safeParse({ status: 'DENIED', denialCode: 'MEMBERSHIP_GATED' }).success,
    ).toBe(true);
  });

  it('rejects a denialCode outside the DenialReason.ts union', () => {
    const result = claimPatchSchema.safeParse({ status: 'DENIED', denialCode: 'RATE_WAS_TOO_HIGH' });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.path).toEqual(['denialCode']);
  });

  it('does not require a denialCode on DENIED — the code is optional so old rows stay valid', () => {
    expect(claimPatchSchema.safeParse({ status: 'DENIED' }).success).toBe(true);
  });

  it('does not require awardedCents for SUBMITTED or NOT_PURSUED', () => {
    expect(claimPatchSchema.safeParse({ status: 'SUBMITTED' }).success).toBe(true);
    expect(claimPatchSchema.safeParse({ status: 'NOT_PURSUED' }).success).toBe(true);
  });

  it('rejects a negative award', () => {
    expect(claimPatchSchema.safeParse({ status: 'APPROVED', awardedCents: -100 }).success).toBe(false);
  });
});

describe('claimListQuerySchema — §5.2 GET /api/claims', () => {
  it('accepts the documented ?dueWithin=24h form', () => {
    const result = claimListQuerySchema.safeParse({ dueWithin: '24h' });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed dueWithin', () => {
    expect(claimListQuerySchema.safeParse({ dueWithin: '1day' }).success).toBe(false);
  });

  it('accepts no filters at all', () => {
    expect(claimListQuerySchema.safeParse({}).success).toBe(true);
  });
});

describe('claimEvidenceSchema — §5.2 POST /api/claims/:id/evidence', () => {
  it('accepts a minimal payload with no competing rate', () => {
    expect(
      claimEvidenceSchema.safeParse({ contentType: 'image/png', fileSizeBytes: 2_000_000 }).success,
    ).toBe(true);
  });

  it('rejects an unsupported content type', () => {
    expect(
      claimEvidenceSchema.safeParse({ contentType: 'image/gif', fileSizeBytes: 1000 }).success,
    ).toBe(false);
  });

  it('rejects an oversized file', () => {
    expect(
      claimEvidenceSchema.safeParse({ contentType: 'image/png', fileSizeBytes: 50_000_000 }).success,
    ).toBe(false);
  });
});
