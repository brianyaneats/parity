import { randomUUID, createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../persistence/db';
import { evidenceBlobs } from '../persistence/schema';
import { constantTimeEqual } from '@/lib/auth/constantTimeEqual';
import type {
  CreateSignedUploadUrlParams,
  ObjectStorage,
  SignedUploadUrl,
} from '@/application/ports/ObjectStorage';

/**
 * HMAC-signed, short-lived upload URLs, backed by a real Postgres table
 * (`evidence_blobs`) rather than a real object-storage provider — §12's
 * contract ("private object storage with signed, short-lived URLs")
 * satisfied structurally so the app is runnable from a clean clone (§0.4),
 * without provisioning S3/R2/Vercel Blob.
 *
 * Named for what it now actually does, not just what it mints: this class
 * used to be `LocalSignedUrlStorage` and *only* generated the signed URL,
 * with nothing behind it — `PUT`ting to the URL it minted 404'd (the route
 * did not exist), so every evidence upload silently vanished. It is the
 * entire fake bucket now: `createSignedUploadUrl` mints the URL, `verify`
 * checks a request against it, `store` writes the bytes, `read` serves them
 * back out, all against `evidence_blobs`. A production deployment swaps this
 * whole class for one backed by a real provider's presigned-PUT API; nothing
 * above the `ObjectStorage` port (the evidence use case,
 * `POST /api/claims/:id/evidence`) changes, and `PUT`/`GET
 * /api/storage/upload` — which exist only because *this* implementation has
 * no real bucket to delegate to — would simply not exist in that deployment
 * either.
 */
export const ALLOWED_EVIDENCE_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const;
export type AllowedEvidenceContentType = (typeof ALLOWED_EVIDENCE_CONTENT_TYPES)[number];

/**
 * 5 MB — deliberately tighter than `claimEvidenceSchema`'s 20 MB
 * `fileSizeBytes` ceiling (`src/lib/validation/claims.ts`, §5.2), which only
 * bounds what the *client* may claim before a screenshot is even captured.
 * This is the hard limit on what this no-real-bucket-provider stand-in will
 * actually persist as a Postgres row — a database is a more expensive place
 * to hold 20 MB than an object store is, and a real screenshot of a hotel
 * booking page is realistically well under 5 MB.
 */
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

export interface StoredEvidenceBlob {
  readonly contentType: string;
  readonly bytes: Buffer;
}

export type VerifySignedUploadResult =
  | { readonly ok: true; readonly objectId: string }
  | { readonly ok: false; readonly reason: 'BAD_SIGNATURE' | 'EXPIRED' | 'MALFORMED_KEY' };

export interface SignedUploadParams {
  readonly key: string;
  readonly expiresAtMs: number;
  readonly signature: string;
  readonly contentType: string;
  readonly userId: string;
}

export class PostgresSignedUrlStorage implements ObjectStorage {
  constructor(
    private readonly secret: string = process.env.AUTH_SECRET || 'parity-dev-signing-secret',
    private readonly baseUrl: string = process.env.AUTH_URL || 'http://localhost:3000',
  ) {}

  public async createSignedUploadUrl(params: CreateSignedUploadUrlParams): Promise<SignedUploadUrl> {
    // The eventual `evidence_blobs.id` is minted here, up front, rather than
    // left to that table's `defaultRandom()` at insert time — see
    // `evidence_blobs`'s doc comment in `schema.ts` for why: it is what lets
    // `verify` below recover the same id straight out of `key`, with no
    // separate lookup column or round trip needed.
    const objectId = randomUUID();
    const key = `${params.keyPrefix}/${objectId}`;
    const expiresInSeconds = params.expiresInSeconds ?? 300;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    const signature = this.sign(key, expiresAt.getTime(), params.contentType, params.userId);

    const uploadUrl = `${this.baseUrl}/api/storage/upload?${new URLSearchParams({
      key,
      exp: String(expiresAt.getTime()),
      sig: signature,
      ct: params.contentType,
      uid: params.userId,
    }).toString()}`;

    return Promise.resolve({ uploadUrl, key, expiresAt });
  }

  /**
   * Recomputes the signature over the same fields `createSignedUploadUrl`
   * signed. `key` already carries the object id (its final path segment), so
   * `expiresAtMs`/`contentType`/`userId` are the only other inputs — every
   * one of the five query params `createSignedUploadUrl` writes is covered,
   * and tampering with any of them invalidates the signature.
   */
  private sign(key: string, expiresAtMs: number, contentType: string, userId: string): string {
    return createHmac('sha256', this.secret)
      .update(`${key}:${expiresAtMs}:${contentType}:${userId}`)
      .digest('hex');
  }

  /**
   * Verifies a `PUT /api/storage/upload` request's query params against the
   * signature `createSignedUploadUrl` issued. Signature checked with
   * `constantTimeEqual` first — a forged signature is the case worth hiding
   * timing information about; expiry checked only once the signature is
   * known-good, since `exp` is already public in the URL and a plain numeric
   * compare gains nothing from constant time.
   */
  public verify(params: SignedUploadParams, now: number = Date.now()): VerifySignedUploadResult {
    const objectId = params.key.split('/').pop();
    if (!objectId) return { ok: false, reason: 'MALFORMED_KEY' };

    const expected = this.sign(params.key, params.expiresAtMs, params.contentType, params.userId);
    if (!constantTimeEqual(expected, params.signature)) return { ok: false, reason: 'BAD_SIGNATURE' };
    if (now > params.expiresAtMs) return { ok: false, reason: 'EXPIRED' };

    return { ok: true, objectId };
  }

  /**
   * Persists the uploaded bytes under the id `verify` recovered from `key`.
   * Caller (`PUT /api/storage/upload`) has already verified the signature
   * and enforced the size cap / content-type allowlist by this point.
   */
  public async store(params: {
    objectId: string;
    userId: string;
    contentType: string;
    bytes: Buffer;
  }): Promise<void> {
    await db.insert(evidenceBlobs).values({
      id: params.objectId,
      userId: params.userId,
      contentType: params.contentType,
      bytes: params.bytes,
      sizeBytes: params.bytes.byteLength,
    });
  }

  /**
   * Reads a stored blob back, scoped to `userId` in the query itself rather
   * than checked afterward against a fetched row — the same scoping
   * discipline `properties.ts`/`credits.ts` use for reads, so a cross-user
   * request and a genuinely missing object are indistinguishable, both
   * `null`.
   */
  public async read(objectId: string, userId: string): Promise<StoredEvidenceBlob | null> {
    const [row] = await db
      .select({ contentType: evidenceBlobs.contentType, bytes: evidenceBlobs.bytes })
      .from(evidenceBlobs)
      .where(and(eq(evidenceBlobs.id, objectId), eq(evidenceBlobs.userId, userId)))
      .limit(1);

    return row ?? null;
  }
}
