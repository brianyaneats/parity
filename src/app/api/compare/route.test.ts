import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { ComparisonResult } from '@/domain/engine/types';
import type { ErrorEnvelope } from '@/lib/api/errors';

/**
 * `POST /api/compare` contract tests — §5.2, §5.3.
 *
 * The session is stubbed because auth is not what is under test here; nothing
 * else is. §10.2: "Never mock the engine." The real `SavingsEngine` runs, so
 * these assert that the numbers reaching a client over HTTP are the same
 * numbers §3.8 publishes — which is the actual guarantee §5.3 asks for when it
 * says the client and server must share one implementation.
 */

vi.mock('@/lib/auth/session', () => ({
  requireUser: async () => ({ userId: 'user-1', email: 'demo@parity.local' }),
  getSession: async () => ({ userId: 'user-1', email: 'demo@parity.local' }),
}));

// The compare route now reads live bucket state server-side (§5.3). These are
// contract tests over a pure computation, so an in-memory repository reporting
// both semiannual credits live keeps them asserting §3.8's published figures
// without needing Postgres to do it.
//
// Mocked at the module boundary — the route imports
// `DrizzleCreditBucketRepository` (lazily, via dynamic `import()`, precisely
// so this module can be mocked without a database); vitest's module mock
// intercepts that resolution regardless of whether the importing side is
// static or dynamic, so the route never touches Postgres in this test.
vi.mock('@/infrastructure/persistence/repositories/DrizzleCreditBucketRepository', () => ({
  DrizzleCreditBucketRepository: class {
    async upsert(): Promise<never> {
      throw new Error('not used');
    }
    async listByUser() {
      return [
        {
          id: 'b-amex',
          userId: 'user-1',
          cardId: null,
          key: 'AMEX_HOTEL_H2',
          label: 'Amex hotel credit',
          faceCents: 30_000,
          window: { start: '2020-01-01', end: '2099-12-31' },
          consumedCents: 0,
        },
        {
          id: 'b-edit',
          userId: 'user-1',
          cardId: null,
          key: 'CSR_EDIT_H2',
          label: 'The Edit credit',
          faceCents: 25_000,
          window: { start: '2020-01-01', end: '2099-12-31' },
          consumedCents: 0,
        },
      ];
    }
    async findById() {
      return null;
    }
    async setConsumedCents() {
      return null;
    }
    async listForExpirySweep() {
      return [];
    }
  },
}));

const { POST } = await import('./route');

