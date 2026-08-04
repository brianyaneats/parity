import { randomUUID } from 'node:crypto';
import type { Logger } from '@/infrastructure/observability/Logger';
import { digestToken } from '@/lib/auth/tokenDigest';
import type { MagicLinkInput } from '@/lib/validation/auth';
import type { AuthRepository } from '@/application/ports/AuthRepository';
import type { Notifier } from '@/application/ports/Notifier';
import {
  DEFAULT_GLOBAL_DAILY_EMAIL_LIMIT,
  type EmailBudgetRepository,
} from '@/application/ports/EmailBudgetRepository';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

/**
 * Floor for how long `POST /api/auth/magic-link` takes to respond,
 * regardless of which internal path it takes.
 *
 * Security-audit finding (Advisory #1, closed by this change): the route
 * already responds with the identical `{ ok: true }` body whether or not the
 * address is registered — but a known address used to take measurably
 * longer, because that path alone did a real DB insert and a real outbound
 * call to Resend, while an unknown address just logged and returned. An
 * HTTPS round trip to a third-party API is not "indistinguishable from
 * jitter"; it's a reliable, repeatable delay an attacker can average over
 * many requests to learn which addresses are registered — exactly the
 * account-enumeration signal §5.2/§12 say this route must not leak, and
 * (see `EmailBudgetRepository.ts`) the mechanism that would let an attacker
 * locate a target for the email-bombing fix below.
 *
 * The fix pads every path — unknown address, budget-blocked, misconfigured
 * `AUTH_URL`, and a real send — up to this floor before returning, via
 * `finally` in `handle()` below. A path that is naturally slower than the
 * floor (a slow Resend response) is left alone; only the fast paths are
 * brought up to match, which is what removes the *systematic, every-request*
 * gap without capping genuine latency.
 *
 * 200ms rather than something closer to a typical real send's full latency:
 * big enough to swallow the DB-write-plus-log-line-only fast paths (single
 * digit milliseconds) many times over, small enough that this route's own
 * test suite — which drives `POST /api/auth/magic-link` for real, dozens of
 * times, to exercise the per-IP rate limiter — doesn't turn into a multi-
 * second test file for a security property that source-level tests already
 * pin directly (see `RequestMagicLinkUseCase.test.ts`).
 */
export const MIN_RESPONSE_FLOOR_MS = 200;

