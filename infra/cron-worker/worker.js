/**
 * Fires Parity's claim-deadline-sweep every 15 minutes.
 *
 * Vercel Hobby caps native crons at once per day, so this schedule cannot live
 * in vercel.json — a Cloudflare Worker Cron Trigger (free plan: 5 triggers,
 * per-minute granularity) fires it instead. The three daily/weekly jobs stay
 * on Vercel Cron.
 *
 * Auth matches src/lib/auth/cron.ts exactly: `Authorization: Bearer ${CRON_SECRET}`
 * — the same header Vercel Cron would have sent.
 */
export default {
  async scheduled(_event, env, _ctx) {
    const base = env.PARITY_BASE_URL.replace(/\/$/, "");
    const res = await fetch(`${base}/api/cron/claim-deadline-sweep`, {
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    });
    if (!res.ok) {
      // Throwing marks the invocation failed in the Cloudflare dashboard,
      // which is the only monitoring surface this job has.
      throw new Error(`claim-deadline-sweep returned ${res.status}`);
    }
  },
};