function request(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request('http://localhost:3000/api/compare', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const sharedContext = {
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

/** TC-01's quote set Q, verbatim from §3.8. */
const Q = [
  { channel: 'EDIT', totalCents: 354000, prepaid: true, refundable: true },
  { channel: 'FHR', totalCents: 360000, prepaid: true, refundable: true },
  { channel: 'DIRECT_PREPAID', totalCents: 317000, prepaid: true, refundable: false },
  { channel: 'DIRECT_FLEX', totalCents: 350000, prepaid: false, refundable: true },
  { channel: 'OTA', totalCents: 360000, prepaid: true, refundable: true },
  { channel: 'FORA', totalCents: 350000, prepaid: false, refundable: true },
];

beforeEach(() => {
  vi.stubEnv('LOG_LEVEL', 'error');
});

describe('POST /api/compare — the §3.8 numbers survive the HTTP boundary', () => {
  it('returns TC-01’s exact ranked order and effective-net values', async () => {
    const response = await POST(request({ context: sharedContext, quotes: Q }));
    expect(response.status).toBe(200);

    const body = (await response.json()) as ComparisonResult;

    expect(body.ranked.map((entry) => entry.result.channel)).toEqual([
      'EDIT',
      'FHR',
      'DIRECT_PREPAID',
      'FORA',
      'DIRECT_FLEX',
      'OTA',
    ]);
    expect(body.ranked.map((entry) => entry.result.effectiveNetCents)).toEqual([
      239_086, 272_000, 317_000, 325_500, 350_000, 356_400,
    ]);
  });

  it('carries the price-match assessment through unchanged', async () => {
    const response = await POST(request({ context: sharedContext, quotes: Q }));
    const body = (await response.json()) as ComparisonResult;

    const edit = body.results.find((result) => result.channel === 'EDIT');
    expect(edit?.priceMatch.qualifies).toBe(true);
    expect(edit?.priceMatch.perNightCents).toBe(4_982);
    expect(edit?.priceMatch.estimatedRefundCents).toBe(14_947);
  });

  it('never applies price-match logic to an Amex channel — TC-06 over HTTP', async () => {
    const response = await POST(
      request({
        context: { ...sharedContext, competitorBaseCents: 250_000 },
        quotes: [{ channel: 'FHR', totalCents: 360_000, prepaid: true, refundable: true }],
      }),
    );
    const body = (await response.json()) as ComparisonResult;

    expect(body.results[0]?.refundCents).toBe(0);
    expect(body.results[0]?.warnings).toContain('FHR_NO_PRICE_MATCH');
  });

  it('stamps the engine version so a persisted snapshot can record it', async () => {
    const response = await POST(request({ context: sharedContext, quotes: Q }));
    expect(((await response.json()) as ComparisonResult).engineVersion).toBe('1.0.0');
  });

  it('persists nothing — §5.2 says the route is stateless compute', async () => {
    const body = (await (
      await POST(request({ context: sharedContext, quotes: Q }))
    ).json()) as Record<string, unknown>;

    // A persisted row would come back with an id. This response is pure output.
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('comparisonId');
  });
});

describe('POST /api/compare — §5.1 conventions', () => {
  it('returns a request id in X-Request-Id', async () => {
    const response = await POST(request({ context: sharedContext, quotes: Q }));
    expect(response.headers.get('x-request-id')).toMatch(/[0-9a-f-]{8,}/);
  });

  it('echoes an upstream request id rather than minting a new one', async () => {
    const response = await POST(
      request({ context: sharedContext, quotes: Q }, { 'x-request-id': 'trace-123' }),
    );
    expect(response.headers.get('x-request-id')).toBe('trace-123');
  });

  it('never caches — the response is per-user and §12 treats it as sensitive', async () => {
    const response = await POST(request({ context: sharedContext, quotes: Q }));
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects an invalid payload with 422 and per-field messages', async () => {
    const response = await POST(
      request({ context: { ...sharedContext, nights: 0 }, quotes: Q }),
    );
    expect(response.status).toBe(422);

    const body = (await response.json()) as ErrorEnvelope;
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.fields?.['context.nights']).toMatch(/at least 1/);
    expect(body.error.requestId).toBeTruthy();
  });

  it('rejects a malformed JSON body as 422, not 500', async () => {
    const malformed = new Request('http://localhost:3000/api/compare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    }) as unknown as NextRequest;

    const response = await POST(malformed);
    expect(response.status).toBe(422);
    expect(((await response.json()) as ErrorEnvelope).error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a fractional cent — money is integers only', async () => {
    const response = await POST(
      request({
        context: sharedContext,
        quotes: [{ channel: 'EDIT', totalCents: 354_000.5, prepaid: true, refundable: true }],
      }),
    );
    expect(response.status).toBe(422);
  });

  it('rejects an unknown channel', async () => {
    const response = await POST(
      request({
        context: sharedContext,
        quotes: [{ channel: 'MYSTERY', totalCents: 1000, prepaid: true, refundable: true }],
      }),
    );
    expect(response.status).toBe(422);
  });

  it('leaks no stack trace on a failure', async () => {
    const response = await POST(request({ context: { nights: 'three' }, quotes: [] }));
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain('stack');
    expect(body).not.toContain('at Object.');
  });
});

/**
 * §5.3: "must be pure and fast (p95 < 100 ms) — it is called on every keystroke
 * behind a 250 ms debounce." DECISIONS.md D-043 makes that budget a gate rather
 * than an aspiration.
 */
describe('POST /api/compare — the §5.3 latency budget', () => {
  it('holds p95 under 100 ms across the fixture set', async () => {
    const samples: number[] = [];

    for (let i = 0; i < 40; i += 1) {
      const started = performance.now();
      await POST(request({ context: sharedContext, quotes: Q }));
      samples.push(performance.now() - started);
    }

    samples.sort((a, b) => a - b);
    const p95 = samples[Math.min(samples.length - 1, Math.ceil(0.95 * samples.length) - 1)] ?? 0;

    expect(p95).toBeLessThan(100);
  });

  it('is deterministic across repeated calls — the winner never flips', async () => {
    // §3.4: "the same input always produces the same order, because the user
    // will notice if the winner flips between page loads."
    const first = (await (
      await POST(request({ context: sharedContext, quotes: Q }))
    ).json()) as ComparisonResult;
    const second = (await (
      await POST(request({ context: sharedContext, quotes: Q }))
    ).json()) as ComparisonResult;

    expect(JSON.stringify(second.ranked)).toBe(JSON.stringify(first.ranked));
  });
});