export type Sleep = (ms: number) => Promise<void>;

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * `POST /api/auth/magic-link` — §5.2.
 *
 * The second deliberate exception to §5.1's "auth on every route except
 * `/api/health`" (the cron routes, gated by `CRON_SECRET` instead, are the
 * first): a route whose entire purpose is letting a signed-out visitor start
 * signing in cannot itself require a session — `requireUser()` would make
 * sign-in impossible. `src/features/auth/LoginForm.tsx` already calls this
 * exact path with `{ email }`.
 *
 * "It must respond identically whether or not the account exists, to avoid
 * account enumeration." This build resolves that a stronger way than hiding
 * the difference: it removes the difference. An unknown address is signed
 * up on the spot (`findOrCreateUserByEmail`) and gets the same link a known
 * one gets — magic-link auth means an email address *is* an account, so
 * there is no separate registration flow, no "no such user" branch to
 * disguise, and nothing for a prober to learn. The HTTP response is
 * identical either way; see `MIN_RESPONSE_FLOOR_MS` above for how the
 * *timing* stays uniform too (creation is a fast local insert, well under
 * the floor).
 *
 * **Durable send budget (security-audit BLOCKING #1).** `enforceIpRateLimit`
 * in `route()` bounds one caller's request *rate*; it does not bound the
 * *shared* resource those requests spend — Resend's 100-email/day free-tier
 * cap for the whole deployment. `emailBudget.reserveSend` closes that: a
 * real send only happens once both the per-recipient and the global daily
 * budget allow it (see `EmailBudgetRepository.ts` for the full reasoning).
 * A blocked attempt still returns exactly as if the email had been sent —
 * `{ ok: true }` at the route, and no distinguishing detail here either —
 * because the caller must never be able to use this endpoint's *response* to
 * probe whether a budget is close to exhausted; the operator finds out from
 * the warn-level log line instead.
 */
export class RequestMagicLinkUseCase extends CommandUseCase<MagicLinkInput, void> {
  public readonly name = 'request_magic_link';

  constructor(
    deps: UseCaseDependencies,
    private readonly auth: AuthRepository,
    private readonly notifier: Notifier,
    private readonly emailBudget: EmailBudgetRepository,
    private readonly globalDailyLimit: number = DEFAULT_GLOBAL_DAILY_EMAIL_LIMIT,
    private readonly sleep: Sleep = realSleep,
  ) {
    super(deps);
  }

  protected async handle(input: MagicLinkInput, ctx: ExecutionContext, logger: Logger): Promise<void> {
    const startedAt = performance.now();
    try {
      await this.attemptSend(input, ctx, logger);
    } finally {
      const elapsedMs = performance.now() - startedAt;
      const remainingMs = MIN_RESPONSE_FLOOR_MS - elapsedMs;
      if (remainingMs > 0) await this.sleep(remainingMs);
    }
  }

  private async attemptSend(input: MagicLinkInput, ctx: ExecutionContext, logger: Logger): Promise<void> {
    // Fail closed rather than emailing a link that resolves to nothing.
    // Outside production this still falls back to localhost — see
    // `RequestMagicLinkUseCase.test.ts` and `.env.example` — so a clean
    // clone with no `AUTH_URL` configured yet still runs (§0.4).
    const authUrl = process.env.AUTH_URL;
    if (!authUrl && process.env.NODE_ENV === 'production') {
      logger.error(
        'AUTH_URL is not set in production — refusing to send a magic link that would point at localhost.',
      );
      return;
    }
    const baseUrl = authUrl || 'http://localhost:3000';

    // The budget check comes *before* account creation so a bombing attempt
    // can't mass-manufacture user rows either: past three requests a day per
    // address, nothing below this line runs.
    const decision = await this.emailBudget.reserveSend(input.email, ctx.now, this.globalDailyLimit);
    if (!decision.allowed) {
      // Never surfaced to the caller — see the class doc comment. This is
      // the one place an operator can see the budget was actually hit.
      logger.warn('magic link suppressed by the email send budget', {
        reason: decision.reason,
      });
      return;
    }

    // Sign-up *is* this line. An unknown address gets a user row and then the
    // exact same link a known one gets — there is no separate registration
    // flow to build, and (with the response floor above) no observable
    // difference between "your first visit" and "your fiftieth" for an
    // attacker probing which addresses already have accounts.
    const user = await this.auth.findOrCreateUserByEmail(input.email);

    const token = randomUUID();
    const tokenDigest = digestToken(token);
    const expires = new Date(ctx.now.getTime() + MAGIC_LINK_TTL_MS);
    // Digest at rest: the raw token exists only inside the emailed link. A
    // read of `verification_tokens` (or of these logs) yields nothing a
    // browser can sign in with.
    await this.auth.createVerificationToken(input.email, tokenDigest, expires);

    const link = `${baseUrl}/api/auth/callback?${new URLSearchParams({ email: input.email, token }).toString()}`;

    await this.notifier.send({
      to: input.email,
      subject: 'Sign in to Parity',
      text:
        `Sign in: ${link}\n\n` +
        'This link works once and expires in 15 minutes. If you did not request it, ignore this email.',
      // A digest prefix, never the raw token: `LoggingNotifier` prints this
      // key verbatim whenever RESEND_API_KEY is unset, and an idempotency key
      // only needs to be unique per message, not reversible.
      idempotencyKey: `magic-link:${input.email}:${tokenDigest.slice(0, 16)}`,
    });

    logger.info('magic link issued', { userId: user.id });
  }

  protected override describeInput(_input: MagicLinkInput) {
    // §12 redacts the `email` key regardless (see `Logger.ts`'s `REDACTED_KEYS`),
    // so nothing is opted into here at all.
    return {};
  }
}
