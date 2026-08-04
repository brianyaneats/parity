import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * `PUT`/`GET /api/storage/upload` — the fix for the dead-end evidence-upload
 * flow: `PostgresSignedUrlStorage` (`src/infrastructure/storage/`) minted a
 * signed URL pointing here, but until this route existed every `PUT` 404'd
 * and the screenshot silently never reached the server.
 *
 * The real HMAC sign/verify logic is never mocked — `PostgresSignedUrlStorage`
 * is imported for real via `vi.importActual` and only its Postgres-touching
 * `store`/`read` methods are overridden, with an in-memory `Map` standing in
 * for `evidence_blobs`. Same reasoning `magic-link/route.test.ts` gives for
 * mocking `DrizzleAuthRepository` et al.: no real Postgres in this test tier
 * (`component`, per `package.json`/CI). `@/infrastructure/persistence/db` is
 * mocked to an inert object for the same reason `db.ts` gives that test —
 * its module scope calls `postgres(requireDatabaseUrl())`, which throws
 * immediately without a `DATABASE_URL` — and it is never actually called
 * here since both methods that would touch it are overridden below.
 */

// `signedUploadQuerySchema.uid` requires a real UUID (`uuidSchema`, matching
// `users.id`'s column type), so test fixtures need UUID-shaped ids too —
// unlike most of this app's other route tests, which can get away with a
// plain string like `'user-1'` because nothing on their path validates the
// shape of `userId`.
const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

let currentSession: { userId: string; email: string } | null = null;

vi.mock('@/lib/auth/session', () => ({
  getSession: async () => currentSession,
}));

vi.mock('@/infrastructure/persistence/db', () => ({ db: {} }));

vi.mock('@/infrastructure/storage/PostgresSignedUrlStorage', async () => {
  const actual = await vi.importActual<typeof import('@/infrastructure/storage/PostgresSignedUrlStorage')>(
    '@/infrastructure/storage/PostgresSignedUrlStorage',
  );

  const blobs = new Map<string, { userId: string; contentType: string; bytes: Buffer }>();

  class TestPostgresSignedUrlStorage extends actual.PostgresSignedUrlStorage {
    override async store(params: {
      objectId: string;
      userId: string;
      contentType: string;
      bytes: Buffer;
    }): Promise<void> {
      blobs.set(params.objectId, {
        userId: params.userId,
        contentType: params.contentType,
        bytes: params.bytes,
      });
    }

    override async read(objectId: string, userId: string): Promise<{ contentType: string; bytes: Buffer } | null> {
      const row = blobs.get(objectId);
      return row && row.userId === userId ? { contentType: row.contentType, bytes: row.bytes } : null;
    }
  }

  return { ...actual, PostgresSignedUrlStorage: TestPostgresSignedUrlStorage };
});

const { PostgresSignedUrlStorage, MAX_EVIDENCE_BYTES } = await import(
  '@/infrastructure/storage/PostgresSignedUrlStorage'
);
const { PUT, GET } = await import('./route');

beforeEach(() => {
  vi.stubEnv('LOG_LEVEL', 'error');
  currentSession = null;
});

async function mintUrl(
  overrides: { contentType?: string; expiresInSeconds?: number; userId?: string } = {},
): Promise<{ uploadUrl: string; key: string }> {
  const storage = new PostgresSignedUrlStorage();
  return storage.createSignedUploadUrl({
    keyPrefix: 'claims/claim-1',
    contentType: overrides.contentType ?? 'image/png',
    userId: overrides.userId ?? USER_A,
    expiresInSeconds: overrides.expiresInSeconds,
  });
}

/**
 * Every `PUT` below is unauthenticated (`currentSession` is `null` unless a
 * test says otherwise), so `route()`'s own rate limiting keys on client IP —
 * a fresh IP per call keeps the tests from tripping the 5/minute per-IP
 * budget against each other, the same reason `magic-link/route.test.ts`
 * gives each of its scenarios a distinct IP.
 */
let ipCounter = 0;
function putRequest(url: string, body: Uint8Array, contentType = 'image/png'): NextRequest {
  ipCounter += 1;
  return new Request(url, {
    method: 'PUT',
    headers: { 'content-type': contentType, 'x-forwarded-for': `203.0.113.${ipCounter}` },
    // Same TS 5.9 `Uint8Array<ArrayBufferLike>` vs `lib.dom`'s
    // `ArrayBufferView<ArrayBuffer>` generic mismatch as `route.ts`'s own
    // `NextResponse` body — a real `Uint8Array` works fine as a fetch body.
    body: body as unknown as BodyInit,
  }) as unknown as NextRequest;
}

function getRequest(url: string): NextRequest {
  return new Request(url, { method: 'GET' }) as unknown as NextRequest;
}

describe('PUT /api/storage/upload', () => {
  it('rejects a tampered signature with 403', async () => {
    const { uploadUrl } = await mintUrl();
    const tampered = uploadUrl.replace(/sig=[^&]+/, 'sig=deadbeef');

    const response = await PUT(putRequest(tampered, new Uint8Array([1, 2, 3])));

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('rejects an expired signature with 403', async () => {
    const { uploadUrl } = await mintUrl({ expiresInSeconds: -60 });

    const response = await PUT(putRequest(uploadUrl, new Uint8Array([1, 2, 3])));

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a content type outside the allowlist with 422', async () => {
    const { uploadUrl } = await mintUrl({ contentType: 'image/gif' });

    const response = await PUT(putRequest(uploadUrl, new Uint8Array([1, 2, 3]), 'image/gif'));

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a file over the 5 MB cap with 422', async () => {
    const { uploadUrl } = await mintUrl();
    const tooLarge = new Uint8Array(MAX_EVIDENCE_BYTES + 1);

    const response = await PUT(putRequest(uploadUrl, tooLarge));

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toMatch(/5 MB/);
  });

  it('stores the upload on the happy path and returns key/contentType/sizeBytes', async () => {
    const { uploadUrl, key } = await mintUrl();
    const bytes = new Uint8Array([137, 80, 78, 71]); // arbitrary bytes — this route never inspects file contents

    const response = await PUT(putRequest(uploadUrl, bytes));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { key: string; contentType: string; sizeBytes: number };
    expect(body).toEqual({ key, contentType: 'image/png', sizeBytes: bytes.byteLength });
  });
});

describe('GET /api/storage/upload', () => {
  it('serves the stored blob back with the right Content-Type to the owning user', async () => {
    const { uploadUrl, key } = await mintUrl({ userId: USER_A });
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await PUT(putRequest(uploadUrl, bytes));

    currentSession = { userId: USER_A, email: 'a@parity.local' };
    const response = await GET(
      getRequest(`http://localhost:3000/api/storage/upload?key=${encodeURIComponent(key)}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it('denies a different user with 404, indistinguishable from a missing object', async () => {
    const { uploadUrl, key } = await mintUrl({ userId: USER_A });
    await PUT(putRequest(uploadUrl, new Uint8Array([1, 2, 3])));

    currentSession = { userId: USER_B, email: 'b@parity.local' };
    const response = await GET(
      getRequest(`http://localhost:3000/api/storage/upload?key=${encodeURIComponent(key)}`),
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 401 with no session at all', async () => {
    currentSession = null;
    const response = await GET(
      getRequest('http://localhost:3000/api/storage/upload?key=claims/claim-1/whatever'),
    );

    expect(response.status).toBe(401);
  });
});
