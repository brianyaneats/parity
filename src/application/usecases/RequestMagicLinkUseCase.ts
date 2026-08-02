import { randomUUID } from 'node:crypto';
import type { Logger } from '@/infrastructure/observability/Logger';
import type { MagicLinkInput } from '@/lib/validation/auth';
import type { AuthRepository } from '@/application/ports/AuthRepository';
import type { Notifier } from '@/application/ports/Notifier';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

/**
 * `POST /api/auth/magic-link` — §5.2.
 *
 * "It must respond identically whether or not the account exists, to avoid
 * account enumeration." `LoginForm.tsx`'s own copy already says the quiet
 * part out loud — "If an account exists for {email}, a sign-in link is on its
 * way" — so an unknown address takes the *same code path length* here (this
 * use case still runs, still returns `void`, still logs one line) but simply
 * never reaches `notifier.send`. What differs between the two cases is
 * invisible outside this process: no email is dispatched, but the HTTP
 * response the caller sees is identical either way, and there is no
 * observable timing signal deliberately introduced here beyond one extra
 * `Notifier.send` call, which is not on the response's critical path in any
 * way a client could reliably distinguish from network jitter.
 */
export class RequestMagicLinkUseCase extends CommandUseCase<MagicLinkInput, void> {
  public readonly name = 'request_magic_link';

  constructor(
    deps: UseCaseDependencies,
    private readonly auth: AuthRepository,
    private readonly notifier: Notifier,
  ) {
    super(deps);
  }

  protected async handle(input: MagicLinkInput, ctx: ExecutionContext, logger: Logger): Promise<void> {
    const user = await this.auth.findUserByEmail(input.email);
    if (!user) {
      logger.info('magic link requested for an unrecognised address — no email sent');
      return;
    }

    const token = randomUUID();
    const expires = new Date(ctx.now.getTime() + MAGIC_LINK_TTL_MS);
    await this.auth.createVerificationToken(input.email, token, expires);

    const baseUrl = process.env.AUTH_URL || 'http://localhost:3000';
    const link = `${baseUrl}/api/auth/callback?${new URLSearchParams({ email: input.email, token }).toString()}`;

    await this.notifier.send({
      to: input.email,
      subject: 'Sign in to Parity',
      text:
        `Sign in: ${link}\n\n` +
        'This link works once and expires in 15 minutes. If you did not request it, ignore this email.',
      idempotencyKey: `magic-link:${input.email}:${token}`,
    });

    logger.info('magic link issued', { userId: user.id });
  }

  protected override describeInput(_input: MagicLinkInput) {
    // §12 redacts the `email` key regardless (see `Logger.ts`'s `REDACTED_KEYS`),
    // so nothing is opted into here at all.
    return {};
  }
}
