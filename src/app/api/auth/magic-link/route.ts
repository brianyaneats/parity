import { route, readJson } from '@/lib/api/handler';
import { magicLinkSchema } from '@/lib/validation/auth';
import { dependencies, executionContext } from '@/application/runtime';
import { createNotifier } from '@/infrastructure/notifications/createNotifier';
import { DrizzleAuthRepository } from '@/infrastructure/persistence/repositories/DrizzleAuthRepository';
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

export const POST = route(
  async ({ request, logger, requestId }) => {
    const payload = magicLinkSchema.parse(await readJson(request));
    const notifier = createNotifier(logger);

    const useCase = new RequestMagicLinkUseCase(dependencies(logger), authRepository, notifier);
    await useCase.execute(payload, executionContext('anonymous', requestId));

    // §5.2: identical response whether or not the account exists.
    return { ok: true };
  },
  { name: 'POST /api/auth/magic-link' },
);
