import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `GET /api/health` — the one unauthenticated, public-by-definition route.
 * Pins the fix for the DB-failure path: the driver's raw `error.message`
 * (which can carry hostname/username/connection detail) must never reach the
 * public JSON body, only a fixed generic string. The full detail still goes
 * to the server-side log — asserted separately below.
 */

vi.mock('@/infrastructure/persistence/db', () => ({
  checkDatabase: vi.fn(),
}));

beforeEach(() => {
  vi.stubEnv('LOG_LEVEL', 'error');
});

describe('GET /api/health — database failure does not leak the raw driver error', () => {
  it('returns a fixed generic message, not the driver error, in the public body', async () => {
    const { checkDatabase } = await import('@/infrastructure/persistence/db');
    vi.mocked(checkDatabase).mockRejectedValueOnce(
      new Error('password authentication failed for user "parity" at host db.internal.example.com'),
    );

    const { GET } = await import('./route');
    const response = await GET();
    const body = (await response.json()) as {
      status: string;
      checks: { database: { ok: boolean; latencyMs: number | null; error?: string } };
    };

    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks.database.ok).toBe(false);
    expect(body.checks.database.error).toBe('database unreachable');
    expect(body.checks.database.error).not.toMatch(/password|user|host|internal/i);
  });

  it('logs the real error server-side even though the public body is generic', async () => {
    // `createLogger()` returns a fresh `JsonLogger` per call (see
    // `Logger.ts`), so spying on one instance can't observe the route's own
    // internal logger — but every `JsonLogger` at `error` level writes
    // through `console.error` by default (`defaultSink`), which is the
    // stable seam to assert against here.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { checkDatabase } = await import('@/infrastructure/persistence/db');
    const realError = new Error('connection terminated unexpectedly at db.internal.example.com');
    vi.mocked(checkDatabase).mockRejectedValueOnce(realError);

    const { GET } = await import('./route');
    await GET();

    expect(consoleErrorSpy).toHaveBeenCalled();
    const loggedLine = consoleErrorSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(loggedLine).toContain('connection terminated unexpectedly');
    expect(loggedLine).toContain('database unreachable');

    consoleErrorSpy.mockRestore();
  });

  it('succeeds normally (200, no error field) when the database is reachable', async () => {
    const { checkDatabase } = await import('@/infrastructure/persistence/db');
    vi.mocked(checkDatabase).mockResolvedValueOnce(5);

    const { GET } = await import('./route');
    const response = await GET();
    const body = (await response.json()) as {
      status: string;
      checks: { database: { ok: boolean; latencyMs: number | null; error?: string } };
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.checks.database).toEqual({ ok: true, latencyMs: 5 });
  });
});
