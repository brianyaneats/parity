import { z } from 'zod';
import { uuidSchema } from './shared';
import { ALLOWED_EVIDENCE_CONTENT_TYPES } from '@/infrastructure/storage/PostgresSignedUrlStorage';

/** Validation for `/api/storage/upload` — §12. */

/**
 * `PUT /api/storage/upload`'s query params — everything
 * `PostgresSignedUrlStorage.createSignedUploadUrl` wrote onto the signed URL
 * (`key`, `exp`, `sig`, `ct`, `uid`). `ct` is restricted to the same
 * allowlist `PostgresSignedUrlStorage` enforces at store time, so an
 * out-of-list content type is rejected here as an ordinary 422 rather than
 * reaching signature verification at all.
 */
export const signedUploadQuerySchema = z.object({
  key: z.string().min(1),
  exp: z.coerce.number().int().positive(),
  sig: z.string().min(1),
  ct: z.enum(ALLOWED_EVIDENCE_CONTENT_TYPES),
  uid: uuidSchema,
});

export type SignedUploadQuery = z.infer<typeof signedUploadQuerySchema>;

/** `GET /api/storage/upload`'s query params — just the `key` a caller was previously handed. */
export const storageObjectQuerySchema = z.object({
  key: z.string().min(1),
});

export type StorageObjectQuery = z.infer<typeof storageObjectQuerySchema>;
