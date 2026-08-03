import { route, readJson } from '@/lib/api/handler';
import { magicLinkSchema } from '@/lib/validation/auth';
import { dependencies, executionContext } from '@/application/runtime';
import { createNotifier } from '@/infrastructure/notifications/createNotifier';
import { DrizzleAuthRepository } from '@/infrastructure/persistence/repositories/DrizzleAuthRepository';
import { DrizzleEmailBudgetRepository } from '@/infrastructure/persistence/repositories/DrizzleEmailBudgetRepository';
import { DEFAULT_GLOBAL_DAILY_EMAIL_LIMIT } from '@/application/ports/EmailBudgetRepository';
import { RequestMagicLinkUseCase } from '@/application/usecases/RequestMagicLinkUseCase';

/**
 * `POST /api/auth/magic-link` — §5.2.
 *
 * The second deliberate exception to §5.1's "auth on every route except
 * `/api/health`" (the cron routes, gated by `CRON_SECRET` instead, are the
 * first): a route whose entire purpose is letting a signed-out visitor start
 * signing in cannot itself require a session — `requireUser()` would make
 * sign-in impossible. `src/features/auth/LoginForm.tsx` already calls this
 * exact path with `{ email }`.
 */
const authRepository = new DrizzleAuthRepository();
const emailBudgetRepository = new DrizzleEmailBudgetRepository();

/**
 * `EMAIL_DAILY_BUDGET` overrides `DEFAULT_GLOBAL_DAILY_EMAIL_LIMIT` (see
 * `EmailBudgetRepository.ts`) — unset, non-numeric, zero, or negative all
 * fall back to the documented default rather than disabling the budget.
 */
function resolveGlobalDailyLimit(): number {
  const raw = process.env.EMAIL_DAILY_BUDGET;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GLOBAL_DAILY_EMAIL_LIMIT;
}

export const POST = route(
  async ({ request, logger, requestId }) => {
    const payload = magicLinkSchema.parse(await readJson(request));
    const notifier = createNotifier(logger);

    const useCase = new RequestMagicLinkUseCase(
      dependencies(logger),
      authRepository,
      notifier,
      emailBudgetRepository,
      resolveGlobalDailyLimit(),
    );
    await useCase.execute(payload, executionContext('anonymous', requestId));

    // §5.2: identical response whether or not the account exists, whether or
    // not the send budget allowed a real send.
    return { ok: true };
  },
  { name: 'POST /api/auth/magic-link' },
);
