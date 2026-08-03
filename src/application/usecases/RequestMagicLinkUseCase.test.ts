import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RequestMagicLinkUseCase, MIN_RESPONSE_FLOOR_MS } from './RequestMagicLinkUseCase';
import { InMemoryAuthRepository, InMemoryEmailBudgetRepository, FakeNotifier } from '../testing/fakes';
import {
  RECIPIENT_DAILY_EMAIL_LIMIT,
  RECIPIENT_EMAIL_COOLDOWN_MS,
  DEFAULT_GLOBAL_DAILY_EMAIL_LIMIT,
} from '@/application/ports/EmailBudgetRepository';
import { MemoryLogger } from '@/infrastructure/observability/Logger';
import { MetricsRegistry } from '@/infrastructure/observability/MetricsRegistry';
import { FixedClock } from '@/domain/shared/Clock';
import type { ExecutionContext, UseCaseDependencies } from '../shared/UseCase';
import type { Notifier } from '@/application/ports/Notifier';

/**
 * `RequestMagicLinkUseCase` — covers three security-audit fixes together,
 * since all three live in this one class:
 *
 * 1. **BLOCKING #1** — the durable per-recipient + global email send budget
 *    (`EmailBudgetRepository`), which closes the gap where the per-IP rate
 *    limiter alone let one caller, staying entirely within its own budget,
 *    exhaust Resend's entire 100/day free-tier quota against one known
 *    address and lock every user out of sign-in for the rest of the day.
 * 2. **Advisory #1** — the response-time floor (`MIN_RESPONSE_FLOOR_MS`),
 *    which stops a known address from taking measurably longer than an
 *    unknown one (a real DB write + Resend call vs. a log line), the timing
 *    side-channel an attacker could use to enumerate registered addresses.
 * 3. **Advisory #8** — `AUTH_URL` fail-closed in production, so a missing
 *    config value produces a loud server-side error instead of a magic-link
 *    email that silently points at `localhost`.
 *
 * All three deliberately share one test file rather than three: they
 * interact (e.g. the AUTH_URL check must run — and fail closed — *before*
 * any budget is spent; the floor must pad every path, including a blocked
 * one), and a real regression here is more likely to be in that interaction
 * than in any one fix alone.
 */

const KNOWN_EMAIL = 'known@parity.local';
const KNOWN_USER = { id: 'user-1', email: KNOWN_EMAIL };

function deps(): UseCaseDependencies & { logger: MemoryLogger } {
  return {
    logger: new MemoryLogger(),
    metrics: new MetricsRegistry({ now: () => 0 }),
    clock: new FixedClock('2026-08-02T12:00:00Z'),
  };
}

function ctx(now: string, requestId = 'req-1'): ExecutionContext {
  return { userId: 'anonymous', requestId, now: new Date(now) };
}

/** A `sleep` spy that resolves immediately regardless of the requested delay, so tests stay fast. */
function fakeSleep() {
  const calls: number[] = [];
  const sleep = async (ms: number) => {
    calls.push(ms);
  };
  return { sleep, calls };
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('unknown address — no send, budget untouched', () => {
  it('logs and returns without sending, creating a token, or spending any budget', async () => {
    const auth = new InMemoryAuthRepository([KNOWN_USER]);
    const notifier = new FakeNotifier();
    const budget = new InMemoryEmailBudgetRepository();
    const { sleep } = fakeSleep();
    const useCase = new RequestMagicLinkUseCase(
      deps(),
      auth,
      notifier,
      budget,
      DEFAULT_GLOBAL_DAILY_EMAIL_LIMIT,
      sleep,
    );

    await useCase.execute({ email: 'nobody@parity.local' }, ctx('2026-08-02T12:00:00Z'));

    expect(notifier.sent).toHaveLength(0);
    expect(auth.createdTokens).toHaveLength(0);
    expect(budget.globalCount('2026-08-02')).toBe(0);
  });
});

describe('known address — first send of the day', () => {
  it('creates a token, sends once, and charges both budgets by one', async () => {
    const auth = new InMemoryAuthRepository([KNOWN_USER]);
    const notifier = new FakeNotifier();
    const budget = new InMemoryEmailBudgetRepository();
    const { sleep } = fakeSleep();
    const useCase = new RequestMagicLinkUseCase(
      deps(),
      auth,
      notifier,
      budget,
      DEFAULT_GLOBAL_DAILY_EMAIL_LIMIT,
      sleep,
    );

    await useCase.execute({ email: KNOWN_EMAIL }, ctx('2026-08-02T12:00:00Z'));

    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]?.to).toBe(KNOWN_EMAIL);
    expect(auth.createdTokens).toHaveLength(1);
    expect(budget.recipientCount(KNOWN_EMAIL, '2026-08-02')).toBe(1);
    expect(budget.globalCount('2026-08-02')).toBe(1);
  });
});

