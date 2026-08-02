import { randomUUID, createHmac } from 'node:crypto';
import type {
  CreateSignedUploadUrlParams,
  ObjectStorage,
  SignedUploadUrl,
} from '@/application/ports/ObjectStorage';

/**
 * HMAC-signed, short-lived upload URLs, with no external object-storage
 * credentials required — §12's contract ("private object storage with
 * signed, short-lived URLs") satisfied structurally so the app is runnable
 * from a clean clone (§0.4), without provisioning S3/R2/Vercel Blob.
 *
 * This does not itself receive the upload — there is no bucket behind it in
 * this environment. A production deployment swaps this implementation for
 * one backed by a real provider's presigned-POST API; nothing above this
 * port (the evidence use case, the route) changes, because both speak only
 * `ObjectStorage`.
 */
export class LocalSignedUrlStorage implements ObjectStorage {
  constructor(
    private readonly secret: string = process.env.AUTH_SECRET || 'parity-dev-signing-secret',
    private readonly baseUrl: string = process.env.AUTH_URL || 'http://localhost:3000',
  ) {}

  public async createSignedUploadUrl(params: CreateSignedUploadUrlParams): Promise<SignedUploadUrl> {
    const key = `${params.keyPrefix}/${randomUUID()}`;
    const expiresInSeconds = params.expiresInSeconds ?? 300;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    const signature = createHmac('sha256', this.secret)
      .update(`${key}:${expiresAt.getTime()}:${params.contentType}`)
      .digest('hex');

    const uploadUrl = `${this.baseUrl}/api/storage/upload?${new URLSearchParams({
      key,
      exp: String(expiresAt.getTime()),
      sig: signature,
      ct: params.contentType,
    }).toString()}`;

    return Promise.resolve({ uploadUrl, key, expiresAt });
  }
}
