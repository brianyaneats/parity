import { route, readJson } from '@/lib/api/handler';
import { requireUser } from '@/lib/auth/session';
import { ApiError } from '@/lib/api/errors';
import { z } from 'zod';

/**
 * `DELETE /api/account` — §12.
 *
 * "Data export and deletion must both work from `/settings` and must actually
 * cascade."
 *
 * Two safeguards, because this is the one irreversible action in the product:
 *
 * 1. **Typed confirmation.** The body must carry the account's own email
 *    address. A `DELETE` that fires on a stray click, or on a CSRF attempt that
 *    can guess a URL but not the user's address, destroys a year of records
 *    that exist precisely because §1.5 promises they will survive an audit.
 * 2. **Screenshot keys are returned.** They live in object storage, outside the
 *    database cascade. §12 requires them deleted too, so the receipt names them
 *    rather than letting them become orphaned-but-readable images of the user's
 *    booking pages.
 */
export const dynamic = 'force-dynamic';

const deleteRequestSchema = z.object({
  /** Must equal the signed-in account's email. Typed, not clicked. */
  confirmEmail: z.string().trim().min(1, 'is required'),
});

export const DELETE = route(
  async ({ request, logger }) => {
    const session = await requireUser();
    const { confirmEmail } = deleteRequestSchema.parse(await readJson(request));

    if (confirmEmail.toLowerCase() !== session.email.toLowerCase()) {
      throw ApiError.validation('That does not match the email on this account.', {
        confirmEmail: 'must match the account’s email address exactly',
      });
    }

    const { deleteAccount } = await import('@/infrastructure/persistence/queries/account');
    const receipt = await deleteAccount(session.userId, new Date());

    logger.warn('account deleted', {
      rowsRemoved: receipt.rowsRemoved,
      screenshotsToPurge: receipt.screenshotKeys.length,
    });

    // The caller purges storage. Returning the keys rather than deleting them
    // here keeps this route free of a storage dependency, and makes the
    // outstanding work visible instead of implicit.
    return receipt;
  },
  { name: 'DELETE /api/account' },
);