describe('per-recipient daily cap', () => {
  it(`allows exactly ${RECIPIENT_DAILY_EMAIL_LIMIT} sends to one address per UTC day, then suppresses the next`, async () => {
    const auth = new InMemoryAuthRepository([KNOWN_USER]);
    const notifier = new FakeNotifier();
    const budget = new InMemoryEmailBudgetRepository();
    const logger = new MemoryLogger();
    const { sleep } = fakeSleep();
    const useCase = new RequestMagicLinkUseCase(
      { ...deps(), logger },
      auth,
      notifier,
      budget,
      DEFAULT_GLOBAL_DAILY_EMAIL_LIMIT,
      sleep,
    );

    // Spaced well past the cooldown so only the daily cap is under test.
    const cooldownMs = RECIPIENT_EMAIL_COOLDOWN_MS + 1_000;
    const start = new Date('2026-08-02T00:00:00Z').getTime();

    for (let i = 0; i < RECIPIENT_DAILY_EMAIL_LIMIT; i += 1) {
      await useCase.execute({ email: KNOWN_EMAIL }, ctx(new Date(start + i * cooldownMs).toISOString()));
    }
    expect(notifier.sent).toHaveLength(RECIPIENT_DAILY_EMAIL_LIMIT);

    const blockedAt = new Date(start + RECIPIENT_DAILY_EMAIL_LIMIT * cooldownMs).toISOString();
    await useCase.execute({ email: KNOWN_EMAIL }, ctx(blockedAt));

    expect(notifier.sent).toHaveLength(RECIPIENT_DAILY_EMAIL_LIMIT); // unchanged
    expect(auth.createdTokens).toHaveLength(RECIPIENT_DAILY_EMAIL_LIMIT); // unchanged — no token for the blocked attempt
    expect(logger.records.some((r) => r.level === 'warn' && /email send budget/.test(r.message))).toBe(true);
  });
});

describe('per-recipient cooldown', () => {
  it('suppresses a second send inside the cooldown window even though the daily cap is not reached', async () => {
    const auth = new InMemoryAuthRepository([KNOWN_USER]);
    const notifier = new FakeNotifier();
    const budget = new InMemoryEmailBudgetRepository();
    const { sleep } = fakeSleep();
    const useCase = new RequestMagicLinkUseCase(
      deps(),
      auth,
      notifier,
      budget,
      DEFAULT_GLOBAL_DAILY_EMAIL_LIMIT,
      sleep,
    );

    await useCase.execute({ email: KNOWN_EMAIL }, ctx('2026-08-02T12:00:00.000Z'));
    expect(notifier.sent).toHaveLength(1);

    // One millisecond inside the cooldown window.
    const stillCoolingDown = new Date(
      new Date('2026-08-02T12:00:00.000Z').getTime() + RECIPIENT_EMAIL_COOLDOWN_MS - 1,
    ).toISOString();
    await useCase.execute({ email: KNOWN_EMAIL }, ctx(stillCoolingDown));
    expect(notifier.sent).toHaveLength(1); // still just the first

    // Exactly at the cooldown boundary — allowed again (repository uses `<=`).
    const cooldownElapsed = new Date(
      new Date('2026-08-02T12:00:00.000Z').getTime() + RECIPIENT_EMAIL_COOLDOWN_MS,
    ).toISOString();
    await useCase.execute({ email: KNOWN_EMAIL }, ctx(cooldownElapsed));
    expect(notifier.sent).toHaveLength(2);
  });
});

describe('global daily cap', () => {
  it('blocks a send once the global ceiling is reached, even for a recipient with budget left', async () => {
    const users = [
      { id: 'user-a', email: 'a@parity.local' },
      { id: 'user-b', email: 'b@parity.local' },
      { id: 'user-c', email: 'c@parity.local' },
    ];
    const auth = new InMemoryAuthRepository(users);
    const notifier = new FakeNotifier();
    const budget = new InMemoryEmailBudgetRepository();
    const logger = new MemoryLogger();
    const { sleep } = fakeSleep();
    const smallGlobalLimit = 2;
    const useCase = new RequestMagicLinkUseCase({ ...deps(), logger }, auth, notifier, budget, smallGlobalLimit, sleep);

    await useCase.execute({ email: 'a@parity.local' }, ctx('2026-08-02T01:00:00Z'));
    await useCase.execute({ email: 'b@parity.local' }, ctx('2026-08-02T02:00:00Z'));
    expect(notifier.sent).toHaveLength(2); // global budget now exhausted for the day

    // A third, entirely different recipient — well under its own per-recipient
    // budget — is still blocked, because the global ceiling is what's hit.
    await useCase.execute({ email: 'c@parity.local' }, ctx('2026-08-02T03:00:00Z'));

    expect(notifier.sent).toHaveLength(2);
    expect(budget.recipientCount('c@parity.local', '2026-08-02')).toBe(0); // never charged for a send that didn't happen
    expect(
      logger.records.some(
        (r) => r.level === 'warn' && r.fields.reason === 'GLOBAL_LIMIT',
      ),
    ).toBe(true);
  });
});

