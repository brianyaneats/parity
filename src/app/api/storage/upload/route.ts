import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { route } from '@/lib/api/handler';
import { ApiError, envelopeFor } from '@/lib/api/errors';
import { parseQuery } from '@/lib/validation/shared';
import { signedUploadQuerySchema, storageObjectQuerySchema } from '@/lib/validation/storage';
import { getSession } from '@/lib/auth/session';
import { createLogger } from '@/infrastructure/observability/Logger';
import { PostgresSignedUrlStorage, MAX_EVIDENCE_BYTES } from '@/infrastructure/storage/PostgresSignedUrlStorage';

/**
 * `PUT`/`GET /api/storage/upload` — §12, closing the dead end
 * `PostgresSignedUrlStorage` (née `LocalSignedUrlStorage`) minted a URL for
 * but that never existed as a route.
 *
 * **Method is `PUT`, not `POST`**, matching what actually performs the
 * upload: `useClaimPersistence.ts`'s `uploadEvidence` does
 * `fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': file.type },
 * body: file })` against exactly this path. A presigned-PUT is also the
 * conventional shape for this kind of URL generally (S3, R2, GCS all sign
 * `PUT`s the same way) — `POST` was never actually wired up anywhere in this
 * codebase for it to serve as the contract.
 *
 * **`GET` is not wrapped in `route()`.** Every other route can return
 * `route()`'s uniform JSON envelope, but this one has to return the raw
 * bytes with their own `Content-Type` on success — the same reason
 * `src/app/api/health/route.ts` builds its response by hand instead of using
 * `route()`. The error path still reuses `envelopeFor` so a failure here
 * looks exactly like a failure anywhere else in the API.
 */

const storage = new PostgresSignedUrlStorage();

export const PUT = route(
  async ({ request, logger }) => {
    const query = parseQuery(signedUploadQuerySchema, new URL(request.url).searchParams);

    const verification = storage.verify({
      key: query.key,
      expiresAtMs: query.exp,
      signature: query.sig,
      contentType: query.ct,
      userId: query.uid,
    });

    // §12: fail 403 on a bad or expired signature — not 401/404, which would
    // hint at *why* the link doesn't work to a caller who, by construction,
    // does not have a session for this route to check.
    if (!verification.ok) {
      throw ApiError.forbidden('This upload link is invalid or has expired.');
    }

    const bytes = Buffer.from(await request.arrayBuffer());

    if (bytes.byteLength === 0) {
      throw ApiError.validation('The uploaded file is empty.', { file: 'must not be empty' });
    }
    if (bytes.byteLength > MAX_EVIDENCE_BYTES) {
      throw ApiError.validation(
        `The uploaded file exceeds the ${Math.floor(MAX_EVIDENCE_BYTES / (1024 * 1024))} MB limit.`,
        { file: 'is too large' },
      );
    }

    await storage.store({
      objectId: verification.objectId,
      userId: query.uid,
      contentType: query.ct,
      bytes,
    });

    logger.info('evidence blob stored', {
      objectId: verification.objectId,
      contentType: query.ct,
      sizeBytes: bytes.byteLength,
    });

    return { key: query.key, contentType: query.ct, sizeBytes: bytes.byteLength };
  },
  { name: 'PUT /api/storage/upload' },
);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = request.headers.get('x-request-id') ?? randomUUID();
  const logger = createLogger().child({ requestId, route: 'GET /api/storage/upload', method: 'GET' });

  try {
    // Same auth as every other authenticated route (`requireUser()`'s own
    // `getSession()` + 401-on-null), inlined rather than calling
    // `requireUser()` itself only because this handler cannot go through
    // `route()` to get its automatic try/catch — see the module doc above.
    const session = await getSession();
    if (!session) throw ApiError.unauthorized();

    const { key } = parseQuery(storageObjectQuerySchema, new URL(request.url).searchParams);
    const objectId = key.split('/').pop();
    if (!objectId) throw ApiError.validation('The `key` parameter is malformed.', { key: 'is malformed' });

    const blob = await storage.read(objectId, session.userId);
    // A wrong owner and a genuinely missing object return the same 404 —
    // `PostgresSignedUrlStorage.read` scopes the query itself rather than
    // fetching then checking, so the two cases are indistinguishable here by
    // construction, the same discipline `properties.ts`/`credits.ts` use.
    if (!blob) throw ApiError.notFound('Evidence file');

    // TS 5.9's `lib.dom`'s `BufferSource` pins `ArrayBufferView<ArrayBuffer>`,
    // but Node's `Buffer` type is `Uint8Array<ArrayBufferLike>` (a strictly
    // wider generic, since `ArrayBufferLike` also covers `SharedArrayBuffer`)
    // — a real Buffer works fine as a `Response` body at runtime; this cast
    // only papers over the two libraries' generic parameters disagreeing.
    const body = blob.bytes as unknown as BodyInit;
    return new NextResponse(body, {
      status: 200,
      headers: {
        'content-type': blob.contentType,
        // §12: screenshots may contain personal data — never public, never cached.
        'cache-control': 'no-store',
        'x-request-id': requestId,
      },
    });
  } catch (error) {
    const { status, body } = envelopeFor(error, requestId);
    if (status >= 500) {
      logger.error('route failed', error, { status });
    } else {
      logger.info('route rejected the request', { status, code: body.error.code });
    }
    return NextResponse.json(body, {
      status,
      headers: { 'x-request-id': requestId, 'cache-control': 'no-store' },
    });
  }
}
