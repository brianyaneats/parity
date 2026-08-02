import { z } from 'zod';
import { brandSchema } from './compare';
import { centsSchema } from './shared';

/** Validation for `/api/properties` — §5.2, §4.4, §7.8. */

export const PROPERTY_CREDIT_KIND_VALUES = ['DINING', 'SPA', 'RESORT', 'ANY'] as const;
export const propertyCreditKindSchema = z.enum(PROPERTY_CREDIT_KIND_VALUES);

export const propertySearchQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  city: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type PropertySearchQuery = z.infer<typeof propertySearchQuerySchema>;

export const createPropertySchema = z.object({
  name: z.string().trim().min(1, 'is required').max(200),
  address: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().length(2, 'must be a two-letter ISO country code').nullable().optional(),
  brand: brandSchema.optional(),
  inFhr: z.boolean().optional(),
  inThc: z.boolean().optional(),
  inEdit: z.boolean().optional(),
  propertyCreditFaceCents: centsSchema.min(0).optional(),
  propertyCreditKind: propertyCreditKindSchema.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
