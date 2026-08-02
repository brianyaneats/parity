import { z } from 'zod';
import { nonNegativeCents } from './shared';

/** Validation for `/api/claims` — §5.2, §7.4. */

export const CLAIM_STATUS_VALUES = [
  'ELIGIBLE',
  'PREPARING',
  'SUBMITTED',
  'APPROVED',
  'PARTIAL',
  'DENIED',
  'EXPIRED',
  'NOT_PURSUED',
] as const;
export const claimStatusSchema = z.enum(CLAIM_STATUS_VALUES);

export const claimListQuerySchema = z.object({
  status: claimStatusSchema.optional(),
  // §5.2: `?dueWithin=24h` — only the `h`-suffixed hour form is specified, so
  // that is all that is accepted; anything else is a 422 rather than a guess.
  dueWithin: z
    .string()
    .regex(/^\d+h$/, 'must look like "24h"')
    .optional(),
});

export type ClaimListQuery = z.infer<typeof claimListQuerySchema>;

/**
 * §5.2: "on APPROVED/PARTIAL require `awarded_cents`." The cross-field
 * requirement is enforced here so a malformed request never reaches the
 * `Claim` aggregate — `Claim.transitionTo` enforces the same rule again
 * (§7.4's single-source-of-truth requirement), so this is defence in depth,
 * not a duplicate authority.
 */
export const claimPatchSchema = z
  .object({
    status: claimStatusSchema,
    awardedCents: nonNegativeCents.optional(),
    denialReason: z.string().trim().max(2000).optional(),
    notes: z.string().trim().max(4000).optional(),
  })
  .refine((value) => !(value.status === 'APPROVED' || value.status === 'PARTIAL') || value.awardedCents !== undefined, {
    message: 'awardedCents is required when approving or partially approving a claim.',
    path: ['awardedCents'],
  });

export type ClaimPatchInput = z.infer<typeof claimPatchSchema>;

export const claimEvidenceSchema = z.object({
  // Presigned-upload contract (§12: screenshots live in private storage behind
  // short-lived signed URLs): the client tells us the file's content type and
  // size so the signer can constrain the presigned POST/PUT, and — when it
  // already has a competing rate captured — reuses that data to create one if
  // the claim doesn't have one yet (§5.2).
  contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  fileSizeBytes: z.number().int().min(1).max(20_000_000),
  competingRate: z
    .object({
      siteDomain: z.string().trim().min(1).max(200),
      url: z.string().trim().url().max(2000),
      baseCents: nonNegativeCents,
      taxCents: nonNegativeCents.nullable().optional(),
      refundable: z.boolean(),
      publiclyAvailable: z.boolean(),
      roomType: z.string().trim().max(120).nullable().optional(),
      bedType: z.string().trim().max(120).nullable().optional(),
      adults: z.number().int().min(0).max(20).nullable().optional(),
      children: z.number().int().min(0).max(20).nullable().optional(),
      currency: z.string().length(3).nullable().optional(),
    })
    .optional(),
});

export type ClaimEvidenceInput = z.infer<typeof claimEvidenceSchema>;
