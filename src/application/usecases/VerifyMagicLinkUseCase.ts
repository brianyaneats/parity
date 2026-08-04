import { ApiError } from '@/lib/api/errors';
import { digestToken } from '@/lib/auth/tokenDigest';
import type { AuthRepository } from '@/application/ports/AuthRepository';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

export interface VerifyMagicLinkInput {
  readonly email: string;
  readonly token: string;
}

export interface VerifyMagicLinkOutput {
  readonly userId: string;
  readonly email: string;
}

/**
 * The other half of magic-link sign-in — consumed by `GET /api/auth/callback`
 * (this build's own addition; not in §5.2's table, but the link
 * `RequestMagicLinkUseCase` emails has to resolve to *something*, and there
 * is no other route in this app that can complete a sign-in). A generic
 * "invalid or expired" message either way — never reveals which.
 */
export class VerifyMagicLinkUseCase extends CommandUseCase<VerifyMagicLinkInput, VerifyMagicLinkOutput> {
  public readonly name = 'verify_magic_link';

  constructor(deps: UseCaseDependencies, private readonly auth: AuthRepository) {
    super(deps);
  }

  protected async handle(input: VerifyMagicLinkInput, ctx: ExecutionContext): Promise<VerifyMagicLinkOutput> {
    // The link carries the raw token; the table stores its digest — so the
    // lookup digests first. See `tokenDigest.ts` for why plain SHA-256 is
    // the right strength here.
    const valid = await this.auth.consumeVerificationToken(input.email, digestToken(input.token), ctx.now);
    if (!valid) throw ApiError.unauthorized('This sign-in link is invalid or has expired.');

    const user = await this.auth.findUserByEmail(input.email);
    if (!user) throw ApiError.unauthorized('This sign-in link is invalid or has expired.');

    return { userId: user.id, email: user.email };
  }
}
