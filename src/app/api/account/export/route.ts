import { route } from '@/lib/api/handler';
import { requireUser } from '@/lib/auth/session';

/**
 * `GET /api/account/export` — §12.
 *
 * "Data export and deletion must both work from `/settings` and must actually
 * cascade. Test it."
 *
 * Returns everything the account holds, as JSON, including the object-storage
 * keys for any uploaded claim screenshots. §12 requires screenshots in the
 * export path, and they live outside the database, so the keys travel with the
 * data rather than being silently omitted.
 *
 * Deliberately a GET rather than a job with an emailed link: one user, one
 * request, no queue. If the dataset ever outgrows a single response, this
 * becomes a job — but building the job first would be inventing scale.
 */
export const dynamic = 'force-dynamic';

export const GET = route(
  async ({ logger }) => {
    const session = await requireUser();
    const { exportAccount } = await import('@/infrastructure/persistence/queries/account');

    const data = await exportAccount(session.userId, new Date());

    // §12 treats the hotel list as sensitive, so the log records the shape of
    // the export and never its contents.
    logger.info('account exported', {
      comparisons: data.comparisons.length,
      bookings: data.bookings.length,
      claims: data.claims.length,
      screenshots: data.screenshotKeys.length,
    });

    return data;
  },
  { name: 'GET /api/account/export' },
);
