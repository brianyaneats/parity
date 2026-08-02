import { InvalidTransitionError, InvariantViolationError } from '@/domain/shared/DomainError';
import { ApiError } from '@/lib/api/errors';

/**
 * Translates a thrown domain error into the right HTTP-shaped `ApiError`.
 *
 * `src/lib/api/errors.ts` (out of scope to change for this task) maps *every*
 * `DomainError` to a generic 500 — reasonable as a safety net for a truly
 * unexpected invariant break, but wrong for the common case in this build: a
 * client asked for a transition the aggregate's own state machine forbids
 * (§7.4's "an expired claim can only go to EXPIRED or NOT_PURSUED"), which is
 * a 409, not a server failure, and a caller that requires `awardedCents` on
 * approval and didn't get it, which is a 422. Use cases that call an
 * aggregate method able to throw one of these should wrap the call:
 *
 * ```ts
 * try {
 *   claim.transitionTo(next, now, details);
 * } catch (error) {
 *   translateDomainError(error);
 * }
 * ```
 *
 * Anything else is rethrown unchanged and falls through to `errors.ts`'s
 * default 500 handling, which is correct for a genuine bug.
 */
export function translateDomainError(error: unknown): never {
  if (error instanceof InvalidTransitionError) {
    throw ApiError.conflict(error.message);
  }
  if (error instanceof InvariantViolationError) {
    throw ApiError.validation(error.message);
  }
  throw error;
}