describe('AUTH_URL fail-closed in production', () => {
  it('refuses to send and logs an error when AUTH_URL is unset in production — and spends no budget', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_URL', '');

    const auth = new InMemoryAuthRepository([KNOWN_USER]);
    const notifier = new FakeNotifier();
    const budget = new InMemoryEmailBudgetRepository();
    const logger = new MemoryLogger();
    const { sleep } = fakeSleep();
    const useCase = new RequestMagicLinkUseCase(
      { ...deps(), logger },
      auth,
      notifier,
      budget,
      DEFAULT_GLOBAL_DAILY_EMAIL_LIMIT,
      sleep,
    );

    await useCase.execute({ email: KNOWN_EMAIL }, ctx('2026-08-02T12:00:00Z'));

    expect(notifier.sent).toHaveLength(0);
    expect(auth.createdTokens).toHaveLength(0);
    expect(budget.globalCount('2026-08-02')).toBe(0); // the AUTH_URL check runs before the budget is touched
    expect(logger.records.some((r) => r.level === 'error' && /AUTH_URL/.test(r.message))).toBe(true);
  });

  it('sends normally, using the configured AUTH_URL for the link, when it is set in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_URL', 'https://parity.example.com');

    const auth = new InMemoryAuthRepository([KNOWN_USER]);
    const notifier = new FakeNotifier();
    const budget = new InMemoryEmailBudgetRepository();
    const { sleep } = fakeSleep();
    const useCase = new RequestMagicLinkUseCase(
      deps(),
      auth,
      notifier,
      budget,
      DEFAULT_GLOBAL_DAILY_EMAIL_LIMIT,
      sleep,
    );

    await useCase.execute({ email: KNOWN_EMAIL }, ctx('2026-08-02T12:00:00Z'));

    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]?.text).toContain('https://parity.example.com/api/auth/callback');
  });

  it('falls back to localhost outside production so a clean clone still runs with no AUTH_URL set', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AUTH_URL', '');

    const auth = new InMemoryAuthRepository([KNOWN_USER]);
    const notifier = new FakeNotifier();
    const budget = new InMemoryEmailBudgetRepository();
    const { sleep } = fakeSleep();
    const useCase = new RequestMagicLinkUseCase(
      deps(),
      auth,
      notifier,
      budget,
      DEFAULT_GLOBAL_DAILY_EMAIL_LIMIT,
      sleep,
    );

    await useCase.execute({ email: KNOWN_EMAIL }, ctx('2026-08-02T12:00:00Z'));

    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]?.text).toContain('http://localhost:3000/api/auth/callback');
  });
});

describe('response-time floor — anti-enumeration padding', () => {
  it('pads a fast "unknown address" response up toward the floor', async () => {
    const auth = new InMemoryAuthRepository([KNOWN_USER]);
    const notifier = new FakeNotifier();
    const budget = new InMemoryEmailBudgetRepository();
    const { sleep, calls } = fakeSleep();
    const useCase = new RequestMagicLinkUseCase(
      deps(),
      auth,
      notifier,
      budget,
      DEFAULT_GLOBAL_DAILY_EMAIL_LIMIT,
      sleep,
    );

    await useCase.execute({ email: 'nobody@parity.local' }, ctx('2026-08-02T12:00:00Z'));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeGreaterThan(0);
    expect(calls[0]).toBeLessThanOrEqual(MIN_RESPONSE_FLOOR_MS);
  });

  it('pads a fast "budget blocked" response up toward the floor too', async () => {
    const auth = new InMemoryAuthRepository([KNOWN_USER]);
    const notifier = new FakeNotifier();
    const budget = new InMemoryEmailBudgetRepository();
    const { sleep, calls } = fakeSleep();
    // A ceiling of 0 blocks the very first attempt.
    const useCase = new RequestMagicLinkUseCase(deps(), auth, notifier, budget, 0, sleep);

    await useCase.execute({ email: KNOWN_EMAIL }, ctx('2026-08-02T12:00:00Z'));

    expect(notifier.sent).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeGreaterThan(0);
    expect(calls[0]).toBeLessThanOrEqual(MIN_RESPONSE_FLOOR_MS);
  });

  it('does not pad further when a real send already took at least the floor', async () => {
    const auth = new InMemoryAuthRepository([KNOWN_USER]);
    const budget = new InMemoryEmailBudgetRepository();
    const { sleep, calls } = fakeSleep();

    // A deliberately slow notifier — a real `await` past the floor, standing
    // in for a slow Resend response. One genuine wait, real time, in the
    // whole suite; kept just past the floor rather than large.
    const slowNotifier: Notifier = {
      send: async (message) => {
        await new Promise((resolve) => setTimeout(resolve, MIN_RESPONSE_FLOOR_MS + 50));
        void message;
        return { sent: true, deduped: false };
      },
    };

    const useCase = new RequestMagicLinkUseCase(
      deps(),
      auth,
      slowNotifier,
      budget,
      DEFAULT_GLOBAL_DAILY_EMAIL_LIMIT,
      sleep,
    );

    await useCase.execute({ email: KNOWN_EMAIL }, ctx('2026-08-02T12:00:00Z'));

    // Already at/over the floor — `handle()`'s `finally` block only calls
    // `sleep` when `remainingMs > 0`.
    expect(calls).toHaveLength(0);
  });
});
