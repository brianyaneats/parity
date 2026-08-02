/**
 * `ObjectStorage` — port for §12's private, signed-URL screenshot storage.
 *
 * "Screenshots may contain personal data. Store in private object storage
 * with signed, short-lived URLs. Never public." This port is the seam for
 * whatever bucket provider is actually wired up (S3, R2, Vercel Blob, …); see
 * `src/infrastructure/storage/LocalSignedUrlStorage.ts` for the
 * no-credentials-available implementation this build ships with.
 */
export interface SignedUploadUrl {
  readonly uploadUrl: string;
  /** The object key written to `competing_rates.screenshot_key`. */
  readonly key: string;
  readonly expiresAt: Date;
}

export interface CreateSignedUploadUrlParams {
  readonly keyPrefix: string;
  readonly contentType: string;
  readonly expiresInSeconds?: number;
}

export interface ObjectStorage {
  createSignedUploadUrl(params: CreateSignedUploadUrlParams): Promise<SignedUploadUrl>;
}
